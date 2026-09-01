import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { sendChangeOrderToClient, notifyAdminEmailDeliveryFailed } from './_shared/email.mts'
import {
  changeOrderTotal, changeOrderNumber, canSend, canEdit, changeOrderTerms, reasonLabel,
} from './_shared/changeOrders.mts'

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * One change order: read it, delete a draft, or send it for signature.
 *
 * Sending is a POST to ?action=send rather than a status PATCH. It emails a
 * client asking for money, and that should not be reachable by setting a field
 * to a string.
 */
export default withErrorHandling('admin-change-order-detail', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid change order id')

  const [changeOrder] = await db
    .select()
    .from(schema.changeOrders)
    .where(eq(schema.changeOrders.id, id))
    .limit(1)
  if (!changeOrder) return notFound()

  const lineItems = await db
    .select()
    .from(schema.changeOrderLineItems)
    .where(eq(schema.changeOrderLineItems.changeOrderId, id))
    .orderBy(schema.changeOrderLineItems.sortOrder)

  const total = changeOrderTotal(lineItems)
  const number = changeOrderNumber(changeOrder.workOrderId, changeOrder.sequence)

  const [workOrder] = await db
    .select()
    .from(schema.workOrders)
    .where(eq(schema.workOrders.id, changeOrder.workOrderId))
    .limit(1)

  const [estimate] = workOrder
    ? await db.select().from(schema.estimates).where(eq(schema.estimates.id, workOrder.estimateId)).limit(1)
    : []
  const [client] = estimate
    ? await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
    : []

  if (request.method === 'GET') {
    return json({
      changeOrder: { ...changeOrder, number, total },
      lineItems,
      workOrder,
      client,
      reasonLabel: reasonLabel(changeOrder.reason),
      terms: changeOrderTerms({
        number,
        workOrderLabel: `Work Order #${changeOrder.workOrderId}`,
        total,
        scheduleImpactDays: changeOrder.scheduleImpactDays,
      }),
      clientLink: `${SITE_URL}/change-order.html?t=${changeOrder.token}`,
    })
  }

  if (request.method === 'DELETE') {
    /*
     * Only a draft can be deleted. Once it has been sent the client has seen
     * it, and once it is answered it is a record of what they agreed to --
     * deleting either leaves Renovo unable to explain a number on an invoice.
     */
    if (!canEdit(changeOrder.status)) {
      return badRequest('This change order has already been sent. Leave the record in place.')
    }
    await db.delete(schema.changeOrderLineItems).where(eq(schema.changeOrderLineItems.changeOrderId, id))
    await db.delete(schema.changeOrders).where(eq(schema.changeOrders.id, id))
    return json({ deleted: true })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const action = new URL(request.url).searchParams.get('action')
  if (action !== 'send') return badRequest('Unknown action')

  if (!canSend(changeOrder.status)) {
    return badRequest(
      changeOrder.status === 'sent'
        ? 'This change order has already been sent.'
        : 'This change order has already been answered.',
    )
  }
  if (!client) return badRequest('This work order has no client to send to')

  const [updated] = await db
    .update(schema.changeOrders)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(schema.changeOrders.id, id))
    .returning()

  const sent = await sendChangeOrderToClient(
    client.email,
    client.name,
    changeOrder.token,
    number,
    money(total),
    changeOrder.description.slice(0, 300),
  )
  if (!sent) {
    await notifyAdminEmailDeliveryFailed(
      client.name,
      client.email,
      'change order ' + number,
      `${SITE_URL}/change-order.html?t=${changeOrder.token}`,
    )
  }

  return json({ changeOrder: { ...updated, number, total }, emailed: sent })
})

export const config = {
  path: '/api/admin/change-orders/:id',
}
