import type { JobPlan } from './jobModel.mts'

/**
 * What the crew is allowed to receive.
 *
 * The job plan is written for them -- chemicals, dilutions, dwell times, crew
 * size, PPE, compliance, the weather window. All of that should go out. What
 * should not is the money folded into it: each chemical carries the cost of
 * the concentrate, and the plan carries a costCheck comparing what the job will
 * spend against what the quote assumed.
 *
 * That is Renovo's margin working, and a crew link is the most forwardable
 * thing in the system -- it goes to a phone, gets screenshotted, gets passed to
 * whoever is covering the shift. None of those people need to know what the
 * job was quoted at, and one of them may one day work for a competitor.
 *
 * An allowlist, like clientView: a field added to the plan later is withheld
 * by default rather than exposed by default. Getting that the wrong way round
 * is how the proposal leaked its cost basis.
 */

export interface CrewChemical {
  product: string
  purpose: string
  dilution: string
  mixedGallons: number
  concentrateGallons: number
  waterGallons: number
  dwellMinutes: number
}

export interface CrewPlan {
  services: string[]
  laborHours: number
  crew: { techs: number; hoursEach: number; rationale: string }
  phases: JobPlan['phases']
  onSiteHours: number
  chemicals: CrewChemical[]
  equipment: string[]
  ppe: string[]
  water: { gallons: number; note: string }
  compliance: JobPlan['compliance']
  weather: string[]
  warnings: string[]
}

/** The plan as the crew should see it: everything they need, none of the money. */
export function crewPlan(plan: JobPlan): CrewPlan {
  return {
    services: plan.services,
    laborHours: plan.laborHours,
    crew: plan.crew,
    phases: plan.phases,
    onSiteHours: plan.onSiteHours,
    chemicals: plan.chemicals.map(c => ({
      product: c.product,
      purpose: c.purpose,
      dilution: c.dilution,
      mixedGallons: c.mixedGallons,
      concentrateGallons: c.concentrateGallons,
      waterGallons: c.waterGallons,
      dwellMinutes: c.dwellMinutes,
    })),
    equipment: plan.equipment,
    ppe: plan.ppe,
    water: plan.water,
    compliance: plan.compliance,
    weather: plan.weather,
    warnings: plan.warnings,
  }
}

/** Everything deliberately withheld. Exported so a test can assert on it. */
export const WITHHELD_FROM_CREW = [
  'cost',
  'costCheck',
  'plannedChemicalCost',
  'quotedProductCost',
  // The plan's own office-only band -- chemicals running over what the estimate
  // assumed, and what that does to the job's margin.
  'internalWarnings',
] as const

/**
 * One scope line as the crew reads it.
 *
 * Description only. A crew standing on a forecourt needs to know the fuel
 * island is in scope; they do not need to know it was sold for $640, and a
 * price list on a phone screen is the fastest way for a client to learn what
 * their neighbour paid.
 */
export function crewScope(lines: Array<{ description: string; isOptional?: boolean | null }>): string[] {
  return lines.filter(l => !l.isOptional).map(l => l.description)
}

/**
 * A line the client added later, and the document that added it.
 *
 * The reference matters on site. A crew told to do something that is not on
 * the original sheet needs to be able to say which signed document put it
 * there -- to the client's facilities manager standing next to them, and to
 * the office afterwards when the invoice is queried.
 */
export function crewChangeScope(ref: string, lines: Array<{ description: string }>): string[] {
  return lines.map(l => `${l.description} (added by ${ref})`)
}
