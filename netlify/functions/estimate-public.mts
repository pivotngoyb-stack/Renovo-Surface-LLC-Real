import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, badRequest } from './_shared/http.mts'
import { notifyAdminEstimateViewed, notifyAdminEstimateApproved, notifyAdminEstimateDeclined } from './_shared/email.mts'

export default async (request: Request, context: Context) => {
  const token = context.params.token
  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.token, token)).limit(1)
  if (!estimate) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)

  if (request.method === 'GET') {
    if (!estimate.viewedAt) {
      estimate.viewedAt = new Date()
      if (estimate.status === 'sent') estimate.status = 'viewed'
      await db.update(schema.estimates).set({ viewedAt: estimate.viewedAt, status: estimate.status }).where(eq(schema.estimates.id, estimate.id))
      if (client) await notifyAdminEstimateViewed(client.name, estimate.id)
    }

    const lineItems = await db
      .select()
      .from(schema.estimateLineItems)
      .where(eq(schema.estimateLineItems.estimateId, estimate.id))
      .orderBy(schema.estimateLineItems.sortOrder)

    return json({ estimate, client, lineItems })
  }

  if (request.method === 'POST') {
    if (estimate.status === 'approved' || estimate.status === 'declined') {
      return badRequest('This estimate has already been responded to')
    }

    let body: { action?: 'approve' | 'decline' }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (body.action === 'approve') {
      await db.update(schema.estimates).set({ status: 'approved', approvedAt: new Date() }).where(eq(schema.estimates.id, estimate.id))
      if (client) await notifyAdminEstimateApproved(client.name, estimate.id)
      return json({ ok: true, status: 'approved' })
    }

    if (body.action === 'decline') {
      await db.update(schema.estimates).set({ status: 'declined' }).where(eq(schema.estimates.id, estimate.id))
      if (client) await notifyAdminEstimateDeclined(client.name, estimate.id)
      return json({ ok: true, status: 'declined' })
    }

    return badRequest('action must be "approve" or "decline"')
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/estimate/:token',
}
