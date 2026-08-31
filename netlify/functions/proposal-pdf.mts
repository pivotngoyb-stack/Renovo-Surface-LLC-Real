import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { notFound } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { effectiveExpiry, isExpired } from './_shared/expiry.mts'
import { depositSplit } from './_shared/deposit.mts'
import { buildProposalScope } from './_shared/scopeLibrary.mts'
import { contractValue, groupBySite, frequencyOf } from './_shared/serviceSchedule.mts'
import { COMPANY } from './_shared/companyProfile.mts'
import { executiveSummary } from './_shared/proposalDoc.mts'
import { generateProposalPdf } from './_shared/proposalPdf.mts'

/**
 * The proposal as a downloadable PDF.
 *
 * Reachable with the proposal token and nothing else, exactly like the web
 * proposal it mirrors: the client already has the link, and requiring a login
 * to download the document they were sent would be absurd.
 *
 * Unlike the web route this does NOT mark the estimate viewed. A download is
 * not a read -- a procurement system fetching attachments would otherwise
 * report the buyer as having opened a bid nobody has looked at.
 */

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' })

const proposalNumber = (id: number) => 'EST-' + (1000 + id)

export default withErrorHandling('proposal-pdf', async (request: Request, context: Context) => {
  const token = context.params.token
  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.token, token)).limit(1)
  if (!estimate) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)

  const lineItems = await db
    .select()
    .from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, estimate.id))
    .orderBy(schema.estimateLineItems.sortOrder)

  // The same helpers the HTML proposal calls. Rebuilding the content here is
  // how the PDF and the web page would come to describe different jobs.
  const scope = buildProposalScope(lineItems.map(li => li.serviceType))
  const contract = contractValue(lineItems)

  const base = lineItems.filter(li => !li.isOptional)
  const optional = lineItems.filter(li => li.isOptional)
  const lineTotal = (li: typeof lineItems[number]) => Number(li.quantity) * Number(li.unitPrice)
  const subtotal = base.reduce((s, li) => s + lineTotal(li), 0)
  const optionalTotal = optional.reduce((s, li) => s + lineTotal(li), 0)
  const taxAmount = estimate.taxApplied ? Number(estimate.taxAmount) : 0

  const expiresOn = effectiveExpiry(estimate.validUntil, estimate.createdAt)
  const sites = groupBySite(lineItems)

  // Exactly the arguments estimate-public passes. The summary is the first
  // thing a buyer reads; the two documents saying different things about the
  // same job would be worse than either of them being slightly wrong.
  const summary = executiveSummary({
    serviceLabels: scope.sections.map(sec => sec.label),
    contract,
    subtotal,
    projectName: estimate.projectName,
    siteAddress: estimate.siteAddress,
    siteCount: sites ? sites.length : 1,
    walkthroughDate: estimate.walkthroughDate,
    expiresOn,
    frequencyLabels: [...new Set(
      base.map(li => frequencyOf(li.frequency)).filter(f => f.recurring).map(f => f.label),
    )],
  })

  /*
   * Payment terms, stated on the document rather than left to a phone call.
   * The samples Renovo already sends carry these; a late fee that appears
   * nowhere on the paperwork is a late fee that does not get collected.
   */
  const paymentTerms = [
    'Payment is due within 14 days of the invoice date. A 1.5% monthly late fee applies to balances more than 30 days past due.',
    'Accepted payment methods: ACH transfer, check, or card. A processing fee applies to card payments.',
  ]

  // What the reader should do with this document, in the position the
  // invoices put PAID or DUE ON RECEIPT.
  const statusLine = isExpired(estimate.validUntil, estimate.createdAt)
    ? 'Expired - contact us for an updated quote'
    : estimate.status === 'approved'
      ? 'Accepted - work order to follow'
      : 'Proposal - valid 30 days'

  const bytes = await generateProposalPdf({
    proposalNumber: proposalNumber(estimate.id),
    issuedDate: fmtDate(estimate.createdAt),
    expiresDate: fmtDate(new Date(expiresOn + 'T12:00:00')),
    walkthroughDate: estimate.walkthroughDate ? fmtDate(new Date(estimate.walkthroughDate + 'T12:00:00')) : null,
    solicitationNumber: estimate.bidMode === 'government' ? estimate.solicitationNumber : null,
    company: COMPANY,
    client: client || null,
    projectName: estimate.projectName || client?.company || 'Service Proposal',
    siteAddress: estimate.siteAddress || client?.propertyAddress || '',
    summary,
    scope,
    siteConditions: estimate.siteConditions,
    lineItems,
    subtotal,
    taxApplied: estimate.taxApplied,
    taxAmount,
    total: subtotal + taxAmount,
    optionalTotal,
    contract,
    notes: estimate.notes,
    statusLine,
    paymentTerms,
    deposit: depositSplit(subtotal + taxAmount, estimate.depositPct),
  })

  const filename = `${proposalNumber(estimate.id)}-Renovo-Proposal.pdf`

  // Attachment by default, because a procurement portal wants a file on disk.
  // ?view=1 renders it in the browser instead, for a client who would rather
  // read it than download it.
  const inline = new URL(request.url).searchParams.get('view') === '1'

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      // A proposal can be revised in place, so this must not be cached hard the
      // way an immutable photo is.
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
})

export const config = {
  path: '/api/proposal/:token/pdf',
}
