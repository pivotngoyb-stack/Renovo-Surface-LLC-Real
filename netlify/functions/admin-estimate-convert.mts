import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { generateToken } from './_shared/tokens.mts'
import { sendWorkOrderToClient } from './_shared/email.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid estimate id')

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
  if (!estimate) return notFound()
  if (estimate.status !== 'approved') return badRequest('Only approved estimates can be converted to a work order')

  const [existingWO] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.estimateId, id)).limit(1)
  if (existingWO) return badRequest('A work order already exists for this estimate')

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
  if (!client) return notFound()

  const lineItems = await db
    .select()
    .from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, id))
    .orderBy(schema.estimateLineItems.sortOrder)

  const total = lineItems.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
  const scopeLines = lineItems.map((li) => `  - ${li.description} (Qty: ${li.quantity} @ $${Number(li.unitPrice).toFixed(2)})`).join('\n')

  const termsText = `WORK AUTHORIZATION

Client: ${client.name}${client.company ? ` (${client.company})` : ''}
Property: ${client.propertyAddress || 'See estimate'}

Scope of Work:
${scopeLines}

Total Amount: $${total.toFixed(2)}

By signing below, the client authorizes Renovo Surface Solutions LLC to perform
the work described above. Payment is due per the terms of the invoice issued
upon completion. This authorization is legally binding once signed.`

  const [workOrder] = await db
    .insert(schema.workOrders)
    .values({
      estimateId: id,
      token: generateToken(),
      termsText,
      status: 'pending',
    })
    .returning()

  await sendWorkOrderToClient(client.email, client.name, workOrder.token)

  return json({ workOrder }, { status: 201 })
}

export const config = {
  path: '/api/admin/estimates/:id/convert',
}
