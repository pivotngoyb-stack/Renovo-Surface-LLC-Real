import { eq, and, isNull, inArray, lt, desc, sql } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { businessToday, effectiveExpiry } from './_shared/expiry.mts'

/**
 * Work that has fallen between two stages.
 *
 * Every item here is a commitment already made or money already earned that no
 * screen was showing. The first one exists because automatic work-order
 * creation can fail: the client is told on the proposal page that we will
 * contact them within two hours, and until this panel existed the only trace of
 * a failure was a console.error nobody reads. The alert email covers it too,
 * but an email can bounce, be filtered, or be missed -- a queue on the
 * dashboard cannot.
 */
export default withErrorHandling('admin-attention', async (request: Request, _context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  /* Approved, client is waiting, and no work order was ever produced. */
  const approvedWithoutWorkOrder = await db
    .select({
      id: schema.estimates.id,
      clientName: schema.clients.name,
      company: schema.clients.company,
      approvedAt: schema.estimates.approvedAt,
    })
    .from(schema.estimates)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.estimates.clientId))
    // Authorizations only: a contract that has generated visits still needs
    // the document the client signs, and matching any work order on the
    // estimate would quietly call that job handled.
    .leftJoin(schema.workOrders, and(
      eq(schema.workOrders.estimateId, schema.estimates.id),
      eq(schema.workOrders.kind, 'authorization'),
    ))
    .where(and(
      eq(schema.estimates.status, 'approved'),
      eq(schema.estimates.archived, false),
      isNull(schema.workOrders.id),
    ))

  /* Signed work, finished or not, that has never been invoiced. */
  const signedWithoutInvoice = await db
    .select({
      id: schema.workOrders.id,
      estimateId: schema.workOrders.estimateId,
      clientName: schema.clients.name,
      completedAt: schema.workOrders.completedAt,
      scheduledDate: schema.workOrders.scheduledDate,
    })
    .from(schema.workOrders)
    .leftJoin(schema.estimates, eq(schema.estimates.id, schema.workOrders.estimateId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.estimates.clientId))
    .leftJoin(schema.invoices, eq(schema.invoices.workOrderId, schema.workOrders.id))
    .where(and(
      eq(schema.workOrders.status, 'signed'),
      isNull(schema.invoices.id),
    ))

  /* Sent to the client, never answered, and now past its own expiry date. */
  const openEstimates = await db
    .select({
      id: schema.estimates.id,
      clientName: schema.clients.name,
      status: schema.estimates.status,
      validUntil: schema.estimates.validUntil,
      createdAt: schema.estimates.createdAt,
    })
    .from(schema.estimates)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.estimates.clientId))
    .where(and(
      eq(schema.estimates.archived, false),
      sql`${schema.estimates.status} in ('sent','viewed')`,
    ))

  // Expiry is compared in America/Denver by the shared helper rather than in
  // SQL, so the dashboard and the proposal page never disagree about whether
  // something lapsed today.
  const today = businessToday()
  const expiredUnanswered = openEstimates
    .filter(e => effectiveExpiry(e.validUntil, e.createdAt) < today)
    .map(e => ({ ...e, expiredOn: effectiveExpiry(e.validUntil, e.createdAt) }))

  /*
   * Pipeline, not problems: what is out with clients right now.
   *
   * The summary cards were entirely backward-looking -- revenue booked,
   * invoices unpaid. None of them answered "how much work am I waiting on",
   * which is the number that tells you whether to go find more.
   */
  const liveEstimates = openEstimates.filter(e => effectiveExpiry(e.validUntil, e.createdAt) >= today)

  const estimateValues = liveEstimates.length
    ? await db
        .select({
          estimateId: schema.estimateLineItems.estimateId,
          value: sql<string>`sum(${schema.estimateLineItems.quantity} * ${schema.estimateLineItems.unitPrice})`,
        })
        .from(schema.estimateLineItems)
        .where(inArray(schema.estimateLineItems.estimateId, liveEstimates.map(e => e.id)))
        .groupBy(schema.estimateLineItems.estimateId)
    : []

  const openValue = estimateValues.reduce((sum, r) => sum + Number(r.value || 0), 0)

  /*
   * Change orders sent and never answered.
   *
   * The crew is usually waiting on one of these: the extra work does not start
   * until it is signed, and a client sitting on it for a week stalls the job
   * without anyone noticing. Nothing surfaced them outside the work order page.
   */
  const unansweredChangeOrders = await db
    .select({
      id: schema.changeOrders.id,
      workOrderId: schema.changeOrders.workOrderId,
      recurringContractId: schema.changeOrders.recurringContractId,
      sequence: schema.changeOrders.sequence,
      description: schema.changeOrders.description,
      sentAt: schema.changeOrders.sentAt,
      viewedAt: schema.changeOrders.viewedAt,
      clientName: schema.clients.name,
    })
    .from(schema.changeOrders)
    // Both paths: joining only through work orders left every contract change
    // order with no client name against it on the dashboard.
    .leftJoin(schema.workOrders, eq(schema.workOrders.id, schema.changeOrders.workOrderId))
    .leftJoin(schema.estimates, eq(schema.estimates.id, schema.workOrders.estimateId))
    .leftJoin(schema.recurringContracts, eq(schema.recurringContracts.id, schema.changeOrders.recurringContractId))
    .leftJoin(schema.clients, eq(
      schema.clients.id,
      sql`coalesce(${schema.estimates.clientId}, ${schema.recurringContracts.clientId})`,
    ))
    .where(and(
      eq(schema.changeOrders.status, 'sent'),
      eq(schema.changeOrders.archived, false),
    ))
    .orderBy(schema.changeOrders.sentAt)

  /*
   * Visits whose date has passed with no hours against them.
   *
   * Either the crew did not go, or nobody wrote it down. Both are worth knowing
   * before the contract is invoiced for a month that includes them, and the
   * second is what quietly makes the profitability figures wrong.
   */
  const unloggedVisits = await db
    .select({
      id: schema.workOrders.id,
      scheduledDate: schema.workOrders.scheduledDate,
      visitSequence: schema.workOrders.visitSequence,
      recurringContractId: schema.workOrders.recurringContractId,
      contractDescription: schema.recurringContracts.description,
      clientName: schema.clients.name,
    })
    .from(schema.workOrders)
    .leftJoin(schema.recurringContracts, eq(schema.recurringContracts.id, schema.workOrders.recurringContractId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.recurringContracts.clientId))
    .where(and(
      eq(schema.workOrders.kind, 'visit'),
      isNull(schema.workOrders.actualHours),
      lt(schema.workOrders.scheduledDate, today),
    ))
    .orderBy(desc(schema.workOrders.scheduledDate))
    .limit(50)

  /*
   * Authorizations only.
   *
   * This counted every work order with status 'pending', which once visits
   * existed meant every scheduled visit as well -- a quarter of a weekly
   * contract putting thirteen rows into a number that is supposed to mean
   * "jobs waiting on a client signature". It read 101 when 8 were real.
   */
  const [pendingWorkOrders] = await db
    .select({ count: sql<string>`count(*)` })
    .from(schema.workOrders)
    .leftJoin(schema.estimates, eq(schema.estimates.id, schema.workOrders.estimateId))
    .where(and(
      eq(schema.workOrders.status, 'pending'),
      eq(schema.workOrders.kind, 'authorization'),
      // Archived work is filed away, not pipeline. Everything else on this
      // panel excludes it and this did not, so the figure disagreed with the
      // list it sits above.
      eq(schema.estimates.archived, false),
    ))

  return json({
    approvedWithoutWorkOrder,
    signedWithoutInvoice,
    expiredUnanswered,
    unansweredChangeOrders,
    unloggedVisits,
    total: approvedWithoutWorkOrder.length + signedWithoutInvoice.length + expiredUnanswered.length
      + unansweredChangeOrders.length + unloggedVisits.length,
    pipeline: {
      openEstimates: liveEstimates.length,
      openValue: Math.round(openValue * 100) / 100,
      pendingWorkOrders: Number(pendingWorkOrders?.count || 0),
    },
  })
})

export const config = {
  path: '/api/admin/attention',
}
