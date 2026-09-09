import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { sendEstimateToClient } from './_shared/email.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { buildProposalPdf, proposalFilename } from './_shared/proposalDocument.mts'
import { checkDetermination } from './_shared/prevailingWage.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
  if (!estimate) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
  if (!client) return notFound()

  /*
   * A covered bid does not leave without the determination it was costed
   * against.
   *
   * The proposal a prevailing wage flag produces contains two binding
   * statements: that Renovo will pay the applicable determination, and that
   * certified payroll will be filed each period. Sending that on a price built
   * from an ordinary shop wage is signing up to a labor cost roughly double
   * what was bid. The browser warns while the estimate is being written; this
   * is the check that cannot be skipped by not looking at the screen.
   */
  if (estimate.prevailingWage) {
    const problems = checkDetermination({
      number: estimate.wageDeterminationNumber ?? undefined,
      classification: estimate.wageClassification ?? undefined,
      baseRate: estimate.wageBaseRate != null ? Number(estimate.wageBaseRate) : undefined,
      fringeRate: estimate.wageFringeRate != null ? Number(estimate.wageFringeRate) : 0,
      fringeMode: estimate.wageFringeMode === 'plan' ? 'plan' : 'cash',
      decisionDate: estimate.wageDecisionDate ?? null,
    })
    if (problems.length) {
      return badRequest(
        'This bid is marked prevailing wage, so it promises to pay the determination and file '
        + 'certified payroll. Add the determination before sending it: '
        + problems.map(p => p.message).join(' '),
      )
    }
  }

  /*
   * An unacknowledged addendum stops the bid.
   *
   * It is the most common reason a complete, competitive bid is thrown out
   * unread -- and unlike a missing insurance certificate, which may well be
   * attached to the email already, this is a fact somebody recorded in this
   * app on purpose. The app knows the addendum arrived and knows nobody has
   * said so in writing. Refusing on that is a rail, not a guess.
   *
   * Everything else the readiness check finds is a warning, said on the screen
   * and stepped over: blocking on what the app cannot actually know is how a
   * safety rail becomes an obstacle people learn to route around.
   */
  const addenda = await db.select().from(schema.bidAddenda).where(eq(schema.bidAddenda.estimateId, id))
  const unacknowledged = addenda.filter(a => !a.acknowledged)
  if (unacknowledged.length) {
    const list = unacknowledged.map(a => a.number).join(', ')
    return badRequest(
      `Addend${unacknowledged.length === 1 ? 'um' : 'a'} ${list} ${unacknowledged.length === 1 ? 'has' : 'have'} not been acknowledged. `
      + 'A bid that does not acknowledge every addendum is thrown out before the price is read, and any of '
      + 'them may have changed the scope you priced. Acknowledge them on the estimate, then send.',
    )
  }

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
