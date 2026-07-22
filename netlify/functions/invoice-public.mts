import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { computeTotal, invoiceNumber } from './_shared/money.mts'
import { isStripeConfigured } from './_shared/stripe.mts'
import { json, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  const token = context.params.token
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.token, token)).limit(1)
  if (!invoice) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)

  let contract = null
  if (invoice.recurringContractId) {
    const [c] = await db.select().from(schema.recurringContracts).where(eq(schema.recurringContracts.id, invoice.recurringContractId)).limit(1)
    contract = c || null
  }

  if (request.method === 'GET') {
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
      recurring: contract
        ? {
            autoChargeEnabled: contract.autoChargeEnabled,
            cardBrand: contract.cardBrand,
            cardLast4: contract.cardLast4,
          }
        : null,
    })
  }

  if (request.method === 'POST') {
    let body: { action?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (body.action === 'disable-autocharge') {
      if (!contract) return badRequest('This invoice is not part of a recurring contract')
      await db
        .update(schema.recurringContracts)
        .set({ autoChargeEnabled: false, stripePaymentMethodId: null, cardBrand: null, cardLast4: null })
        .where(eq(schema.recurringContracts.id, contract.id))
      return json({ ok: true })
    }

    return badRequest('Unknown action')
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/invoice/:token',
}
