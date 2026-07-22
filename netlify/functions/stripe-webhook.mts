import type Stripe from 'stripe'
import { getStripe } from './_shared/stripe.mts'
import { markInvoicePaid, InvoiceAlreadyPaidError, InvoiceNotFoundError } from './_shared/invoices.mts'
import { json, badRequest } from './_shared/http.mts'

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

  // Signature verification requires the exact raw request body — never parse
  // it as JSON before this point.
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe webhook] signature verification failed', err)
    return badRequest('Invalid signature')
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const invoiceId = Number(session.metadata?.invoiceId)

    if (!Number.isInteger(invoiceId)) {
      console.error('[stripe webhook] checkout.session.completed missing invoiceId metadata', session.id)
      return json({ received: true })
    }

    try {
      await markInvoicePaid(invoiceId)
    } catch (err) {
      // Already-paid is expected if Stripe retries the webhook - not an error.
      if (!(err instanceof InvoiceAlreadyPaidError)) {
        if (err instanceof InvoiceNotFoundError) {
          console.error('[stripe webhook] invoice not found for id', invoiceId)
        } else {
          console.error('[stripe webhook] failed to mark invoice paid', err)
          return json({ error: 'Failed to process payment' }, { status: 500 })
        }
      }
    }
  }

  return json({ received: true })
}

export const config = {
  path: '/api/stripe-webhook',
}
