import { eq } from 'drizzle-orm'
import { db, schema } from './db.mts'
import { generateToken } from './tokens.mts'
import { sendWorkOrderToClient, notifyAdminEmailDeliveryFailed } from './email.mts'

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'

/**
 * Creates a work order for an approved estimate and emails the client to sign.
 * Returns null (no-op) if the estimate isn't approved, has no client, or a
 * work order already exists for it — callers that need those as hard errors
 * (the admin manual-convert endpoint) check for those conditions themselves
 * before calling this.
 */
export async function createWorkOrderForEstimate(estimateId: number) {
  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, estimateId)).limit(1)
  if (!estimate || estimate.status !== 'approved') return null

  const [existingWO] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.estimateId, estimateId)).limit(1)
  if (existingWO) return null

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
  if (!client) return null

  const lineItems = await db
    .select()
    .from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, estimateId))
    .orderBy(schema.estimateLineItems.sortOrder)

  const subtotal = lineItems.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
  const total = subtotal + Number(estimate.taxAmount || 0)
  const scopeLines = lineItems.map((li) => `  - ${li.description} (Qty: ${li.quantity} @ $${Number(li.unitPrice).toFixed(2)})`).join('\n')
  const taxLine = estimate.taxApplied ? `\nUtah Sales Tax (7.25%): $${Number(estimate.taxAmount).toFixed(2)}` : ''

  const termsText = `WORK AUTHORIZATION

Client: ${client.name}${client.company ? ` (${client.company})` : ''}
Property: ${client.propertyAddress || 'See estimate'}

Scope of Work:
${scopeLines}

Subtotal: $${subtotal.toFixed(2)}${taxLine}
Total Amount: $${total.toFixed(2)}

By signing below, the client authorizes Renovo Surface Solutions LLC to perform
the work described above. Payment is due per the terms of the invoice issued
upon completion. This authorization is legally binding once signed.`

  const [workOrder] = await db
    .insert(schema.workOrders)
    .values({
      estimateId,
      token: generateToken(),
      termsText,
      status: 'pending',
    })
    .returning()

  const sent = await sendWorkOrderToClient(client.email, client.name, workOrder.token)
  if (!sent) {
    const link = `${SITE_URL}/work-order.html?t=${workOrder.token}`
    await notifyAdminEmailDeliveryFailed(client.name, client.email, 'work order', link)
  }

  return workOrder
}
