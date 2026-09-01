import { eq } from 'drizzle-orm'
import { db, schema } from './db.mts'
import { generateChangeOrderPdf } from './changeOrderPdf.mts'
import { frequencyOf } from './serviceSchedule.mts'
import {
  changeOrderTotal, changeOrderTerms, reasonLabel,
  changeOrderRef, contractChangeEffect, contractChangeTerms,
} from './changeOrders.mts'

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

export function changeOrderFilename(co: { workOrderId?: number | null; recurringContractId?: number | null; sequence: number }): string {
  return `${changeOrderRef(co)}.pdf`
}

export async function buildChangeOrderPdf(changeOrder: ChangeOrderRow): Promise<Uint8Array> {
  const lineItems = await db
    .select()
    .from(schema.changeOrderLineItems)
    .where(eq(schema.changeOrderLineItems.changeOrderId, changeOrder.id))
    .orderBy(schema.changeOrderLineItems.sortOrder)

  /*
   * A contract change order has no work order behind it: it amends the standing
   * agreement, and the visits underneath are dispatch rather than the thing
   * being renegotiated. Its client comes off the contract instead.
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

  const total = changeOrderTotal(lineItems)
  const number = changeOrderRef(changeOrder)

  const freq = contract ? frequencyOf(contract.visitFrequency) : null
  /*
   * The stored monthly figure wins over a fresh calculation. The client signed
   * a document naming an amount, and the PDF is the copy of what they signed --
   * recomputing it against a contract that has since moved would print a number
   * they never saw.
   */
  const effect = contract && freq
    ? {
        ...contractChangeEffect(total, freq.visitsPerYear, Number(contract.amount)),
        ...(changeOrder.newMonthlyAmount != null ? { newMonthly: Number(changeOrder.newMonthlyAmount) } : {}),
      }
    : null

  return generateChangeOrderPdf({
    number,
    workOrderId: changeOrder.workOrderId ?? 0,
    status: changeOrder.status,
    issuedDate: fmtDate(changeOrder.sentAt || changeOrder.createdAt),
    description: changeOrder.description,
    reasonLabel: reasonLabel(changeOrder.reason),
    // The PO the change is actually under: its own if it has one, otherwise the
    // job's, which is what the client's page shows them too.
    poNumber: changeOrder.poNumber || estimate?.poNumber || contract?.poNumber || null,
    scheduleImpactDays: changeOrder.scheduleImpactDays,
    total,
    lineItems,
    client: client || null,
    projectName: estimate?.projectName || contract?.description || null,
    siteAddress: estimate?.siteAddress || null,
    contractEffect: effect && contract && freq
      ? { ...effect, frequencyLabel: freq.label, contractDescription: contract.description }
      : null,
    terms: effect && contract && freq
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
