import { eq, and, isNull, gte } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, notFound, badRequest, getClientIp } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { notifyAdminChangeOrderSigned, notifyAdminChangeOrderDeclined } from './_shared/email.mts'
import { frequencyOf } from './_shared/serviceSchedule.mts'
import {
  changeOrderTotal, canRespond, changeOrderTerms, reasonLabel,
  changeOrderRef, contractChangeEffect, contractChangeTerms,
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
  const number = changeOrderRef(changeOrder)

  /*
   * A contract change order amends a standing rate rather than a job total, so
   * there is no work order to walk back through. The client, the wording and
   * what approval does are all different; everything else is the same document.
   */
  const [contract] = changeOrder.recurringContractId != null
    ? await db.select().from(schema.recurringContracts)
        .where(eq(schema.recurringContracts.id, changeOrder.recurringContractId)).limit(1)
    : []

  const [workOrder] = changeOrder.workOrderId != null
    ? await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, changeOrder.workOrderId)).limit(1)
    : []
  const [estimate] = workOrder
    ? await db.select().from(schema.estimates).where(eq(schema.estimates.id, workOrder.estimateId)).limit(1)
    : []
  const [client] = contract
    ? await db.select().from(schema.clients).where(eq(schema.clients.id, contract.clientId)).limit(1)
    : estimate
      ? await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
      : []

  const freq = contract ? frequencyOf(contract.visitFrequency) : null

  /*
   * The effect shown to the client is recomputed against the contract as it
   * stands, but the figure that will actually take effect is the one stored on
   * the change order when it was drafted. They agree unless the contract moved
   * in between, and in that case what the client signs is what binds.
   */
  const effect = contract && freq
    ? {
        ...contractChangeEffect(total, freq.visitsPerYear, Number(contract.amount)),
        newMonthly: changeOrder.newMonthlyAmount != null
          ? Number(changeOrder.newMonthlyAmount)
          : contractChangeEffect(total, freq.visitsPerYear, Number(contract.amount)).newMonthly,
      }
    : null

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
      /*
       * The PO already on the job. The client's field is prefilled with it,
       * because the original PO usually has the headroom to cover a change and
       * making them retype it invites a typo on the one field their accounts
       * payable matches against. They can replace it if AP issued a new one.
       */
      jobPoNumber: estimate?.poNumber || null,
      reasonLabel: reasonLabel(changeOrder.reason),
      preview,
      // A contract change is quoted per visit and billed monthly; the client
      // needs both numbers or the figure on their invoice appears from nowhere.
      contract: contract ? { id: contract.id, description: contract.description } : null,
      frequencyLabel: freq ? freq.label : null,
      effect,
      terms: contract && effect && freq
        ? contractChangeTerms({
            number,
            contractDescription: contract.description,
            effect,
            frequencyLabel: freq.label,
          })
        : changeOrderTerms({
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

  /*
   * Approving a contract change order is the moment the rate actually moves.
   *
   * The stored figure is used, not a fresh calculation: the client signed a
   * document naming a monthly amount, and recomputing it here against a
   * contract that has since changed would bill them something they never saw.
   *
   * Future visits are re-scoped too. A visit's terms text is what the crew
   * reads on site, and one generated before the change would send them out
   * with the old scope. Only unlogged future visits are touched -- a visit that
   * has happened is a record, not a plan.
   */
  if (contract && changeOrder.newMonthlyAmount != null) {
    await db
      .update(schema.recurringContracts)
      .set({ amount: String(changeOrder.newMonthlyAmount) })
      .where(eq(schema.recurringContracts.id, contract.id))

    const today = new Date().toISOString().slice(0, 10)
    const upcoming = await db
      .select()
      .from(schema.workOrders)
      .where(and(
        eq(schema.workOrders.recurringContractId, contract.id),
        eq(schema.workOrders.kind, 'visit'),
        isNull(schema.workOrders.actualHours),
        gte(schema.workOrders.scheduledDate, today),
      ))

    const addition = `

AMENDED BY ${number} (${new Date().toISOString().slice(0, 10)}):
${lineItems.map(li => `  - ${li.description}`).join('\n')}`

    for (const v of upcoming) {
      if (v.termsText.includes(`AMENDED BY ${number}`)) continue
      await db
        .update(schema.workOrders)
        .set({ termsText: v.termsText + addition })
        .where(eq(schema.workOrders.id, v.id))
    }
  }

  if (client) await notifyAdminChangeOrderSigned(client.name, number, money(total))
  return json({ status: 'approved' })
})

export const config = {
  path: '/api/change-order/:token',
}
