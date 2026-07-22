import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid estimate id')

  if (request.method === 'GET') {
    const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
    if (!estimate) return notFound()

    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
    const lineItems = await db
      .select()
      .from(schema.estimateLineItems)
      .where(eq(schema.estimateLineItems.estimateId, id))
      .orderBy(schema.estimateLineItems.sortOrder)

    const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.estimateId, id)).limit(1)

    return json({ estimate, client, lineItems, workOrder: workOrder || null })
  }

  if (request.method === 'PUT') {
    let body: { notes?: string; validUntil?: string; lineItems?: { description: string; quantity?: number | string; unitPrice: number | string }[] }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const [existing] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
    if (!existing) return notFound()
    if (existing.status !== 'draft') return badRequest('Only draft estimates can be edited')

    await db
      .update(schema.estimates)
      .set({ notes: body.notes, validUntil: body.validUntil, updatedAt: new Date() })
      .where(eq(schema.estimates.id, id))

    if (body.lineItems) {
      await db.delete(schema.estimateLineItems).where(eq(schema.estimateLineItems.estimateId, id))
      await db.insert(schema.estimateLineItems).values(
        body.lineItems.map((item, idx) => ({
          estimateId: id,
          description: item.description,
          quantity: String(item.quantity ?? 1),
          unitPrice: String(item.unitPrice),
          sortOrder: idx,
        })),
      )
    }

    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/admin/estimates/:id',
}
