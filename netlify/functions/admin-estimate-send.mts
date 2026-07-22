import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { sendEstimateToClient } from './_shared/email.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

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
  await sendEstimateToClient(client.email, client.name, estimate.token)

  return json({ ok: true })
}

export const config = {
  path: '/api/admin/estimates/:id/send',
}
