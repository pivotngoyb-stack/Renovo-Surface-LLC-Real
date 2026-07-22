import Stripe from 'stripe'

let client: Stripe | null = null

/** Returns a Stripe client, or null if STRIPE_SECRET_KEY hasn't been set yet. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  if (!client) client = new Stripe(key)
  return client
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}
