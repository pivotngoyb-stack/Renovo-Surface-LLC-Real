/**
 * Subcontracted work: cost, markup and what Renovo actually keeps.
 *
 * The calculator assumes Renovo's own crew does the work, so it costs a job at
 * burdened wages plus machine wear. When the work is subcontracted none of that
 * is true: the cost is what the sub invoices, and Renovo's real exposure is
 * coordination and warranty rather than labor. Pricing a subbed line with the
 * in-house cost model reports a margin that does not exist.
 *
 * Two numbers that get confused constantly, kept apart here on purpose:
 *
 *   markup  is measured against COST   -- 30% markup on $1,000 is $1,300
 *   margin  is measured against PRICE  -- that same job is a 23.1% margin
 *
 * Contractors quote markup and lenders read margin. Reporting one as the other
 * overstates profitability on every subbed line, and it compounds: a portfolio
 * bid built on "30% margin" that is really 23% is short by the difference on
 * every property.
 */

/** A common trade default. Low enough to stay competitive, high enough to cover a callback. */
export const DEFAULT_MARKUP_PCT = 30

/**
 * Renovo's own cost to run subcontracted work, as a percent of the sub's
 * invoice: the walk-through, scheduling, quality check, the client call when
 * something is wrong, and carrying the receivable until the client pays.
 *
 * Not zero. Treating a subbed line as pure spread is how a coordinator ends up
 * working for nothing.
 */
export const DEFAULT_COORDINATION_PCT = 10

export interface SubcontractInputs {
  /** What the subcontractor invoices Renovo for this work. */
  subCost: number
  /** Renovo's overhead on top, as a percent of the sub's cost. */
  coordinationPct: number
}

export const DEFAULT_SUBCONTRACT: SubcontractInputs = {
  subCost: 0,
  coordinationPct: DEFAULT_COORDINATION_PCT,
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface SubcontractResult {
  subCost: number
  coordination: number
  /** Everything this line costs Renovo. */
  loadedCost: number
  price: number
  profit: number
  /** Profit over price. */
  marginPct: number
  /** Profit over cost. The number a contractor says out loud. */
  markupPct: number
  underwater: boolean
}

/** What Renovo keeps on a subcontracted line at a given price. */
export function subcontractResult(
  price: number,
  inputs: Partial<SubcontractInputs> = {},
): SubcontractResult {
  const i = { ...DEFAULT_SUBCONTRACT, ...inputs }
  const subCost = Math.max(0, i.subCost)
  const coordination = round2(subCost * Math.max(0, i.coordinationPct) / 100)
  const loadedCost = round2(subCost + coordination)
  const profit = round2(price - loadedCost)

  return {
    subCost: round2(subCost),
    coordination,
    loadedCost,
    price: round2(price),
    profit,
    marginPct: price > 0 ? Math.round((profit / price) * 1000) / 10 : 0,
    markupPct: loadedCost > 0 ? Math.round((profit / loadedCost) * 1000) / 10 : 0,
    underwater: profit < 0,
  }
}

/**
 * The price that yields a given MARKUP on the loaded cost.
 *
 * This is the one a contractor reaches for: "cost plus thirty".
 */
export function priceForMarkup(markupPct: number, inputs: Partial<SubcontractInputs> = {}): number {
  const i = { ...DEFAULT_SUBCONTRACT, ...inputs }
  const subCost = Math.max(0, i.subCost)
  const loadedCost = subCost * (1 + Math.max(0, i.coordinationPct) / 100)
  return round2(loadedCost * (1 + Math.max(0, markupPct) / 100))
}

/**
 * The price that yields a given MARGIN on the sale.
 *
 * Capped at 95%: the formula divides by (1 - margin) and runs away to infinity
 * as it approaches 100%, which is not a price, it is a typo.
 */
export function priceForSubMargin(marginPct: number, inputs: Partial<SubcontractInputs> = {}): number {
  const i = { ...DEFAULT_SUBCONTRACT, ...inputs }
  const subCost = Math.max(0, i.subCost)
  const loadedCost = subCost * (1 + Math.max(0, i.coordinationPct) / 100)
  const m = Math.min(Math.max(marginPct, 0), 95) / 100
  return round2(loadedCost / (1 - m))
}

/** Markup converted to the margin it actually produces. 30% markup is 23.1% margin. */
export function markupToMargin(markupPct: number): number {
  const m = Math.max(0, markupPct)
  return Math.round((m / (100 + m)) * 1000) / 10
}

/** Margin converted to the markup that produces it. 30% margin needs 42.9% markup. */
export function marginToMarkup(marginPct: number): number {
  const m = Math.min(Math.max(marginPct, 0), 99.9)
  return Math.round((m / (100 - m)) * 1000) / 10
}
