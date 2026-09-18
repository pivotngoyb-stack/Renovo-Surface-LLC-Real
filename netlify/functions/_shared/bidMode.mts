/**
 * What kind of document an estimate becomes.
 *
 *   standard     a commercial proposal
 *   government   a public bid: solicitation number, registrations, wage terms
 *   residential  a homeowner's quote: plain language, home policies, and no
 *                procurement furniture (NAICS, PO numbers, W-9s)
 *
 * Stored as text on the estimate. Anything unrecognised is read as standard,
 * the mode that promises least that the owner did not choose.
 */
export const BID_MODES = ['standard', 'government', 'residential'] as const
export type BidMode = (typeof BID_MODES)[number]

export function normalizeBidMode(v: unknown): BidMode {
  return typeof v === 'string' && (BID_MODES as readonly string[]).includes(v) ? (v as BidMode) : 'standard'
}

export const isResidential = (e: { bidMode?: string | null } | null | undefined): boolean =>
  e?.bidMode === 'residential'
