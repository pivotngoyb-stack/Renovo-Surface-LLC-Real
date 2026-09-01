import { eq, asc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, badRequest } from './_shared/http.mts'
import { notifyAdminEstimateViewed, notifyAdminEstimateApproved, notifyAdminEstimateDeclined, notifyAdminWorkOrderCreationFailed } from './_shared/email.mts'
import { createWorkOrderForEstimate } from './_shared/workOrders.mts'
import { effectiveExpiry, isExpired } from './_shared/expiry.mts'
import { depositSplit } from './_shared/deposit.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { getClientIp } from './_shared/http.mts'
import { buildProposalScope } from './_shared/scopeLibrary.mts'
import { contractValue, buildScheduleMatrix, groupBySite, portfolioDiscountPct, frequencyOf } from './_shared/serviceSchedule.mts'
import { COMPANY, registrationRows, PREVAILING_WAGE_STATEMENTS } from './_shared/companyProfile.mts'
import { multiYearSchedule, executiveSummary } from './_shared/proposalDoc.mts'

export default async (request: Request, context: Context) => {
  const token = context.params.token
  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.token, token)).limit(1)
  if (!estimate) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)

  /*
   * Preview mode.
   *
   * Renovo needs to see exactly what the client sees before sending, and the
   * only way to do that was to open the client's own link -- which stamped
   * viewedAt, flipped the status from sent to viewed, and emailed Renovo to say
   * the client had opened it. Checking your own work should not fabricate a
   * record of the client checking it.
   *
   * Requires an admin session, so the flag cannot be used to read a proposal
   * without leaving the trail a real client leaves.
   */
  const preview = new URL(request.url).searchParams.get('preview') === '1' && isAuthenticated(request)

  if (request.method === 'GET') {
    if (!estimate.viewedAt && !preview) {
      estimate.viewedAt = new Date()
      if (estimate.status === 'sent') estimate.status = 'viewed'
      await db.update(schema.estimates).set({ viewedAt: estimate.viewedAt, status: estimate.status }).where(eq(schema.estimates.id, estimate.id))
      if (client) await notifyAdminEstimateViewed(client.name, estimate.id)
    }

    const [signature] = await db
      .select({
        signerName: schema.estimateSignatures.signerName,
        signerTitle: schema.estimateSignatures.signerTitle,
        signatureType: schema.estimateSignatures.signatureType,
        signatureData: schema.estimateSignatures.signatureData,
        signedAt: schema.estimateSignatures.signedAt,
      })
      .from(schema.estimateSignatures)
      .where(eq(schema.estimateSignatures.estimateId, estimate.id))
      .limit(1)

    const lineItems = await db
      .select()
      .from(schema.estimateLineItems)
      .where(eq(schema.estimateLineItems.estimateId, estimate.id))
      .orderBy(schema.estimateLineItems.sortOrder)

    // Walk-through photos. Only the token goes out: the blob key is internal
    // and would let anyone who saw it reason about the storage layout.
    const photos = await db
      .select({
        token: schema.estimatePhotos.token,
        caption: schema.estimatePhotos.caption,
      })
      .from(schema.estimatePhotos)
      .where(eq(schema.estimatePhotos.estimateId, estimate.id))
      .orderBy(asc(schema.estimatePhotos.sortOrder), asc(schema.estimatePhotos.id))

    // Scope, exclusions and assumptions are derived from the services actually
    // quoted, so the proposal can never describe work that is not on the bid.
    const proposal = buildProposalScope(lineItems.map(li => li.serviceType))
    const contract = contractValue(lineItems)
    const sites = groupBySite(lineItems)
    const isGovernment = estimate.bidMode === 'government'

    // Only computed for government bids: an option-year table on a commercial
    // proposal is noise, and a base-year label implies a solicitation exists.
    const multiYear = isGovernment ? multiYearSchedule(contract, estimate.optionYears) : null

    const summary = executiveSummary({
      serviceLabels: proposal.sections.map(sec => sec.label),
      contract,
      subtotal: lineItems.filter(li => !li.isOptional).reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0),
      projectName: estimate.projectName,
      siteAddress: estimate.siteAddress,
      siteCount: sites ? sites.length : 1,
      walkthroughDate: estimate.walkthroughDate,
      expiresOn: effectiveExpiry(estimate.validUntil, estimate.createdAt),
      frequencyLabels: [...new Set(lineItems.filter(li => !li.isOptional).map(li => frequencyOf(li.frequency)).filter(f => f.recurring).map(f => f.label))],
    })

    return json({
      estimate,
      client,
      lineItems,
      proposal,
      // Everything a recurring or multi-site bid needs to be comparable:
      // what it costs per year, what happens on which day, and which site
      // each line belongs to.
      contract,
      schedule: buildScheduleMatrix(lineItems),
      sites,
      portfolioDiscountPct: portfolioDiscountPct(new Set(lineItems.map(li => li.siteName).filter(Boolean)).size),
      summary,
      // The cover page needs Renovo's particulars on every proposal, not just
      // government ones. The government block below stays as it is: it carries
      // the registration rows a contracting officer screens on.
      company: COMPANY,
      photos,
      preview,
      // Shown back on the accepted document, so the client can see what they
      // signed rather than just being told the proposal was accepted.
      signature: signature || null,
      // Computed server-side so the proposal, the PDF and any future invoice
      // all split the same total the same way.
      deposit: depositSplit(
        lineItems.filter(li => !li.isOptional).reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
          + (estimate.taxApplied ? Number(estimate.taxAmount) : 0),
        estimate.depositPct,
      ),
      government: isGovernment ? {
        company: COMPANY,
        registration: registrationRows(),
        multiYear,
        prevailingWage: estimate.prevailingWage,
        prevailingWageStatements: estimate.prevailingWage ? PREVAILING_WAGE_STATEMENTS : [],
        solicitationNumber: estimate.solicitationNumber,
      } : null,
      // Server owns these so the date shown and the date enforced always agree.
      expiresOn: effectiveExpiry(estimate.validUntil, estimate.createdAt),
      expired: isExpired(estimate.validUntil, estimate.createdAt),
    })
  }

  if (request.method === 'POST') {
    if (estimate.status === 'approved' || estimate.status === 'declined') {
      return badRequest('This estimate has already been responded to')
    }

    let body: {
      action?: 'approve' | 'decline'
      signerName?: unknown
      poNumber?: unknown
      signerTitle?: unknown
      signatureType?: unknown
      signatureData?: unknown
      consentConfirmed?: unknown
    }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    // Belt and braces: the preview page disables the buttons, but a POST
    // must not be able to accept a proposal on the client's behalf either.
    if (new URL(request.url).searchParams.get('preview') === '1') {
      return badRequest('This is a preview. Send the proposal and let the client accept it themselves.')
    }

    if (body.action === 'approve') {
      // An expired estimate must not be approvable -- approval auto-creates a
      // work order, so this would commit the crew at months-old pricing.
      if (isExpired(estimate.validUntil, estimate.createdAt)) {
        return badRequest('This estimate expired on ' + effectiveExpiry(estimate.validUntil, estimate.createdAt) + '. Please contact us for an updated quote.')
      }

      /*
       * Acceptance is a signature, not a button press.
       *
       * The PDF has printed "Accepted by (signature)" since it was built, and
       * Renovo's own estimate template carries a signature line. A click that
       * records a name nobody typed is weaker than either, and it is the
       * document that gets produced if the job is ever disputed.
       */
      if (!body.signerName || !String(body.signerName).trim()) {
        return badRequest('Please enter your name as it should appear on the acceptance')
      }
      if (!body.signatureData) return badRequest('Please sign to accept this proposal')
      if (body.signatureType !== 'drawn' && body.signatureType !== 'typed') {
        return badRequest('Invalid signature type')
      }
      if (!body.consentConfirmed) {
        return badRequest('Please confirm you consent to sign electronically')
      }

      const [alreadySigned] = await db
        .select({ id: schema.estimateSignatures.id })
        .from(schema.estimateSignatures)
        .where(eq(schema.estimateSignatures.estimateId, estimate.id))
        .limit(1)

      if (!alreadySigned) {
        await db.insert(schema.estimateSignatures).values({
          estimateId: estimate.id,
          signerName: String(body.signerName).trim().slice(0, 120),
          signerTitle: body.signerTitle ? String(body.signerTitle).trim().slice(0, 120) : null,
          signatureType: body.signatureType,
          signatureData: String(body.signatureData),
          consentConfirmed: true,
          ipAddress: getClientIp(request),
        })
      }

      /*
       * A PO given at acceptance wins over anything Renovo typed in earlier.
       * The client is the only party who knows what their own AP department
       * will accept, and acceptance is usually the moment the number exists.
       */
      const acceptedPo = typeof body.poNumber === 'string' && body.poNumber.trim()
        ? body.poNumber.trim().slice(0, 60)
        : estimate.poNumber

      await db.update(schema.estimates)
        .set({ status: 'approved', approvedAt: new Date(), poNumber: acceptedPo })
        .where(eq(schema.estimates.id, estimate.id))
      if (client) await notifyAdminEstimateApproved(client.name, estimate.id)
      // The client has just been told we will contact them within two hours.
      // If the work order does not get created, that promise is outstanding and
      // nobody knows -- this used to reach console.error and stop there.
      try {
        const workOrder = await createWorkOrderForEstimate(estimate.id)
        if (!workOrder) {
          // No throw, but nothing created either. Every early return in that
          // helper is a real problem at this point in the flow: the estimate is
          // approved and has a client, so a null means a duplicate work order
          // or a row that vanished underneath us.
          await notifyAdminWorkOrderCreationFailed(
            client ? client.name : `estimate #${estimate.id}`,
            estimate.id,
            'The estimate was approved but no work order was produced. It may already have one.',
          )
        }
      } catch (err) {
        console.error(`[estimate-public] auto work-order creation failed for estimate ${estimate.id}`, err)
        // Alerting must not itself break the client's acceptance.
        try {
          await notifyAdminWorkOrderCreationFailed(
            client ? client.name : `estimate #${estimate.id}`,
            estimate.id,
            err instanceof Error ? err.message : String(err),
          )
        } catch (alertErr) {
          console.error(`[estimate-public] could not alert admin for estimate ${estimate.id}`, alertErr)
        }
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
