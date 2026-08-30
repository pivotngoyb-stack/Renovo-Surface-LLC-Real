/**
 * Labor burden and fully loaded job cost.
 *
 * The calculator previously took a single flat "wage cost" figure and treated
 * it as the cost of an hour of labor. It is not. An hour of a technician's
 * time costs the base wage plus payroll taxes, workers' compensation, general
 * liability, and unemployment -- and the business behind that hour costs
 * vehicles, admin, equipment and insurance on top.
 *
 * Two numbers, kept separate on purpose:
 *
 *   burdened rate  = what one hour of labor actually costs to employ
 *   loaded cost    = burdened labor + materials + fuel + overhead allocation
 *
 * Conflating them is how a job looks profitable and isn't. Margin is measured
 * against loaded cost, never against the base wage.
 */

/** Social Security 6.2% + Medicare 1.45%. Set by statute, not negotiable. */
export const FICA_RATE = 0.0765

export interface BurdenInputs {
  /** What the technician is actually paid per hour. */
  baseWage: number
  /**
   * Workers' compensation as a percent of payroll. Utah janitorial (NCCI 9014)
   * runs roughly 4-8%; pressure washing and construction cleanup sit higher
   * because the claim history is worse.
   */
  workersCompPct: number
  /** General liability allocated to payroll. Typically 2-3%. */
  generalLiabilityPct: number
  /** FUTA plus Utah SUTA. Typically 1-3% depending on experience rating. */
  unemploymentPct: number
  /**
   * Paid time off, holidays and any health contribution, as a percent of base
   * wage. Zero for a shop that offers none -- which is why the published
   * "labor burden is 1.35x" figures do not apply universally. They assume
   * benefits; taxes and insurance alone come to roughly 1.18x.
   */
  benefitsPct: number
  /**
   * Business overhead as a percent of direct job cost: vehicles, fuel for
   * non-job travel, admin time, software, insurance not already counted above.
   *
   * Machine ownership is deliberately NOT in here. It used to be, and it could
   * not work: a window-cleaning hour runs about $2 of equipment and a ride-on
   * sweeper hour runs about $9. One percentage across both either overcharges
   * the light service or eats the margin on the heavy one. See equipment.mts.
   */
  overheadPct: number
}

export const DEFAULT_BURDEN: BurdenInputs = {
  baseWage: 20,
  workersCompPct: 6,
  generalLiabilityPct: 2.5,
  unemploymentPct: 2,
  // No benefits assumed by default. Set this once Renovo offers PTO or health.
  benefitsPct: 0,
  overheadPct: 18,
}

export interface BurdenBreakdown {
  baseWage: number
  fica: number
  workersComp: number
  generalLiability: number
  unemployment: number
  benefits: number
  /** Base wage plus every payroll add-on, per hour. */
  burdenedRate: number
  /** burdenedRate / baseWage, e.g. 1.36. */
  burdenMultiplier: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** What one hour of labor costs to employ, itemised. */
export function burdenedRate(inputs: Partial<BurdenInputs> = {}): BurdenBreakdown {
  const i = { ...DEFAULT_BURDEN, ...inputs }
  const base = Math.max(0, i.baseWage)

  const fica = base * FICA_RATE
  const workersComp = base * Math.max(0, i.workersCompPct) / 100
  const generalLiability = base * Math.max(0, i.generalLiabilityPct) / 100
  const unemployment = base * Math.max(0, i.unemploymentPct) / 100
  const benefits = base * Math.max(0, i.benefitsPct) / 100
  const rate = base + fica + workersComp + generalLiability + unemployment + benefits

  return {
    baseWage: round2(base),
    fica: round2(fica),
    workersComp: round2(workersComp),
    generalLiability: round2(generalLiability),
    unemployment: round2(unemployment),
    benefits: round2(benefits),
    burdenedRate: round2(rate),
    burdenMultiplier: base > 0 ? Math.round((rate / base) * 1000) / 1000 : 0,
  }
}

export interface JobCost {
  laborHours: number
  burdenedRate: number
  directLabor: number
  materials: number
  fuel: number
  /** Labor + materials + fuel, before overhead. */
  directCost: number
  overhead: number
  /** Everything it costs to deliver this job. */
  loadedCost: number
  price: number
  profit: number
  /** Profit as a percent of price -- gross margin, not markup. */
  marginPct: number
  /** True when the job loses money once overhead is counted. */
  underwater: boolean
}

/**
 * Full job economics.
 *
 * Margin is expressed against price, which is how a contractor quotes it and
 * how a lender reads it. Markup on cost is a different number and gets
 * confused with margin constantly -- 50% markup is 33% margin.
 */
export function jobCost(
  price: number,
  laborHours: number,
  materials: number,
  fuel: number,
  inputs: Partial<BurdenInputs> = {},
): JobCost {
  const i = { ...DEFAULT_BURDEN, ...inputs }
  const rate = burdenedRate(i).burdenedRate

  const directLabor = round2(Math.max(0, laborHours) * rate)
  const directCost = round2(directLabor + Math.max(0, materials) + Math.max(0, fuel))
  const overhead = round2(directCost * Math.max(0, i.overheadPct) / 100)
  const loadedCost = round2(directCost + overhead)
  const profit = round2(price - loadedCost)

  return {
    laborHours: Math.max(0, laborHours),
    burdenedRate: rate,
    directLabor,
    materials: round2(Math.max(0, materials)),
    fuel: round2(Math.max(0, fuel)),
    directCost,
    overhead,
    loadedCost,
    price: round2(price),
    profit,
    marginPct: price > 0 ? Math.round((profit / price) * 1000) / 10 : 0,
    underwater: profit < 0,
  }
}

/**
 * The price needed to hit a target gross margin.
 *
 * Answers the question a quote should always be checked against: "what would
 * I have to charge for this to actually make 40%?"
 */
export function priceForMargin(
  targetMarginPct: number,
  laborHours: number,
  materials: number,
  fuel: number,
  inputs: Partial<BurdenInputs> = {},
): number {
  const m = Math.min(Math.max(targetMarginPct, 0), 95) / 100
  const cost = jobCost(0, laborHours, materials, fuel, inputs).loadedCost
  return round2(cost / (1 - m))
}
