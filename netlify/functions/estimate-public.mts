import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, badRequest } from './_shared/http.mts'
import { notifyAdminEstimateViewed, notifyAdminEstimateApproved, notifyAdminEstimateDeclined } from './_shared/email.mts'
import { createWorkOrderForEstimate } from './_shared/workOrders.mts'
import { effectiveExpiry, isExpired } from './_shared/expiry.mts'
import { buildProposalScope } from './_shared/scopeLibrary.mts'
import { contractValue, buildScheduleMatrix, groupBySite, portfolioDiscountPct } from './_shared/serviceSchedule.mts'

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

    // Scope, exclusions and assumptions are derived from the services actually
    // quoted, so the proposal can never describe work that is not on the bid.
    const proposal = buildProposalScope(lineItems.map(li => li.serviceType))

    return json({
      estimate,
      client,
      lineItems,
      proposal,
      // Everything a recurring or multi-site bid needs to be comparable:
      // what it costs per year, what happens on which day, and which site
      // each line belongs to.
      contract: contractValue(lineItems),
      schedule: buildScheduleMatrix(lineItems),
      sites: groupBySite(lineItems),
      portfolioDiscountPct: portfolioDiscountPct(new Set(lineItems.map(li => li.siteName).filter(Boolean)).size),
      // Server owns these so the date shown and the date enforced always agree.
      expiresOn: effectiveExpiry(estimate.validUntil, estimate.createdAt),
      expired: isExpired(estimate.validUntil, estimate.createdAt),
    })
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
      // An expired estimate must not be approvable -- approval auto-creates a
      // work order, so this would commit the crew at months-old pricing.
      if (isExpired(estimate.validUntil, estimate.createdAt)) {
        return badRequest('This estimate expired on ' + effectiveExpiry(estimate.validUntil, estimate.createdAt) + '. Please contact us for an updated quote.')
      }

      await db.update(schema.estimates).set({ status: 'approved', approvedAt: new Date() }).where(eq(schema.estimates.id, estimate.id))
      if (client) await notifyAdminEstimateApproved(client.name, estimate.id)
      try {
        await createWorkOrderForEstimate(estimate.id)
      } catch (err) {
        console.error(`[estimate-public] auto work-order creation failed for estimate ${estimate.id}`, err)
      }
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
