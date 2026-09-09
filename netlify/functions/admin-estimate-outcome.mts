import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const OUTCOMES = ['won', 'lost', 'no_bid', 'withdrawn'] as const
type Outcome = (typeof OUTCOMES)[number]

const MAX_NAME = 120
const MAX_NOTES = 1000

/**
 * How a bid finished, and what it finished against.
 *
 * Nothing recorded this, so every bid was priced from the same assumptions as
 * the last one whether the last one won or lost by forty percent. The single
 * most valuable figure a losing bid produces is the winner's number, and it is
 * only ever available in the week or two after the award -- so there has to be
 * somewhere to put it while it is still findable.
 *
 * Deliberately separate from the estimate's status. Status is what happened to
 * the paperwork; most bids never have anything happen to the paperwork at all.
 * They go quiet and the job turns up on somebody else's truck.
 */
export default withErrorHandling('admin-estimate-outcome', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
  if (!estimate) return notFound()

  let body: {
    outcome?: unknown; lostToName?: unknown; lostToAmount?: unknown
    bidderCount?: unknown; outcomeNotes?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  // Clearing it is legitimate: an award gets reversed, or the wrong button
  // was pressed, and a wrong outcome poisons the read on every future bid.
  if (body.outcome === null || body.outcome === '') {
    await db.update(schema.estimates).set({
      outcome: null, outcomeAt: null, outcomeNotes: null,
      lostToName: null, lostToAmount: null, bidderCount: null,
      updatedAt: new Date(),
    }).where(eq(schema.estimates.id, id))
    return json({ ok: true, outcome: null })
  }

  if (!OUTCOMES.includes(body.outcome as Outcome)) {
    return badRequest(`Outcome must be one of: ${OUTCOMES.join(', ')}`)
  }
  const outcome = body.outcome as Outcome

  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

  /*
   * A competitor price of zero is not a price, it is an empty box. Storing it
   * would put a divide-by-zero into the loss-gap median, so it is dropped and
   * the loss is counted without a measured gap -- which is the honest state.
   */
  let lostToAmount: string | null = null
  if (body.lostToAmount != null && body.lostToAmount !== '') {
    const n = Number(body.lostToAmount)
    if (!Number.isFinite(n) || n < 0) return badRequest('The winning amount must be a positive number')
    if (n > 0) lostToAmount = String(Math.round(n * 100) / 100)
  }

  let bidderCount: number | null = null
  if (body.bidderCount != null && body.bidderCount !== '') {
    const n = Number(body.bidderCount)
    if (!Number.isInteger(n) || n < 1 || n > 99) return badRequest('Bidder count must be a whole number between 1 and 99')
    bidderCount = n
  }

  /*
   * Only a loss carries a competitor. Keeping "lost to Acme at $9,000" on a
   * bid later marked won leaves a record that reads as both at once, and the
   * loss-gap median would count a win as a loss.
   */
  const isLoss = outcome === 'lost'

  await db.update(schema.estimates).set({
    outcome,
    outcomeAt: new Date(),
    outcomeNotes: text(body.outcomeNotes, MAX_NOTES),
    lostToName: isLoss ? text(body.lostToName, MAX_NAME) : null,
    lostToAmount: isLoss ? lostToAmount : null,
    bidderCount,
    updatedAt: new Date(),
  }).where(eq(schema.estimates.id, id))

  return json({ ok: true, outcome })
})

export const config = {
  path: '/api/admin/estimates/:id/outcome',
}
