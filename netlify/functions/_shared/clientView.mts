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
