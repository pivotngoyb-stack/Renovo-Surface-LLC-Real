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

/** Finds an existing Stripe Customer for this email, or creates one. */
export async function getOrCreateStripeCustomer(stripe: Stripe, email: string, name: string): Promise<string> {
  const existing = await stripe.customers.list({ email, limit: 1 })
  if (existing.data.length > 0) return existing.data[0].id
  const created = await stripe.customers.create({ email, name })
  return created.id
}
