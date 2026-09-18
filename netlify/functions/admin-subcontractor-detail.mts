import { eq, desc, and, inArray } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, pathId } from './_shared/http.mts'
import { jobValue, subOwed } from './_shared/subJobs.mts'

const round2 = (x: number) => Math.round(x * 100) / 100

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [agreement] = await db.select().from(schema.subcontractorAgreements).where(eq(schema.subcontractorAgreements.id, id)).limit(1)
  if (!agreement) return notFound()

  /*
   * The jobs this sub has been given, each with what it billed, what the
   * agreement says they are owed for it, and what has been paid against it.
   * Pay day is then reading the "due" column instead of scrolling back
   * through texts to work out which cleans happened.
   */
  const jobs = await db
    .select({
      id: schema.workOrders.id,
      kind: schema.workOrders.kind,
      visitSequence: schema.workOrders.visitSequence,
      scheduledDate: schema.workOrders.scheduledDate,
      status: schema.workOrders.status,
      completedAt: schema.workOrders.completedAt,
      actualHours: schema.workOrders.actualHours,
      estimateId: schema.workOrders.estimateId,
      clientName: schema.clients.name,
    })
    .from(schema.workOrders)
    .leftJoin(schema.estimates, eq(schema.workOrders.estimateId, schema.estimates.id))
    .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
    .where(eq(schema.workOrders.subcontractorAgreementId, id))
    .orderBy(desc(schema.workOrders.scheduledDate), desc(schema.workOrders.id))

  const estimateIds = [...new Set(jobs.map(j => j.estimateId))]
  const lines = estimateIds.length
    ? await db.select().from(schema.estimateLineItems).where(inArray(schema.estimateLineItems.estimateId, estimateIds))
    : []
  const linesByEstimate = new Map<number, typeof lines>()
  for (const l of lines) linesByEstimate.set(l.estimateId, [...(linesByEstimate.get(l.estimateId) || []), l])

  const payments = jobs.length
    ? await db
        .select({ workOrderId: schema.subcontractorPayments.workOrderId, amount: schema.subcontractorPayments.amount })
        .from(schema.subcontractorPayments)
        .where(and(
          eq(schema.subcontractorPayments.subcontractorAgreementId, id),
          inArray(schema.subcontractorPayments.workOrderId, jobs.map(j => j.id)),
        ))
    : []
  const paidBy = new Map<number, number>()
  for (const p of payments) {
    if (p.workOrderId != null) paidBy.set(p.workOrderId, (paidBy.get(p.workOrderId) || 0) + Number(p.amount))
  }

  const rows = jobs.map(j => {
    const value = jobValue(linesByEstimate.get(j.estimateId) || [], j.kind)
    const owed = subOwed(agreement, value)
    const paid = round2(paidBy.get(j.id) || 0)
    // Done means completed, or hours logged: a one-off job's work order stays
    // 'signed' after the work, and only a visit flips to 'completed'.
    const done = j.status === 'completed' || j.completedAt != null || j.actualHours != null
    return { ...j, value, owed, paid, done, due: round2(Math.max(0, owed - paid)) }
  })

  return json({
    agreement,
    jobs: rows,
    // Only finished work is owed. A job booked for next week is not yet a debt.
    dueTotal: round2(rows.filter(r => r.done).reduce((s, r) => s + r.due, 0)),
  })
}

export const config = {
  path: '/api/admin/subcontractors/:id',
}
