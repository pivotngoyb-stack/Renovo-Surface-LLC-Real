/**
 * What a recurring contract is really worth, and when it starts paying.
 *
 * A one-off job either made money or it did not. A contract is a different
 * question: it costs something to win before it earns anything, and it only
 * repays that over a run of visits. Two contracts at the same annual margin are
 * not equally good if one took a day to win and the other took an hour.
 *
 * Three numbers a per-job margin cannot show:
 *
 *   acquisition   what it cost to win and start the contract, spent once
 *   break-even    how many visits before the contract has repaid that
 *   first year    margin with acquisition counted, which is the honest one
 *
 * The steady-state margin is the one worth quoting internally; the first-year
 * margin is the one that decides whether losing the client in month five was
 * survivable.
 */

import { burdenedRate, DEFAULT_BURDEN, type BurdenInputs } from './laborBurden.mts'

export interface AcquisitionInputs {
  /**
   * Hours spent winning it: the site walk, the measure-up, writing and revising
   * the proposal, the follow-up calls. Rarely under two for anything real.
   */
  bidHours: number
  /**
   * The first visit is slower than the rest. The crew is learning the floor
   * plan, finding the closets, working out where the water is. 1.5 means the
   * first visit takes half again as long as a settled one.
   */
  onboardingMultiplier: number
}

export const DEFAULT_ACQUISITION: AcquisitionInputs = {
  bidHours: 3,
  onboardingMultiplier: 1.5,
}

export interface ContractEconomics {
  visitsPerYear: number
  revenuePerVisit: number
  costPerVisit: number
  profitPerVisit: number

  /** Owner time spent winning the work, costed at the burdened rate. */
  bidCost: number
  /** The extra labor the first visit consumes over a settled one. */
  onboardingCost: number
  /** Everything spent before the contract earns anything. */
  acquisitionCost: number

  /** Visits before acquisition is repaid. Null when the contract never repays. */
  breakEvenVisits: number | null
  /** The same in months, which is how a client relationship is actually measured. */
  breakEvenMonths: number | null

  annualRevenue: number
  /** Margin once the contract has settled: what it earns from here on. */
  steadyMarginPct: number
  /** Margin across the first year, with acquisition counted. The honest one. */
  firstYearMarginPct: number
  firstYearProfit: number

  /** True when a visit loses money, so no run of visits will ever repay the bid. */
  neverRepays: boolean
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Contract economics from one visit's figures.
 *
 * revenuePerVisit and costPerVisit come from jobEconomics, which has already
 * costed the visit against the burden settings stored with the quote.
 */
export function contractEconomics(
  revenuePerVisit: number,
  costPerVisit: number,
  visitsPerYear: number,
  acquisition: Partial<AcquisitionInputs> = {},
  burden: Partial<BurdenInputs> = {},
): ContractEconomics {
  const a = { ...DEFAULT_ACQUISITION, ...acquisition }
  const visits = Math.max(0, visitsPerYear)
  const rev = Math.max(0, revenuePerVisit)
  const cost = Math.max(0, costPerVisit)
  const profitPerVisit = round2(rev - cost)

  // Bid time is the owner's, not a technician's, but it is still labor and it
  // is still burdened. Costing it at zero is how "we'll just quote it" becomes
  // an afternoon nobody accounts for.
  const rate = burdenedRate(burden).burdenedRate
  const bidCost = round2(Math.max(0, a.bidHours) * rate)

  // Only the excess counts. The first visit's normal cost is already in the
  // per-visit figure; what acquisition bears is the part above normal.
  const extra = Math.max(0, a.onboardingMultiplier - 1)
  const onboardingCost = round2(cost * extra)

  const acquisitionCost = round2(bidCost + onboardingCost)

  const neverRepays = profitPerVisit <= 0
  const breakEvenVisits = neverRepays ? null : Math.ceil(acquisitionCost / profitPerVisit)
  const breakEvenMonths = breakEvenVisits == null || visits <= 0
    ? null
    : Math.round((breakEvenVisits / visits) * 12 * 10) / 10

  const annualRevenue = round2(rev * visits)
  const annualProfit = round2(profitPerVisit * visits)
  const firstYearProfit = round2(annualProfit - acquisitionCost)

  return {
    visitsPerYear: visits,
    revenuePerVisit: round2(rev),
    costPerVisit: round2(cost),
    profitPerVisit,
    bidCost,
    onboardingCost,
    acquisitionCost,
    breakEvenVisits,
    breakEvenMonths,
    annualRevenue,
    steadyMarginPct: annualRevenue > 0 ? Math.round((annualProfit / annualRevenue) * 1000) / 10 : 0,
    firstYearMarginPct: annualRevenue > 0 ? Math.round((firstYearProfit / annualRevenue) * 1000) / 10 : 0,
    firstYearProfit,
    neverRepays,
  }
}

/**
 * How a contract reads at a glance.
 *
 * Deliberately blunt. A contract that takes eight months to repay the cost of
 * winning it is a bad contract even at a healthy steady margin, and a report
 * that only shows the steady margin will never say so.
 */
export function contractVerdict(c: ContractEconomics): { level: 'good' | 'watch' | 'bad'; note: string } {
  if (c.neverRepays) {
    return { level: 'bad', note: 'Every visit loses money, so no length of contract repays the cost of winning it.' }
  }
  if (c.breakEvenMonths != null && c.breakEvenMonths > 6) {
    return {
      level: 'bad',
      note: `Takes ${c.breakEvenMonths} months to repay what it cost to win. Lose the client before then and the contract was a loss.`,
    }
  }
  if (c.breakEvenMonths != null && c.breakEvenMonths > 3) {
    return {
      level: 'watch',
      note: `Repays the cost of winning it after ${c.breakEvenMonths} months. Fine if it holds, thin if it does not.`,
    }
  }
  if (c.steadyMarginPct < 20) {
    return { level: 'watch', note: 'Repays quickly, but the ongoing margin leaves little room for a callback.' }
  }
  return {
    level: 'good',
    note: c.breakEvenMonths != null
      ? `Repays the cost of winning it in ${c.breakEvenMonths} months, then earns ${c.steadyMarginPct}%.`
      : `Earns ${c.steadyMarginPct}%.`,
  }
}
