import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import type Stripe from 'stripe'
import { db, schema } from './_shared/db.mts'
import { getStripe, isStripeConfigured, getOrCreateStripeCustomer } from './_shared/stripe.mts'
import { invoiceNumber } from './_shared/money.mts'
import { json, notFound, badRequest } from './_shared/http.mts'

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  if (!isStripeConfigured()) {
    return json({ error: 'Online payment is not set up yet. Please use the payment instructions on this page.' }, { status: 503 })
  }

  const token = context.params.token
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.token, token)).limit(1)
  if (!invoice) return notFound()
  if (invoice.status === 'paid') return badRequest('This invoice has already been paid')

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)
  const lineItems = await db
    .select()
    .from(schema.invoiceLineItems)
    .where(eq(schema.invoiceLineItems.invoiceId, invoice.id))
    .orderBy(schema.invoiceLineItems.sortOrder)

  if (lineItems.length === 0) return badRequest('This invoice has no line items')

  let body: { saveCard?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // no body is fine, saveCard just defaults to false
  }

  // Only offer to save a card for invoices tied to a recurring contract -
  // there's nothing to "save for future use" on a one-off invoice.
  const canSaveCard = Boolean(invoice.recurringContractId) && body.saveCard === true

  // Prices are never pre-registered in Stripe (they change per job). Each Stripe
  // Checkout line here is built fresh, right now, from our own database — and we
  // collapse quantity x unit price into one line-total amount with quantity 1,
  // since our quantities can be fractional (e.g. 1.5 hours) and Stripe Checkout
  // line items only accept whole-number quantities.
  const stripeLineItems = lineItems.map((li) => {
    const qty = Number(li.quantity)
    const unitPrice = Number(li.unitPrice)
    const lineTotalCents = Math.round(qty * unitPrice * 100)
    const label = qty === 1 ? li.description : `${li.description} (Qty: ${qty})`
    return {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: lineTotalCents,
        product_data: { name: label },
      },
    }
  })

  const stripe = getStripe()!
  const numberLabel = invoiceNumber(invoice.id)

  const metadata: Record<string, string> = {
    invoiceId: String(invoice.id),
    invoiceToken: token,
    invoiceNumber: numberLabel,
  }
  if (invoice.recurringContractId) metadata.recurringContractId = String(invoice.recurringContractId)
  if (canSaveCard) metadata.saveCard = 'true'

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    line_items: stripeLineItems,
    success_url: `${SITE_URL}/invoice.html?t=${token}&paid=1`,
    cancel_url: `${SITE_URL}/invoice.html?t=${token}`,
    metadata,
  }

  try {
    if (canSaveCard && client) {
      const customerId = await getOrCreateStripeCustomer(stripe, client.email, client.name)
      if (!client.stripeCustomerId) {
        await db.update(schema.clients).set({ stripeCustomerId: customerId }).where(eq(schema.clients.id, client.id))
      }
      sessionParams.customer = customerId
      sessionParams.payment_intent_data = { setup_future_usage: 'off_session' }
    } else {
      sessionParams.customer_email = client?.email
    }

    const session = await stripe.checkout.sessions.create(sessionParams)
    return json({ url: session.url })
  } catch (err) {
    console.error('[stripe] checkout session creation failed', err)
    return json({ error: 'Could not start checkout. Please try again or use the payment instructions on this page.' }, { status: 500 })
  }
}

export const config = {
  path: '/api/invoice/:token/checkout',
}
