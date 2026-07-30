import { eq } from 'drizzle-orm'
import { db, schema } from './db.mts'
import { computeTotal, formatMoney, invoiceNumber } from './money.mts'
import { sendReceiptToClient, notifyAdminInvoicePaid, sendPartialPaymentReceipt, notifyAdminPartialPaymentReceived } from './email.mts'

export class InvoiceAlreadyPaidError extends Error {}
export class InvoiceNotFoundError extends Error {}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Sum of the invoice's payment ledger. Invoices marked paid before this ledger
 * existed have no ledger rows at all -- fall back to the invoice total so they
 * don't misleadingly show "$0.00 paid".
 */
export async function getAmountPaid(invoiceId: number): Promise<number> {
  const payments = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, invoiceId))
  const ledgerSum = payments.reduce((sum, p) => sum + Number(p.amount), 0)
  if (ledgerSum > 0) return round2(ledgerSum)

  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1)
  if (invoice?.status === 'paid') {
    const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoiceId))
    return round2(computeTotal(lineItems) + Number(invoice.taxAmount || 0))
  }
  return 0
}

export async function getInvoiceTotals(invoiceId: number) {
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1)
  if (!invoice) throw new InvoiceNotFoundError()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)
  const lineItems = await db
    .select()
    .from(schema.invoiceLineItems)
    .where(eq(schema.invoiceLineItems.invoiceId, invoiceId))
    .orderBy(schema.invoiceLineItems.sortOrder)
  const payments = await db
    .select()
    .from(schema.invoicePayments)
    .where(eq(schema.invoicePayments.invoiceId, invoiceId))
    .orderBy(schema.invoicePayments.createdAt)

  const subtotal = computeTotal(lineItems)
  const total = round2(subtotal + Number(invoice.taxAmount || 0))
  const amountPaid = await getAmountPaid(invoiceId)
  const balanceDue = Math.max(0, round2(total - amountPaid))

  return { invoice, client, lineItems, payments, subtotal, total, amountPaid, balanceDue }
}

interface RecordPaymentOpts {
  amount: number
  method: 'cash' | 'check' | 'card' | 'stripe' | 'other'
  stripePaymentIntentId?: string
  note?: string
}

/**
 * Records a payment against an invoice, updates its status, and fires the
 * appropriate client/admin emails. Idempotent on stripePaymentIntentId -- Stripe
 * fires both checkout.session.completed and payment_intent.succeeded for the
 * same real-world payment, so a duplicate stripePaymentIntentId is a no-op
 * rather than a second ledger row (which would double-count revenue).
 */
export async function recordPayment(invoiceId: number, opts: RecordPaymentOpts): Promise<{ fullyPaid: boolean }> {
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1)
  if (!invoice) throw new InvoiceNotFoundError()
  if (invoice.status === 'paid') throw new InvoiceAlreadyPaidError()

  if (opts.stripePaymentIntentId) {
    const [existing] = await db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.stripePaymentIntentId, opts.stripePaymentIntentId))
      .limit(1)
    if (existing) {
      const totals = await getInvoiceTotals(invoiceId)
      return { fullyPaid: totals.balanceDue <= 0 }
    }
  }

  await db.insert(schema.invoicePayments).values({
    invoiceId,
    amount: String(round2(opts.amount)),
    method: opts.method,
    stripePaymentIntentId: opts.stripePaymentIntentId,
    note: opts.note,
  })

  const totals = await getInvoiceTotals(invoiceId)
  const fullyPaid = totals.balanceDue <= 0
  const numberLabel = invoiceNumber(invoice.id)

  await db
    .update(schema.invoices)
    .set({ status: fullyPaid ? 'paid' : 'partially_paid', paidAt: fullyPaid ? new Date() : null })
    .where(eq(schema.invoices.id, invoiceId))

  if (totals.client) {
    if (fullyPaid) {
      await sendReceiptToClient(totals.client.email, totals.client.name, numberLabel, formatMoney(totals.total))
      await notifyAdminInvoicePaid(totals.client.name, numberLabel, formatMoney(totals.total))
    } else {
      await sendPartialPaymentReceipt(totals.client.email, totals.client.name, numberLabel, formatMoney(round2(opts.amount)), formatMoney(totals.balanceDue))
      await notifyAdminPartialPaymentReceived(totals.client.name, numberLabel, formatMoney(round2(opts.amount)), formatMoney(totals.balanceDue))
    }
  }

  return { fullyPaid }
}

/**
 * Backward-compatible wrapper: with no opts, finishes off whatever balance is
 * currently owed (the original "Mark as Paid" behavior). Shared by the manual
 * admin action and the Stripe webhook so both paths behave identically.
 */
export async function markInvoicePaid(invoiceId: number, opts: Partial<RecordPaymentOpts> = {}): Promise<void> {
  const totals = await getInvoiceTotals(invoiceId)
  if (totals.invoice.status === 'paid') throw new InvoiceAlreadyPaidError()

  await recordPayment(invoiceId, {
    amount: opts.amount ?? totals.balanceDue,
    method: opts.method ?? 'other',
    stripePaymentIntentId: opts.stripePaymentIntentId,
    note: opts.note,
  })
}
