import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { computeTotal, formatMoney, invoiceNumber } from './_shared/money.mts'
import { sendReceiptToClient, notifyAdminInvoicePaid } from './_shared/email.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid invoice id')

  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1)
  if (!invoice) return notFound()
  if (invoice.status === 'paid') return badRequest('This invoice is already marked paid')

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)
  const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id))
  const total = computeTotal(lineItems)
  const numberLabel = invoiceNumber(invoice.id)
  const totalLabel = formatMoney(total)

  await db.update(schema.invoices).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.invoices.id, id))

  if (client) {
    await sendReceiptToClient(client.email, client.name, numberLabel, totalLabel)
    await notifyAdminInvoicePaid(client.name, numberLabel, totalLabel)
  }

  return json({ ok: true })
}

export const config = {
  path: '/api/admin/invoices/:id/mark-paid',
}
