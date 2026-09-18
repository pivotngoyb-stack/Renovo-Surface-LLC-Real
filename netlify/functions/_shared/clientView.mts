/**
 * What a client is allowed to receive.
 *
 * The proposal and work-order token routes were returning whole
 * estimate_line_items rows. The pages render none of the internal columns, so
 * nothing looked wrong -- but the JSON behind the page carried Renovo's cost
 * basis to anyone who opened developer tools or forwarded the link:
 *
 *   subcontractorCost           what Renovo pays the sub, next to what the
 *                               client is charged. Margin, line by line.
 *   subcontractCoordinationPct  the markup on top of that.
 *   estimatedProductCost        chemical spend behind the price.
 *   estimatedDurationHours      the labour estimate the price was built from.
 *   calculatorInputs            the entire pricing model state.
 *   basePrice / finalPrice      the number before and after adjustment.
 *
 * These are the two documents most likely to be forwarded to a procurement
 * committee, which is the worst possible audience for that data.
 *
 * An allowlist rather than a deny-list: a column added to the estimate later
 * is then private by default. Getting that the wrong way round is how the leak
 * happened in the first place.
 */

export interface ClientLineItem {
  id: number
  description: string
  quantity: string
  unitPrice: string
  unit: string
  frequency: string
  siteName: string | null
  sortOrder: number
  isOptional: boolean
  /** Drives the scope sections and the service terms the client agrees to. */
  serviceType: string | null
}

type EstimateLineRow = {
  id: number
  description: string
  quantity: string
  unitPrice: string
  unit: string
  frequency: string
  siteName: string | null
  sortOrder: number
  isOptional: boolean
  serviceType: string | null
  [key: string]: unknown
}

/** One line item, stripped to what the client's own page renders. */
export function clientLineItem(li: EstimateLineRow): ClientLineItem {
  return {
    id: li.id,
    description: li.description,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    unit: li.unit,
    frequency: li.frequency,
    siteName: li.siteName,
    sortOrder: li.sortOrder,
    isOptional: li.isOptional,
    serviceType: li.serviceType,
  }
}

export function clientLineItems(lines: EstimateLineRow[]): ClientLineItem[] {
  return lines.map(clientLineItem)
}

/** Every column deliberately withheld. Exported so a test can assert on it. */
export const WITHHELD_FROM_CLIENT = [
  'calculatorInputs',
  'basePrice',
  'finalPrice',
  'estimatedDurationHours',
  'estimatedProductCost',
  'subcontracted',
  'subcontractorCost',
  'subcontractCoordinationPct',
] as const

/*
 * ---------------------------------------------------------------------------
 * Whole records, not just line items.
 *
 * The line items were fixed; the records around them were not. Every public
 * route still returned the full client, estimate, work order and invoice rows,
 * and each carries something that was never meant to leave the office:
 *
 *   client.notes              what Renovo writes about a client, to the client
 *   client.stripeCustomerId   a payment-processor identifier
 *   estimate.outcome*         who a lost bid went to, and at what price
 *   workOrder.crewToken       the crew's link -- the whole point of which is
 *                             that the client's link cannot reach it
 *   workOrder.actual*         what the job really took
 *   invoice.reminderStage     the collections ladder
 *
 * The crew token matters most, and more so now. The crew page is about to
 * carry a homeowner's door and alarm codes, and a client link that hands out
 * the crew token would pass those codes to anyone the client forwards it to.
 *
 * Same rule as the line items: an allowlist per record, so a column added
 * later is private until somebody decides otherwise.
 * ---------------------------------------------------------------------------
 */

type Row = Record<string, unknown>
const orNull = (v: unknown) => (v === undefined ? null : v)

/**
 * The client, as their own documents address them.
 *
 * Only the proposal prints the client's email (in its "Prepared for" block),
 * so only the proposal asks for it. The other pages never showed it.
 */
export function publicClient(c: Row | null | undefined, opts: { email?: boolean } = {}) {
  if (!c) return null
  return {
    name: c.name,
    company: orNull(c.company),
    phone: orNull(c.phone),
    propertyAddress: orNull(c.propertyAddress),
    ...(opts.email ? { email: orNull(c.email) } : {}),
  }
}

export const WITHHELD_CLIENT_FIELDS = ['email', 'notes', 'stripeCustomerId', 'createdAt'] as const

/** An estimate, as the proposal page renders it. */
export function publicEstimate(e: Row) {
  return {
    id: e.id,
    status: e.status,
    // Decides whether the page reads as a homeowner's quote or a commercial bid.
    bidMode: e.bidMode,
    projectName: orNull(e.projectName),
    siteAddress: orNull(e.siteAddress),
    siteConditions: orNull(e.siteConditions),
    walkthroughDate: orNull(e.walkthroughDate),
    poNumber: orNull(e.poNumber),
    validUntil: orNull(e.validUntil),
    createdAt: e.createdAt,
    taxApplied: e.taxApplied,
    taxAmount: e.taxAmount,
    notes: orNull(e.notes),
  }
}

export const WITHHELD_ESTIMATE_FIELDS = [
  'token', 'clientId', 'archived', 'updatedAt', 'viewedAt', 'depositPct',
  'outcome', 'outcomeAt', 'outcomeNotes', 'lostToName', 'lostToAmount', 'bidderCount',
  'bidDueAt', 'bidDeliveryMethod',
  // Government proposals carry these in their own block, built server-side.
  'solicitationNumber', 'optionYears', 'prevailingWage',
  'wageDeterminationNumber', 'wageClassification', 'wageBaseRate', 'wageFringeRate',
  'wageFringeMode', 'wageDecisionDate',
] as const

/** A work order, as the client signs it. */
export function publicWorkOrder(w: Row) {
  return {
    id: w.id,
    kind: w.kind,
    status: w.status,
    visitSequence: orNull(w.visitSequence),
    scheduledDate: orNull(w.scheduledDate),
    scheduledStart: orNull(w.scheduledStart),
    termsText: w.termsText,
  }
}

export const WITHHELD_WORK_ORDER_FIELDS = [
  'token', 'crewToken', 'estimateId', 'recurringContractId', 'completedAt', 'createdAt',
  'actualHours', 'actualCrewSize', 'actualHoursNote', 'actualMaterialsCost',
] as const

/** The client's signature on a work order, shown back to them. */
export function publicSignature(s: Row | null | undefined) {
  if (!s) return null
  return {
    signerName: s.signerName,
    signedAt: s.signedAt,
    termsAgreed: s.termsAgreed,
    serviceTypeShown: orNull(s.serviceTypeShown),
  }
}

export const WITHHELD_SIGNATURE_FIELDS = ['ipAddress', 'signatureData', 'consentConfirmed', 'workOrderId'] as const

/** An invoice, as the client pays it. */
export function publicInvoice(i: Row) {
  return {
    id: i.id,
    kind: i.kind,
    status: i.status,
    notes: orNull(i.notes),
    dueDate: orNull(i.dueDate),
    taxApplied: i.taxApplied,
    taxAmount: i.taxAmount,
    paidAt: orNull(i.paidAt),
    createdAt: i.createdAt,
    poNumber: orNull(i.poNumber),
  }
}

export const WITHHELD_INVOICE_FIELDS = [
  'token', 'clientId', 'workOrderId', 'recurringContractId', 'archived',
  'reminderStage', 'lastReminderSentAt',
] as const

/** A change order, as the client reads and signs it. */
export function publicChangeOrder(co: Row, extra: { number: unknown; total: unknown }) {
  return {
    id: co.id,
    workOrderId: orNull(co.workOrderId),
    number: extra.number,
    total: extra.total,
    status: co.status,
    description: co.description,
    reason: orNull(co.reason),
    poNumber: orNull(co.poNumber),
    scheduleImpactDays: co.scheduleImpactDays,
    signerName: orNull(co.signerName),
    signerTitle: orNull(co.signerTitle),
    signatureType: orNull(co.signatureType),
    signatureData: orNull(co.signatureData),
    declineReason: orNull(co.declineReason),
    sentAt: orNull(co.sentAt),
    respondedAt: orNull(co.respondedAt),
    createdAt: co.createdAt,
  }
}

export const WITHHELD_CHANGE_ORDER_FIELDS = [
  'token', 'ipAddress', 'consentConfirmed', 'archived', 'viewedAt',
  'recurringContractId', 'newMonthlyAmount', 'sequence',
] as const

/** A subcontractor's agreement, as they read and sign it. */
export function publicAgreement(a: Row) {
  return {
    subcontractorName: a.subcontractorName,
    subcontractorPhone: a.subcontractorPhone,
    status: a.status,
    paymentType: a.paymentType,
    paymentAmount: orNull(a.paymentAmount),
    paymentPercentage: orNull(a.paymentPercentage),
    signerName: orNull(a.signerName),
    signedAt: orNull(a.signedAt),
    createdAt: a.createdAt,
  }
}

export const WITHHELD_AGREEMENT_FIELDS = [
  'id', 'token', 'subcontractorEmail', 'signatureData', 'signatureType',
  'ipAddress', 'consentConfirmed', 'archived',
] as const
