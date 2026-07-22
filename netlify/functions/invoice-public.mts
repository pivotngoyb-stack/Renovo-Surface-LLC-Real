import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { computeTotal, invoiceNumber } from './_shared/money.mts'
import { isStripeConfigured } from './_shared/stripe.mts'
import { json, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const token = context.params.token
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.token, token)).limit(1)
  if (!invoice) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)
  const lineItems = await db
    .select()
    .from(schema.invoiceLineItems)
    .where(eq(schema.invoiceLineItems.invoiceId, invoice.id))
    .orderBy(schema.invoiceLineItems.sortOrder)

  return json({
    invoice,
    client,
    lineItems,
    total: computeTotal(lineItems),
    invoiceNumber: invoiceNumber(invoice.id),
    stripeEnabled: isStripeConfigured(),
  })
}

export const config = {
  path: '/api/invoice/:token',
}
