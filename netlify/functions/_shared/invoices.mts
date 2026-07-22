import { eq } from 'drizzle-orm'
import { db, schema } from './db.mts'
import { computeTotal, formatMoney, invoiceNumber } from './money.mts'
import { sendReceiptToClient, notifyAdminInvoicePaid } from './email.mts'

export class InvoiceAlreadyPaidError extends Error {}
export class InvoiceNotFoundError extends Error {}

/**
 * Marks an invoice paid, sends the client a receipt, and notifies the admin.
 * Shared by the manual "Mark as Paid" admin action and the Stripe webhook, so
 * both paths behave identically and can't drift apart.
 */
export async function markInvoicePaid(invoiceId: number): Promise<void> {
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1)
  if (!invoice) throw new InvoiceNotFoundError()
  if (invoice.status === 'paid') throw new InvoiceAlreadyPaidError()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)
  const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoiceId))
  const total = computeTotal(lineItems)
  const numberLabel = invoiceNumber(invoice.id)
  const totalLabel = formatMoney(total)

  await db.update(schema.invoices).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.invoices.id, invoiceId))

  if (client) {
    await sendReceiptToClient(client.email, client.name, numberLabel, totalLabel)
    await notifyAdminInvoicePaid(client.name, numberLabel, totalLabel)
  }
}
