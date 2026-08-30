import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { buildJobPlan } from './_shared/jobModel.mts'

/**
 * Internal crew plan for a work order: crew size, chemicals, tools, timeline,
 * water and runoff compliance.
 *
 * Admin session required. This is deliberately a separate route from the
 * public /api/work-order/:token so a client following their signing link can
 * never reach it -- they get the work order, never the plan behind it.
 */
export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid work order id')

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  const lineItems = await db
    .select()
    .from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, workOrder.estimateId))
    .orderBy(schema.estimateLineItems.sortOrder)

  return json({ plan: buildJobPlan(lineItems) })
}

export const config = {
  path: '/api/admin/work-orders/:id/job-plan',
}
