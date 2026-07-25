import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid work order id')

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, workOrder.estimateId)).limit(1)
  const client = estimate ? (await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1))[0] : undefined
  const lineItems = estimate
    ? await db.select().from(schema.estimateLineItems).where(eq(schema.estimateLineItems.estimateId, estimate.id)).orderBy(schema.estimateLineItems.sortOrder)
    : []
  const [signature] = await db.select().from(schema.signatures).where(eq(schema.signatures.workOrderId, id)).limit(1)
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.workOrderId, id)).limit(1)

  return json({ workOrder, estimate, client, lineItems, signature: signature || null, invoice: invoice || null })
}

export const config = {
  path: '/api/admin/work-orders/:id',
}
