import { eq } from 'drizzle-orm'
import { db, schema } from './db.mts'
import { effectiveExpiry, isExpired } from './expiry.mts'
import { buildProposalScope } from './scopeLibrary.mts'
import { contractValue, groupBySite, frequencyOf } from './serviceSchedule.mts'
import { COMPANY } from './companyProfile.mts'
import { executiveSummary } from './proposalDoc.mts'
import { depositSplit } from './deposit.mts'
import { generateProposalPdf } from './proposalPdf.mts'

/**
 * Assembles the proposal PDF for an estimate.
 *
 * Lives here rather than in the download route because two callers need it: the
 * route a client clicks, and the email that goes out when a proposal is sent. A
 * client should never be able to hold two documents for the same job that say
 * different things, and the surest way to guarantee that is one assembly.
 *
 * Everything below comes from the shared helpers the HTML proposal also uses,
 * so the web page and the PDF stay in step as well.
 */

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' })

export const proposalNumber = (id: number) => 'EST-' + (1000 + id)

export function proposalFilename(id: number) {
  return `${proposalNumber(id)}-Renovo-Proposal.pdf`
}

type Estimate = typeof schema.estimates.$inferSelect
type Client = typeof schema.clients.$inferSelect

/** Payment terms, stated on the document rather than left to a phone call. */
const PAYMENT_TERMS = [
  'Payment is due within 14 days of the invoice date. A 1.5% monthly late fee applies to balances more than 30 days past due.',
  'Accepted payment methods: ACH transfer, check, or card. A processing fee applies to card payments.',
]

export async function buildProposalPdf(estimate: Estimate, client: Client | null): Promise<Uint8Array> {
  const lineItems = await db
    .select()
    .from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, estimate.id))
    .orderBy(schema.estimateLineItems.sortOrder)

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
   * What the reader should do with this, in the position the invoices put PAID
   * or DUE ON RECEIPT.
   *
   * The validity period is measured, not assumed. The builder lets any expiry
   * date be set, so a hardcoded "valid 30 days" sat directly above a Valid
   * Through date fourteen days out and contradicted it -- on the one document
   * a procurement officer reads closely.
   */
  const issuedDay = new Date(estimate.createdAt)
  const expiryDay = new Date(expiresOn + 'T12:00:00')
  const validDays = Math.max(
    1,
    Math.round((expiryDay.getTime() - issuedDay.getTime()) / 86400000),
  )

  const statusLine = isExpired(estimate.validUntil, estimate.createdAt)
    ? 'Expired - contact us for an updated quote'
    : estimate.status === 'approved'
      ? 'Accepted - work order to follow'
      : `Proposal - valid ${validDays} ${validDays === 1 ? 'day' : 'days'}`

  return generateProposalPdf({
    proposalNumber: proposalNumber(estimate.id),
    issuedDate: fmtDate(estimate.createdAt),
    expiresDate: fmtDate(new Date(expiresOn + 'T12:00:00')),
    walkthroughDate: estimate.walkthroughDate ? fmtDate(new Date(estimate.walkthroughDate + 'T12:00:00')) : null,
    solicitationNumber: estimate.bidMode === 'government' ? estimate.solicitationNumber : null,
    poNumber: estimate.poNumber,
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
    paymentTerms: PAYMENT_TERMS,
    deposit: depositSplit(subtotal + taxAmount, estimate.depositPct),
  })
}
