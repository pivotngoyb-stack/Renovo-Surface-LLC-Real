import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { computeTotal, formatMoney, invoiceNumber } from './_shared/money.mts'
import { sendInvoiceToClient } from './_shared/email.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid invoice id')

  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1)
  if (!invoice) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)
  if (!client) return notFound()

  const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id))
  const total = computeTotal(lineItems)

  await sendInvoiceToClient(client.email, client.name, invoice.token, invoiceNumber(invoice.id), formatMoney(total))

  return json({ ok: true })
}

export const config = {
  path: '/api/admin/invoices/:id/send',
}
