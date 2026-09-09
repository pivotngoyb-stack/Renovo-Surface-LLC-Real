import { burdenedRate, DEFAULT_BURDEN, type BurdenInputs } from './laborBurden.mts'

/**
 * Prevailing wage, priced rather than promised.
 *
 * The estimate already carried a `prevailingWage` boolean, and flipping it on
 * added two paragraphs to the proposal: that Renovo will pay the applicable
 * determination and file certified payroll each period. Both true, both
 * binding -- and the price behind them was still computed from a $20 base
 * wage.
 *
 * That is worse than having no flag at all. A missing feature is visible. A
 * document that commits to a wage the bid never costed reads as handled, right
 * up until payroll runs. On a Davis-Bacon determination the covered
 * classification plus fringe commonly lands somewhere around double an
 * unregulated janitorial wage, and the difference comes out of one place.
 *
 * So a covered job cannot be priced from a guess here. It needs the actual
 * determination -- number, classification, base, fringe -- and the arithmetic
 * that follows from it.
 *
 * What this module does NOT do, deliberately:
 *
 *   - Look up determinations. Rates come from the determination incorporated
 *     into the solicitation, which is an attachment on a specific bid, not a
 *     table this app can keep current. Typing it in from the document you were
 *     given is the correct workflow; inventing it is not.
 *
 *   - Model overtime. Under the FLSA the regular rate for overtime includes
 *     cash fringe but excludes bona fide plan contributions, and DBA treats
 *     the fringe portion differently again. Getting that subtly wrong in a
 *     bid is worse than leaving it to payroll, so straight time only. Price
 *     scheduled overtime as its own line.
 */

/** How the fringe portion of a determination is actually delivered. */
export type FringeMode = 'cash' | 'plan'

export interface WageDetermination {
  /** The determination on the solicitation, e.g. "UT20240012". */
  number: string
  /** The covered classification being priced, e.g. "Laborer: Common or General". */
  classification: string
  /** Hourly base rate the determination requires, paid in cash. */
  baseRate: number
  /** Hourly fringe the determination requires, in cash or into a plan. */
  fringeRate: number
  /**
   * Cash is the default because it is what a contractor without a bona fide
   * benefit plan actually does, and it is the expensive answer: fringe paid as
   * wages is payroll, so it carries FICA, unemployment and workers' comp on
   * top. A bona fide plan contribution carries none of those.
   *
   * Defaulting to 'plan' would quietly under-price every covered job by the
   * payroll tax on the fringe -- roughly 12-16% of it.
   */
  fringeMode: FringeMode
  /** Publication date of the determination, ISO. */
  decisionDate: string | null
}

export interface DeterminationProblem {
  field: string
  message: string
}

/**
 * Whether this determination can actually price a job.
 *
 * Returns every problem rather than the first, because someone filling this in
 * from a PDF should be told once what is missing, not made to discover it a
 * field at a time.
 */
export function checkDetermination(d: Partial<WageDetermination> | null | undefined): DeterminationProblem[] {
  const problems: DeterminationProblem[] = []
  if (!d) {
    return [{ field: 'determination', message: 'This job is marked prevailing wage but carries no wage determination.' }]
  }

  if (!d.number || !String(d.number).trim()) {
    problems.push({ field: 'number', message: 'Enter the wage determination number from the solicitation.' })
  }
  if (!d.classification || !String(d.classification).trim()) {
    problems.push({ field: 'classification', message: 'Name the covered classification you are pricing.' })
  }

  const base = Number(d.baseRate)
  if (!Number.isFinite(base) || base <= 0) {
    problems.push({ field: 'baseRate', message: 'Enter the hourly base rate from the determination.' })
  } else if (base < 7.25) {
    problems.push({ field: 'baseRate', message: 'That base rate is below the federal minimum wage -- check the figure.' })
  } else if (base > 200) {
    problems.push({ field: 'baseRate', message: 'That base rate looks like a typo.' })
  }

  const fringe = Number(d.fringeRate)
  // Zero fringe is legitimate -- some determinations carry none -- so only the
  // shape is checked, not the presence.
  if (!Number.isFinite(fringe) || fringe < 0) {
    problems.push({ field: 'fringeRate', message: 'Fringe must be zero or a positive hourly amount.' })
  } else if (fringe > 100) {
    problems.push({ field: 'fringeRate', message: 'That fringe rate looks like a typo.' })
  }

  if (d.fringeMode && d.fringeMode !== 'cash' && d.fringeMode !== 'plan') {
    problems.push({ field: 'fringeMode', message: 'Fringe is either paid in cash or into a bona fide plan.' })
  }

  return problems
}

/** How old a determination may be before it is worth re-checking, in days. */
export const DETERMINATION_STALE_DAYS = 365

/**
 * Whether the determination is old enough to re-verify.
 *
 * The determination locked into a solicitation governs that contract, so an
 * old one is not automatically wrong. But carrying last year's rates into this
 * year's bid is a live way to under-price, and option years often pull in a
 * newer determination. Advisory, never blocking.
 */
export function determinationIsStale(decisionDate: string | null | undefined, today = new Date()): boolean {
  if (!decisionDate) return false
  const then = new Date(decisionDate + 'T00:00:00Z')
  if (Number.isNaN(then.getTime())) return false
  const days = (today.getTime() - then.getTime()) / 86_400_000
  return days > DETERMINATION_STALE_DAYS
}

/**
 * The determination expressed as burden inputs.
 *
 * Cash fringe becomes payroll and is taxed with the base. Plan fringe is a
 * real hourly cost that carries no payroll tax, so it rides alongside rather
 * than inside the taxable wage.
 */
export function determinationBurden(
  d: WageDetermination,
  overrides: Partial<BurdenInputs> = {},
): Partial<BurdenInputs> {
  const base = Math.max(0, Number(d.baseRate) || 0)
  const fringe = Math.max(0, Number(d.fringeRate) || 0)
  const cash = d.fringeMode !== 'plan'

  return {
    ...overrides,
    baseWage: cash ? base + fringe : base,
    hourlyFringe: cash ? 0 : fringe,
  }
}

export interface WageImpact {
  /** What an hour costs at the shop's ordinary wage. */
  standardHourlyCost: number
  /** What an hour costs under the determination. */
  prevailingHourlyCost: number
  /** The difference, per hour of crew time. */
  deltaPerHour: number
  /** How much more expensive, as a percent. */
  deltaPct: number
  /** The taxable wage the determination produces. */
  taxableWage: number
  /** Fringe riding outside payroll, if paid into a plan. */
  untaxedFringe: number
}

/**
 * What the determination does to an hour of crew time.
 *
 * The point of this number is to be looked at before the bid goes out. A
 * covered job is not the same job at a different wage -- it is a different
 * business, and every hour in the estimate costs what this says it costs.
 */
export function wageImpact(
  d: WageDetermination,
  shopInputs: Partial<BurdenInputs> = {},
): WageImpact {
  const shop = { ...DEFAULT_BURDEN, ...shopInputs }
  const standard = burdenedRate(shop).burdenedRate
  const covered = burdenedRate(determinationBurden(d, shop)).burdenedRate

  const delta = Math.round((covered - standard) * 100) / 100
  return {
    standardHourlyCost: standard,
    prevailingHourlyCost: covered,
    deltaPerHour: delta,
    deltaPct: standard > 0 ? Math.round((delta / standard) * 1000) / 10 : 0,
    taxableWage: Math.round((determinationBurden(d, shop).baseWage || 0) * 100) / 100,
    untaxedFringe: Math.round((determinationBurden(d, shop).hourlyFringe || 0) * 100) / 100,
  }
}

/**
 * The billing rate a covered job has to carry to hold its margin.
 *
 * The calculator prices every service off one billed hourly rate. That rate is
 * a selling price, so a determination does not change it by itself -- it eats
 * the margin underneath it silently, which is exactly why nobody notices until
 * the job is over.
 *
 * Overhead is applied the way jobCost applies it, as a percentage of direct
 * cost, so this floor is comparable to the margin the rest of the app reports.
 * Materials and fuel are excluded: they do not move with the wage, and folding
 * them in would make the answer depend on the job rather than the wage.
 */
export function billingRateFloor(
  targetMarginPct: number,
  inputs: Partial<BurdenInputs> = {},
): number {
  const i = { ...DEFAULT_BURDEN, ...inputs }
  const labor = burdenedRate(i).burdenedRate
  const loaded = labor * (1 + Math.max(0, i.overheadPct) / 100)
  const margin = Math.min(Math.max(targetMarginPct, 0), 95) / 100
  return Math.round((loaded / (1 - margin)) * 100) / 100
}

/* ---------- certified payroll ---------- */

/**
 * Filing WH-347 is not free, and it is not optional.
 *
 * A covered contract requires a certified payroll report for every week any
 * covered work is performed, with a signed statement of compliance. That is
 * real admin time, every week, for the length of the job -- and it is
 * routinely left out of the bid entirely, which turns it into a straight
 * deduction from profit.
 *
 * Split into a fixed weekly cost and a per-worker cost because the form scales
 * both ways: the filing happens once a week whatever the crew size, and each
 * covered worker adds a row that has to be right.
 */
export const CERTIFIED_PAYROLL_BASE_MINUTES = 45
export const CERTIFIED_PAYROLL_MINUTES_PER_WORKER = 6
/** What an hour of back-office time costs. Bookkeeping, not crew. */
export const DEFAULT_ADMIN_HOURLY = 35

export interface CertifiedPayrollCost {
  weeks: number
  crewSize: number
  hoursPerWeek: number
  totalHours: number
  cost: number
}

export function certifiedPayrollCost(
  weeks: number,
  crewSize: number,
  adminHourly = DEFAULT_ADMIN_HOURLY,
): CertifiedPayrollCost {
  const w = Math.max(0, Math.ceil(weeks || 0))
  const c = Math.max(0, Math.round(crewSize || 0))
  const minutes = w > 0 ? CERTIFIED_PAYROLL_BASE_MINUTES + c * CERTIFIED_PAYROLL_MINUTES_PER_WORKER : 0
  const hoursPerWeek = Math.round((minutes / 60) * 100) / 100
  const totalHours = Math.round(hoursPerWeek * w * 100) / 100
  return {
    weeks: w,
    crewSize: c,
    hoursPerWeek,
    totalHours,
    cost: Math.round(totalHours * Math.max(0, adminHourly) * 100) / 100,
  }
}
