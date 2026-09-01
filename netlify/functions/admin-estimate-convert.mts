import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { createWorkOrderForEstimate } from './_shared/workOrders.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
  if (!estimate) return notFound()
  if (estimate.status !== 'approved') return badRequest('Only approved estimates can be converted to a work order')

  const [existingWO] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.estimateId, id)).limit(1)
  if (existingWO) return badRequest('A work order already exists for this estimate')

  const workOrder = await createWorkOrderForEstimate(id)
  if (!workOrder) return badRequest('Could not create work order for this estimate')

  return json({ workOrder }, { status: 201 })
}

export const config = {
  path: '/api/admin/estimates/:id/convert',
}
