import { eq, and, lt } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { generateToken } from './_shared/tokens.mts'
import { getStripe } from './_shared/stripe.mts'
import { markInvoicePaid, InvoiceAlreadyPaidError, InvoiceNotFoundError } from './_shared/invoices.mts'
import {
  sendRecurringInvoiceToClient,
  sendOverdueReminder,
  notifyAdminInvoiceOverdue,
  notifyAdminAutoChargeFailed,
} from './_shared/email.mts'
import { formatMoney, invoiceNumber } from './_shared/money.mts'

const DUE_DAYS = 15 // net-15 terms for recurring invoices

function isSameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type Contract = typeof schema.recurringContracts.$inferSelect
type Client = typeof schema.clients.$inferSelect

/**
 * Charges the client's saved card off-session for a freshly generated recurring
 * invoice. If it fails for any reason (card declined, expired, etc.) we leave the
 * invoice as a normal unpaid invoice - the email already sent lets the client pay
 * manually, and we notify the admin so they know the auto-charge didn't go through.
 */
async function attemptAutoCharge(contract: Contract, client: Client, invoiceId: number): Promise<void> {
  const stripe = getStripe()
  if (!stripe || !client.stripeCustomerId || !contract.stripePaymentMethodId) return

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(contract.amount) * 100),
      currency: 'usd',
      customer: client.stripeCustomerId,
      payment_method: contract.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: { invoiceId: String(invoiceId), recurringContractId: String(contract.id) },
    })

    if (paymentIntent.status === 'succeeded') {
      try {
        await markInvoicePaid(invoiceId)
      } catch (err) {
        if (!(err instanceof InvoiceAlreadyPaidError) && !(err instanceof InvoiceNotFoundError)) throw err
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[scheduled-billing] auto-charge failed for contract ${contract.id}`, err)
    await notifyAdminAutoChargeFailed(client.name, invoiceId, message)
  }
}

async function runRecurringBilling(today: Date): Promise<{ generated: number }> {
  const todayDay = today.getUTCDate()

  const activeContracts = await db
    .select()
    .from(schema.recurringContracts)
    .where(eq(schema.recurringContracts.status, 'active'))

  const dueToday = activeContracts.filter((c) => {
    if (c.billingDay !== todayDay) return false
    if (c.lastBilledAt && isSameMonth(new Date(c.lastBilledAt), today)) return false
    return true
  })

  let generated = 0
  for (const contract of dueToday) {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, contract.clientId)).limit(1)
    if (!client) continue

    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        clientId: contract.clientId,
        recurringContractId: contract.id,
        token: generateToken(),
        status: 'unpaid',
        dueDate: toDateOnly(addDays(today, DUE_DAYS)),
        notes: `Recurring: ${contract.description}`,
      })
      .returning()

    await db.insert(schema.invoiceLineItems).values({
      invoiceId: invoice.id,
      description: contract.description,
      quantity: '1',
      unitPrice: contract.amount,
    })

    await db.update(schema.recurringContracts).set({ lastBilledAt: today }).where(eq(schema.recurringContracts.id, contract.id))

    await sendRecurringInvoiceToClient(
      client.email,
      client.name,
      invoice.token,
      invoiceNumber(invoice.id),
      formatMoney(Number(contract.amount)),
      contract.description,
    )

    if (contract.autoChargeEnabled && contract.stripePaymentMethodId) {
      await attemptAutoCharge(contract, client, invoice.id)
    }

    generated++
  }

  return { generated }
}

async function runOverdueReminders(today: Date): Promise<{ reminded: number }> {
  const todayStr = toDateOnly(today)
  const unpaidPastDue = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, 'unpaid'), lt(schema.invoices.dueDate, todayStr)))

  let reminded = 0
  for (const invoice of unpaidPastDue) {
    if (!invoice.dueDate) continue
    const daysOverdue = Math.floor((today.getTime() - new Date(invoice.dueDate).getTime()) / 86_400_000)

    let targetStage = 0
    if (daysOverdue >= 14) targetStage = 3
    else if (daysOverdue >= 7) targetStage = 2
    else if (daysOverdue >= 3) targetStage = 1

    if (targetStage === 0 || invoice.reminderStage >= targetStage) continue

    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)
    if (!client) continue

    const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoice.id))
    const total = lineItems.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
    const totalLabel = formatMoney(total)
    const numberLabel = invoiceNumber(invoice.id)

    await sendOverdueReminder(client.email, client.name, invoice.token, numberLabel, totalLabel, targetStage)
    await notifyAdminInvoiceOverdue(client.name, numberLabel, totalLabel, daysOverdue)

    await db
      .update(schema.invoices)
      .set({ reminderStage: targetStage, lastReminderSentAt: today })
      .where(eq(schema.invoices.id, invoice.id))

    reminded++
  }

  return { reminded }
}

export default async (req: Request) => {
  const today = new Date()
  const billingResult = await runRecurringBilling(today)
  const reminderResult = await runOverdueReminders(today)

  console.log(`[scheduled-billing] generated=${billingResult.generated} reminded=${reminderResult.reminded}`)

  return new Response(
    JSON.stringify({ ok: true, ...billingResult, ...reminderResult }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}

export const config = {
  schedule: '0 13 * * *',
}
