import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { contractValue, frequencyOf } from './_shared/serviceSchedule.mts'

/**
 * Turn a quoted recurring job into actual billing.
 *
 * The estimate already knows the frequency and the per-visit price. Until now
 * the only way to get a contract billing was to retype all of it on the
 * contracts page, which meant a weekly janitorial job could be sold, worked and
 * never invoiced because nobody remembered to set the billing up.
 *
 * Deliberately a button rather than something that fires on approval. This
 * schedules real charges against a client, and a side effect that large should
 * be something a person chose.
 */
export default withErrorHandling('admin-estimate-contract', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const estimateId = Number(context.params.id)
  if (!Number.isInteger(estimateId)) return badRequest('Invalid estimate id')

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, estimateId)).limit(1)
  if (!estimate) return notFound()
  if (estimate.status !== 'approved') {
    return badRequest('Set up billing once the client has accepted the proposal')
  }

  const [existing] = await db
    .select({ id: schema.recurringContracts.id })
    .from(schema.recurringContracts)
    .where(eq(schema.recurringContracts.estimateId, estimateId))
    .limit(1)
  if (existing) return badRequest('Recurring billing is already set up for this estimate')

  const lineItems = await db
    .select()
    .from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, estimateId))
    .orderBy(schema.estimateLineItems.sortOrder)

  const recurring = lineItems.filter(li => !li.isOptional && frequencyOf(li.frequency).recurring)
  if (!recurring.length) {
    return badRequest('Nothing on this estimate recurs, so there is no contract to bill')
  }

  /*
   * Billing runs monthly, so the contract amount is the monthly average of the
   * whole recurring package rather than one visit. A weekly line at $987 is
   * $4,278 a month, and charging $987 once a month would under-bill by three
   * quarters -- the kind of error that is invisible until a year-end reconcile.
   */
  const contract = contractValue(lineItems)

  let body: { billingDay?: unknown; description?: unknown } = {}
  try {
    body = await request.json()
  } catch { /* defaults below */ }

  const day = Number(body.billingDay)
  const billingDay = Number.isInteger(day) && day >= 1 && day <= 28
    ? day
    // Capped at 28 so a monthly charge never skips February.
    : 1

  const services = [...new Set(recurring.map(li => frequencyOf(li.frequency).label))].join(', ')
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim().slice(0, 200)
    : `${estimate.projectName || 'Recurring service'} (${services})`

  const [created] = await db
    .insert(schema.recurringContracts)
    .values({
      clientId: estimate.clientId,
      estimateId,
      description,
      amount: String(contract.monthlyAverage),
      billingDay,
      status: 'active',
    })
    .returning()

  return json({ contract: created, monthlyAverage: contract.monthlyAverage, annual: contract.annualRecurring }, { status: 201 })
})

export const config = {
  path: '/api/admin/estimates/:id/recurring-contract',
}
