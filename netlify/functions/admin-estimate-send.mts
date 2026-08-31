import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { sendEstimateToClient } from './_shared/email.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { buildProposalPdf, proposalFilename } from './_shared/proposalDocument.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid estimate id')

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
  if (!estimate) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
  if (!client) return notFound()

  await db.update(schema.estimates).set({ status: 'sent', updatedAt: new Date() }).where(eq(schema.estimates.id, id))

  /*
   * The PDF is a nice-to-have on top of the link, so a failure to render it
   * must not stop the proposal going out. A client with a working link and no
   * attachment can still read and accept; a client with no email at all cannot.
   */
  let pdf: { filename: string; bytes: Uint8Array } | null = null
  try {
    pdf = { filename: proposalFilename(estimate.id), bytes: await buildProposalPdf(estimate, client) }
  } catch (err) {
    console.error(`[admin-estimate-send] could not build the PDF for estimate ${id}`, err)
  }

  await sendEstimateToClient(client.email, client.name, estimate.token, pdf)

  return json({ ok: true, pdfAttached: pdf != null })
}

export const config = {
  path: '/api/admin/estimates/:id/send',
}
