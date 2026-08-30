import { eq, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { getClientSession } from './_shared/client-auth.mts'
import { json, unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

interface DocRow {
  type: 'estimate' | 'workOrder' | 'invoice' | 'contract'
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
