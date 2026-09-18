import { eq, sql, desc, and, isNotNull, isNull, inArray, gte } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { summariseOutcomes, type BidRecord } from './_shared/bidOutcomes.mts'

/**
 * The bid desk: what is due, and what the record says about the pricing.
 *
 * Two questions this answers that nothing else could. What has a deadline this
 * week -- because the most expensive way to lose a bid is to be late with the
 * cheapest number. And whether the number is any good, which requires knowing
 * how the last twenty finished and nothing recorded that.
 */
export default withErrorHandling('admin-bid-board', async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const rows = await db
    .select({
      id: schema.estimates.id,
      status: schema.estimates.status,
      projectName: schema.estimates.projectName,
      bidMode: schema.estimates.bidMode,
      solicitationNumber: schema.estimates.solicitationNumber,
      bidDueAt: schema.estimates.bidDueAt,
      bidDeliveryMethod: schema.estimates.bidDeliveryMethod,
      outcome: schema.estimates.outcome,
      outcomeAt: schema.estimates.outcomeAt,
      lostToName: schema.estimates.lostToName,
      lostToAmount: schema.estimates.lostToAmount,
      bidderCount: schema.estimates.bidderCount,
      createdAt: schema.estimates.createdAt,
      clientName: schema.clients.name,
      company: schema.clients.company,
    })
    .from(schema.estimates)
    .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
    .where(eq(schema.estimates.archived, false))
    .orderBy(desc(schema.estimates.createdAt))

  /*
   * Bid value is the non-optional total, matching what the client was asked to
   * accept. Optional alternates are quoted but not bid, and counting them
   * would inflate every won and lost figure on the board.
   */
  const values = rows.length
    ? await db
        .select({
          estimateId: schema.estimateLineItems.estimateId,
          value: sql<string>`sum(${schema.estimateLineItems.quantity} * ${schema.estimateLineItems.unitPrice})`,
        })
        .from(schema.estimateLineItems)
        .where(and(
          inArray(schema.estimateLineItems.estimateId, rows.map(r => r.id)),
          eq(schema.estimateLineItems.isOptional, false),
        ))
        .groupBy(schema.estimateLineItems.estimateId)
    : []

  const valueOf = new Map(values.map(v => [v.estimateId, Number(v.value || 0)]))

  /*
   * The pricing record is for bids. A house quote is won or lost against a
   * different market, at a twentieth of the value, ten times as often -- left
   * in, it would drown the win rate and loss gap that tell you whether the
   * next commercial number is right. Home quotes still appear in the lists
   * below: one sent and never answered still needs chasing.
   */
  const bids: BidRecord[] = rows.filter(r => r.bidMode !== 'residential').map(r => ({
    id: r.id,
    outcome: r.outcome,
    amount: valueOf.get(r.id) || 0,
    lostToAmount: r.lostToAmount != null ? Number(r.lostToAmount) : null,
  }))

  const now = new Date()
  const withValue = rows.map(r => ({ ...r, amount: valueOf.get(r.id) || 0 }))

  /*
   * Due dates only matter while they are ahead of you. A bid that closed last
   * month belongs in the record, not on the calendar -- and a calendar full of
   * expired deadlines is a calendar nobody reads.
   */
  const upcoming = withValue
    .filter(r => r.bidDueAt && new Date(r.bidDueAt) >= now && !r.outcome)
    .sort((a, b) => new Date(a.bidDueAt!).getTime() - new Date(b.bidDueAt!).getTime())

  const overdue = withValue
    .filter(r => r.bidDueAt && new Date(r.bidDueAt) < now && !r.outcome)
    .sort((a, b) => new Date(b.bidDueAt!).getTime() - new Date(a.bidDueAt!).getTime())

  // Sent, never answered, no deadline recorded: the ones that quietly go stale.
  const awaiting = withValue.filter(r =>
    !r.outcome && !r.bidDueAt && (r.status === 'sent' || r.status === 'viewed'))

  return json({
    summary: summariseOutcomes(bids),
    upcoming,
    overdue,
    awaiting,
    decided: withValue.filter(r => r.outcome).slice(0, 50),
  })
})

export const config = {
  path: '/api/admin/bid-board',
}
