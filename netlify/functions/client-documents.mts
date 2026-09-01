import { eq, and, or, ne, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { getClientSession } from './_shared/client-auth.mts'
import { changeOrderRef } from './_shared/changeOrders.mts'
import { json, unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

interface DocRow {
  type: 'estimate' | 'workOrder' | 'changeOrder' | 'invoice' | 'contract'
  title: string
  status: string
  date: string
  /** Present on work orders only; null until the job is booked/finished. */
  scheduledDate?: string | null
  completedAt?: string | null
  detailUrl: string | null
}

export default withErrorHandling('client-documents', async (request: Request) => {
  const session = getClientSession(request)
  if (!session) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const results: DocRow[] = []

  const estimates = await db
    .select()
    .from(schema.estimates)
    .where(eq(schema.estimates.clientId, session.clientId))
    .orderBy(desc(schema.estimates.createdAt))
  for (const e of estimates) {
    results.push({ type: 'estimate', title: `Estimate #${e.id}`, status: e.status, date: e.createdAt.toISOString(), detailUrl: `/estimate.html?t=${e.token}` })
  }

  const workOrders = await db
    .select({ id: schema.workOrders.id, token: schema.workOrders.token, status: schema.workOrders.status, createdAt: schema.workOrders.createdAt, scheduledDate: schema.workOrders.scheduledDate, completedAt: schema.workOrders.completedAt })
    .from(schema.workOrders)
    .innerJoin(schema.estimates, eq(schema.workOrders.estimateId, schema.estimates.id))
    .where(eq(schema.estimates.clientId, session.clientId))
    .orderBy(desc(schema.workOrders.createdAt))
  for (const w of workOrders) {
    // Show the client when the work actually happened, not just when the
    // paperwork was raised -- that is what makes this a service history.
    results.push({
      type: 'workOrder',
      title: `Work Order #${w.id}`,
      status: w.completedAt ? 'completed' : w.status,
      date: (w.completedAt || w.createdAt).toISOString(),
      scheduledDate: w.scheduledDate,
      completedAt: w.completedAt ? w.completedAt.toISOString() : null,
      detailUrl: `/work-order.html?t=${w.token}`,
    })
  }

  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.clientId, session.clientId))
    .orderBy(desc(schema.invoices.createdAt))
  for (const i of invoices) {
    results.push({ type: 'invoice', title: `INV-${1000 + i.id}`, status: i.status, date: i.createdAt.toISOString(), detailUrl: `/invoice.html?t=${i.token}` })
  }

  /*
   * Change orders the client has been sent.
   *
   * These are the documents most likely to be looked up months later: a client
   * querying why an invoice was larger than the job they signed for needs to
   * find the amendment they approved, and until now it existed nowhere they
   * could reach except the original email.
   *
   * Drafts are excluded. One that has not been sent is Renovo still writing,
   * and a client finding it in their portal would be reading a document that
   * has not been put to them yet.
   */
  /*
   * Left-joined through both paths, because a change order hangs off a work
   * order OR a contract. An inner join on work orders silently dropped every
   * contract change order -- the client would never see the document that put
   * their monthly bill up.
   */
  const changeOrders = await db
    .select({
      id: schema.changeOrders.id,
      workOrderId: schema.changeOrders.workOrderId,
      recurringContractId: schema.changeOrders.recurringContractId,
      sequence: schema.changeOrders.sequence,
      token: schema.changeOrders.token,
      status: schema.changeOrders.status,
      createdAt: schema.changeOrders.createdAt,
      sentAt: schema.changeOrders.sentAt,
      jobClientId: schema.estimates.clientId,
      contractClientId: schema.recurringContracts.clientId,
    })
    .from(schema.changeOrders)
    .leftJoin(schema.workOrders, eq(schema.changeOrders.workOrderId, schema.workOrders.id))
    .leftJoin(schema.estimates, eq(schema.workOrders.estimateId, schema.estimates.id))
    .leftJoin(schema.recurringContracts, eq(schema.changeOrders.recurringContractId, schema.recurringContracts.id))
    .where(and(
      or(
        eq(schema.estimates.clientId, session.clientId),
        eq(schema.recurringContracts.clientId, session.clientId),
      ),
      ne(schema.changeOrders.status, 'draft'),
    ))
    .orderBy(desc(schema.changeOrders.createdAt))
  for (const c of changeOrders) {
    results.push({
      type: 'changeOrder',
      title: `Change Order ${changeOrderRef(c)}`,
      status: c.status,
      date: (c.sentAt || c.createdAt).toISOString(),
      detailUrl: `/change-order.html?t=${c.token}`,
    })
  }

  // Recurring contracts have no public token/detail page today -- listed read-only.
  const contracts = await db
    .select()
    .from(schema.recurringContracts)
    .where(eq(schema.recurringContracts.clientId, session.clientId))
    .orderBy(desc(schema.recurringContracts.createdAt))
  for (const c of contracts) {
    results.push({ type: 'contract', title: c.description, status: c.status, date: c.createdAt.toISOString(), detailUrl: null })
  }

  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return json({ documents: results })
})

export const config = {
  path: '/api/client/documents',
}
