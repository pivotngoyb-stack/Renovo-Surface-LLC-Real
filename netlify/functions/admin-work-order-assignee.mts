import { eq, and, ne } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { jobValue, subOwed, payTermsLabel, assignable } from './_shared/subJobs.mts'

/**
 * Who is doing this job: Renovo's own crew, or a subcontractor.
 *
 * GET answers everything the work order page needs in one call -- who has it,
 * what it bills, what they are owed for it and what has been paid -- so the
 * arithmetic lives here, once, rather than in the page.
 *
 * Only a signed, live agreement can be given work. The agreement is where the
 * sub accepts the insurance, the standards and the pay terms; sending someone
 * into a client's home before they have signed it is sending them in on none.
 */
export default withErrorHandling('admin-work-order-assignee', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  if (request.method === 'GET') {
    const lines = await db
      .select()
      .from(schema.estimateLineItems)
      .where(eq(schema.estimateLineItems.estimateId, workOrder.estimateId))
    const value = jobValue(lines, workOrder.kind)

    const subs = (await db.select().from(schema.subcontractorAgreements))
      .filter(a => assignable(a) || a.id === workOrder.subcontractorAgreementId)
      .map(a => ({ id: a.id, name: a.subcontractorName, terms: payTermsLabel(a), owed: subOwed(a, value), signed: assignable(a) }))

    const current = subs.find(s => s.id === workOrder.subcontractorAgreementId) || null
    const paid = current
      ? (await db
          .select({ amount: schema.subcontractorPayments.amount })
          .from(schema.subcontractorPayments)
          .where(and(
            eq(schema.subcontractorPayments.workOrderId, id),
            eq(schema.subcontractorPayments.subcontractorAgreementId, current.id),
          )))
          .reduce((s, p) => s + Number(p.amount), 0)
      : 0

    return json({
      assignee: current,
      jobValue: value,
      paid: Math.round(paid * 100) / 100,
      subs,
    })
  }

  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: { subcontractorAgreementId?: unknown }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const raw = body.subcontractorAgreementId
  const subId = raw === null || raw === '' || raw === undefined ? null : Number(raw)
  if (subId !== null && !(Number.isInteger(subId) && subId > 0)) return badRequest('Pick a subcontractor from the list')

  if (subId !== null) {
    const [agreement] = await db
      .select()
      .from(schema.subcontractorAgreements)
      .where(eq(schema.subcontractorAgreements.id, subId))
      .limit(1)
    if (!agreement) return badRequest('That subcontractor no longer exists')
    if (!assignable(agreement)) {
      return badRequest(agreement.archived
        ? `${agreement.subcontractorName}'s agreement is archived. Unarchive it before giving them work.`
        : `${agreement.subcontractorName} has not signed their agreement yet. Send it and wait for the signature before giving them a job.`)
    }
  }

  /*
   * A job already paid to one sub cannot quietly move to another: the payment
   * would then sit against a job the new sub is also owed for, and one of them
   * would be paid twice. Delete the payment first if it really was a mistake.
   */
  const [paidToOther] = await db
    .select({ id: schema.subcontractorPayments.id })
    .from(schema.subcontractorPayments)
    .where(and(
      eq(schema.subcontractorPayments.workOrderId, id),
      subId === null
        ? eq(schema.subcontractorPayments.workOrderId, id)
        : ne(schema.subcontractorPayments.subcontractorAgreementId, subId),
    ))
    .limit(1)
  if (paidToOther) {
    return badRequest('A payment for this job is already recorded to its current subcontractor. Delete that payment on their page before moving the job.')
  }

  await db.update(schema.workOrders).set({ subcontractorAgreementId: subId }).where(eq(schema.workOrders.id, id))
  return json({ ok: true, subcontractorAgreementId: subId })
})

export const config = {
  path: '/api/admin/work-orders/:id/assignee',
}
