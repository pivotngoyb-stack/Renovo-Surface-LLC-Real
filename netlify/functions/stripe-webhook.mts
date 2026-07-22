import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getStripe } from './_shared/stripe.mts'
import { db, schema } from './_shared/db.mts'
import { markInvoicePaid, InvoiceAlreadyPaidError, InvoiceNotFoundError } from './_shared/invoices.mts'
import { notifyAdminAutoChargeFailed } from './_shared/email.mts'
import { json, badRequest } from './_shared/http.mts'

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
  const invoiceId = Number(session.metadata?.invoiceId)
  if (!Number.isInteger(invoiceId)) {
    console.error('[stripe webhook] checkout.session.completed missing invoiceId metadata', session.id)
    return
  }

  try {
    await markInvoicePaid(invoiceId)
  } catch (err) {
    if (!(err instanceof InvoiceAlreadyPaidError)) {
      if (err instanceof InvoiceNotFoundError) {
        console.error('[stripe webhook] invoice not found for id', invoiceId)
      } else {
        throw err
      }
    }
  }

  // If the client consented to save their card for this recurring contract,
  // pull the payment method off the completed session and store it.
  const recurringContractId = Number(session.metadata?.recurringContractId)
  const saveCard = session.metadata?.saveCard === 'true'
  if (saveCard && Number.isInteger(recurringContractId) && session.payment_intent) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string)
      const paymentMethodId = typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent.payment_method?.id

      if (paymentMethodId) {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
        await db
          .update(schema.recurringContracts)
          .set({
            autoChargeEnabled: true,
            stripePaymentMethodId: paymentMethodId,
            cardBrand: pm.card?.brand || null,
            cardLast4: pm.card?.last4 || null,
          })
          .where(eq(schema.recurringContracts.id, recurringContractId))
      }
    } catch (err) {
      console.error('[stripe webhook] failed to save payment method for contract', recurringContractId, err)
    }
  }
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const invoiceId = Number(paymentIntent.metadata?.invoiceId)
  if (!Number.isInteger(invoiceId)) return // not one of our off-session auto-charges

  try {
    await markInvoicePaid(invoiceId)
  } catch (err) {
    if (!(err instanceof InvoiceAlreadyPaidError) && !(err instanceof InvoiceNotFoundError)) throw err
  }
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  const invoiceId = Number(paymentIntent.metadata?.invoiceId)
  if (!Number.isInteger(invoiceId)) return

  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1)
  if (!invoice) return
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId)).limit(1)

  await notifyAdminAutoChargeFailed(client?.name || 'Unknown client', invoiceId, paymentIntent.last_payment_error?.message || 'Unknown reason')
}

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !webhookSecret) {
    console.error('[stripe webhook] received an event but Stripe is not fully configured')
    return json({ error: 'Stripe is not configured' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return badRequest('Missing stripe-signature header')

  // Signature verification requires the exact raw request body - never parse
  // it as JSON before this point.
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe webhook] signature verification failed', err)
    return badRequest('Invalid signature')
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session)
    } else if (event.type === 'payment_intent.succeeded') {
      await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
    } else if (event.type === 'payment_intent.payment_failed') {
      await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
    }
  } catch (err) {
    console.error(`[stripe webhook] failed to process ${event.type}`, err)
    return json({ error: 'Failed to process event' }, { status: 500 })
  }

  return json({ received: true })
}

export const config = {
  path: '/api/stripe-webhook',
}
