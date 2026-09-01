import { eq } from 'drizzle-orm'
import { db, schema } from './db.mts'
import { generateChangeOrderPdf } from './changeOrderPdf.mts'
import { changeOrderTotal, changeOrderNumber, changeOrderTerms, reasonLabel } from './changeOrders.mts'

/**
 * Gather everything a change order PDF needs, from its row.
 *
 * Shared so the download route and the email that sends the change order
 * produce the same document. Built twice, they would drift -- and the one the
 * client keeps would stop matching the one they were sent.
 */

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

type ChangeOrderRow = typeof schema.changeOrders.$inferSelect

export function changeOrderFilename(workOrderId: number, sequence: number): string {
  return `${changeOrderNumber(workOrderId, sequence)}.pdf`
}

export async function buildChangeOrderPdf(changeOrder: ChangeOrderRow): Promise<Uint8Array> {
  const lineItems = await db
    .select()
    .from(schema.changeOrderLineItems)
    .where(eq(schema.changeOrderLineItems.changeOrderId, changeOrder.id))
    .orderBy(schema.changeOrderLineItems.sortOrder)

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

  const total = changeOrderTotal(lineItems)
  const number = changeOrderNumber(changeOrder.workOrderId, changeOrder.sequence)

  return generateChangeOrderPdf({
    number,
    workOrderId: changeOrder.workOrderId,
    status: changeOrder.status,
    issuedDate: fmtDate(changeOrder.sentAt || changeOrder.createdAt),
    description: changeOrder.description,
    reasonLabel: reasonLabel(changeOrder.reason),
    // The PO the change is actually under: its own if it has one, otherwise the
    // job's, which is what the client's page shows them too.
    poNumber: changeOrder.poNumber || estimate?.poNumber || null,
    scheduleImpactDays: changeOrder.scheduleImpactDays,
    total,
    lineItems,
    client: client || null,
    projectName: estimate?.projectName || null,
    siteAddress: estimate?.siteAddress || null,
    terms: changeOrderTerms({
      number,
      workOrderLabel: `Work Order #${changeOrder.workOrderId}`,
      total,
      scheduleImpactDays: changeOrder.scheduleImpactDays,
    }),
    signature: changeOrder.signatureData && changeOrder.signerName
      ? {
          signerName: changeOrder.signerName,
          signerTitle: changeOrder.signerTitle,
          signatureType: changeOrder.signatureType || 'typed',
          signatureData: changeOrder.signatureData,
          signedAt: changeOrder.respondedAt ? fmtDate(changeOrder.respondedAt) : '',
          ipAddress: changeOrder.ipAddress,
        }
      : null,
    declineReason: changeOrder.declineReason,
  })
}
