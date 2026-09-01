import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, notFound, badRequest, getClientIp } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { notifyAdminChangeOrderSigned, notifyAdminChangeOrderDeclined } from './_shared/email.mts'
import {
  changeOrderTotal, changeOrderNumber, canRespond, changeOrderTerms, reasonLabel,
} from './_shared/changeOrders.mts'

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface RespondBody {
  action?: unknown
  signerName?: unknown
  signerTitle?: unknown
  signatureType?: unknown
  signatureData?: unknown
  consentConfirmed?: unknown
  poNumber?: unknown
  declineReason?: unknown
}

/**
 * The client's view of a change order, and their answer to it.
 *
 * ?preview=1 is honoured only for a signed-in admin, and it suppresses both
 * the viewedAt stamp and any response. Checking your own document should not
 * write a record of the client having read it -- the proposal page had exactly
 * that bug, and it fabricated evidence of a client's attention.
 */
export default withErrorHandling('change-order-public', async (request: Request, context: Context) => {
  const token = context.params.token
  const preview = new URL(request.url).searchParams.get('preview') === '1' && isAuthenticated(request)

  const [changeOrder] = await db
    .select()
    .from(schema.changeOrders)
    .where(eq(schema.changeOrders.token, token))
    .limit(1)
  if (!changeOrder) return notFound()

  /*
   * A draft has not been sent. Its link should behave as though it does not
   * exist yet, or a client who was forwarded one early can sign a document
   * Renovo is still writing.
   */
  if (changeOrder.status === 'draft' && !preview) return notFound()

  const lineItems = await db
    .select()
    .from(schema.changeOrderLineItems)
    .where(eq(schema.changeOrderLineItems.changeOrderId, changeOrder.id))
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
    if (!changeOrder.viewedAt && !preview && changeOrder.status === 'sent') {
      await db
        .update(schema.changeOrders)
        .set({ viewedAt: new Date() })
        .where(eq(schema.changeOrders.id, changeOrder.id))
    }

    return json({
      changeOrder: { ...changeOrder, number, total },
      lineItems,
      client,
      projectName: estimate?.projectName || null,
      siteAddress: estimate?.siteAddress || null,
      reasonLabel: reasonLabel(changeOrder.reason),
      preview,
      terms: changeOrderTerms({
        number,
        workOrderLabel: `Work Order #${changeOrder.workOrderId}`,
        total,
        scheduleImpactDays: changeOrder.scheduleImpactDays,
      }),
    })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  if (preview) {
    return badRequest('This is a preview. Send the change order and let the client answer it themselves.')
  }

  let body: RespondBody
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request body')
  }

  if (!canRespond(changeOrder.status)) {
    return badRequest(
      changeOrder.status === 'approved'
        ? 'This change order has already been approved.'
        : 'This change order has already been declined.',
    )
  }

  if (body.action === 'decline') {
    const reason = typeof body.declineReason === 'string' ? body.declineReason.trim().slice(0, 1000) : ''
    await db
      .update(schema.changeOrders)
      .set({ status: 'declined', respondedAt: new Date(), declineReason: reason || null })
      .where(eq(schema.changeOrders.id, changeOrder.id))

    if (client) await notifyAdminChangeOrderDeclined(client.name, number, reason)
    return json({ status: 'declined' })
  }

  if (body.action !== 'approve') return badRequest('Unknown action')

  // Same bar as the proposal and the work order: a name, a mark, and consent.
  if (!body.signerName || !String(body.signerName).trim()) {
    return badRequest('Please enter your name as it should appear on the approval')
  }
  if (!body.signatureData) return badRequest('Please sign to approve this change order')
  if (body.signatureType !== 'drawn' && body.signatureType !== 'typed') {
    return badRequest('Invalid signature type')
  }
  if (!body.consentConfirmed) return badRequest('Please confirm you consent to sign electronically')

  /*
   * A PO given here wins over the one Renovo guessed at. The client is the
   * only party who knows what their own AP department will accept, and a
   * change order is often exactly when a second PO gets issued.
   */
  const poNumber = typeof body.poNumber === 'string' && body.poNumber.trim()
    ? body.poNumber.trim().slice(0, 60)
    : changeOrder.poNumber

  await db
    .update(schema.changeOrders)
    .set({
      status: 'approved',
      respondedAt: new Date(),
      signerName: String(body.signerName).trim().slice(0, 120),
      signerTitle: body.signerTitle ? String(body.signerTitle).trim().slice(0, 120) : null,
      signatureType: body.signatureType,
      signatureData: String(body.signatureData),
      consentConfirmed: true,
      ipAddress: getClientIp(request),
      poNumber,
    })
    .where(eq(schema.changeOrders.id, changeOrder.id))

  if (client) await notifyAdminChangeOrderSigned(client.name, number, money(total))
  return json({ status: 'approved' })
})

export const config = {
  path: '/api/change-order/:token',
}
