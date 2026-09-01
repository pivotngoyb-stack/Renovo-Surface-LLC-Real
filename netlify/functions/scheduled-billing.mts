import { eq, and, lt, gte, isNotNull } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { generateToken } from './_shared/tokens.mts'
import { getStripe } from './_shared/stripe.mts'
import { markInvoicePaid, InvoiceAlreadyPaidError, InvoiceNotFoundError } from './_shared/invoices.mts'
import {
  sendRecurringInvoiceToClient,
  sendOverdueReminder,
  notifyAdminInvoiceOverdue,
  notifyAdminAutoChargeFailed,
  notifyAdminFunctionError,
} from './_shared/email.mts'
import { formatMoney, invoiceNumber } from './_shared/money.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

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
    .where(and(eq(schema.recurringContracts.status, 'active'), eq(schema.recurringContracts.archived, false)))

  const dueToday = activeContracts.filter((c) => {
    if (c.billingDay !== todayDay) return false
    if (c.lastBilledAt && isSameMonth(new Date(c.lastBilledAt), today)) return false
    return true
  })

  let generated = 0
  for (const contract of dueToday) {
    // Isolate each contract's billing so one bad row (a DB hiccup, a malformed
    // client record) doesn't stop every remaining client in today's batch from
    // being billed.
    try {
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

      /*
       * Say which visits the charge covers.
       *
       * A monthly invoice against a weekly contract is four visits behind one
       * number. Billed as a bare "Recurring: <contract>" it asks the client to
       * take the amount on trust, and gives Renovo nothing to point at when
       * they query it. The visits are on record now, so the invoice can name
       * the dates it is for.
       *
       * Only completed visits are named. Listing a date the crew has not been
       * to yet would bill work that has not happened, and if it then gets
       * missed the invoice says it was done.
       */
      /*
       * Everything finished since the last invoice. On a contract that has
       * never billed, the start of this month -- billing runs monthly, so
       * anything older belongs to a period nobody is charging for.
       */
      const periodStart = contract.lastBilledAt
        ? new Date(contract.lastBilledAt)
        : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

      const covered = await db
        .select({ scheduledDate: schema.workOrders.scheduledDate })
        .from(schema.workOrders)
        .where(and(
          eq(schema.workOrders.recurringContractId, contract.id),
          eq(schema.workOrders.kind, 'visit'),
          eq(schema.workOrders.status, 'completed'),
          isNotNull(schema.workOrders.completedAt),
          gte(schema.workOrders.completedAt, periodStart),
        ))
        .orderBy(schema.workOrders.scheduledDate)

      const visitDates = covered.map(v => v.scheduledDate).filter(Boolean) as string[]
      const description = visitDates.length
        ? `${contract.description} - ${visitDates.length} ${visitDates.length === 1 ? 'visit' : 'visits'}: ${visitDates.join(', ')}`
        : contract.description

      await db.insert(schema.invoiceLineItems).values({
        invoiceId: invoice.id,
        description,
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
    } catch (err) {
      const message = err instanceof Error ? (err.stack || err.message) : String(err)
      console.error(`[scheduled-billing] billing generation failed for contract ${contract.id}`, err)
      await notifyAdminFunctionError(`scheduled-billing (contract ${contract.id})`, message, 'recurring billing generation').catch(() => {})
    }
  }

  return { generated }
}

async function runOverdueReminders(today: Date): Promise<{ reminded: number }> {
  const todayStr = toDateOnly(today)
  const unpaidPastDue = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, 'unpaid'), lt(schema.invoices.dueDate, todayStr), eq(schema.invoices.archived, false)))

  let reminded = 0
  for (const invoice of unpaidPastDue) {
    try {
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
    } catch (err) {
      const message = err instanceof Error ? (err.stack || err.message) : String(err)
      console.error(`[scheduled-billing] overdue reminder failed for invoice ${invoice.id}`, err)
      await notifyAdminFunctionError(`scheduled-billing (invoice ${invoice.id})`, message, 'overdue reminder processing').catch(() => {})
    }
  }

  return { reminded }
}

export default withErrorHandling('scheduled-billing', async (req: Request) => {
  const today = new Date()
  const billingResult = await runRecurringBilling(today)
  const reminderResult = await runOverdueReminders(today)

  console.log(`[scheduled-billing] generated=${billingResult.generated} reminded=${reminderResult.reminded}`)

  return new Response(
    JSON.stringify({ ok: true, ...billingResult, ...reminderResult }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})

export const config = {
  schedule: '0 13 * * *',
}
