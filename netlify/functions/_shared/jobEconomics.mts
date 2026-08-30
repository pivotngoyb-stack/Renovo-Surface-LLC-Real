/**
 * What a job actually earned, reconstructed from what was stored when it was
 * quoted.
 *
 * The burden, equipment and subcontract models all live in the estimate
 * builder, which means Renovo can see the margin on a quote and nowhere else.
 * Once an estimate becomes a work order and then an invoice, the cost side
 * disappears and all that remains is a price. A business that can only see
 * revenue cannot tell a good client from a busy one.
 *
 * This recomputes the cost side from the figures stored on each line, using the
 * burden settings that were in force when the quote was written rather than
 * today's. A job priced last spring at a $18 wage should not be re-scored
 * against a $22 wage now: that would rewrite history every time a setting
 * changes, and the whole point is to learn from what actually happened.
 *
 * Legacy lines are handled explicitly rather than skipped. Most of the history
 * predates these fields, and a report that silently drops every older job would
 * be worse than no report -- it would look complete.
 */

import { burdenedRate, jobCost, DEFAULT_BURDEN, type BurdenInputs } from './laborBurden.mts'
import { equipmentCostFor } from './equipment.mts'
import { subcontractResult, DEFAULT_COORDINATION_PCT } from './subcontract.mts'

export interface StoredLineItem {
  id?: number
  description: string
  quantity: string | number
  unitPrice: string | number
  serviceType: string | null
  calculatorInputs: string | null
  estimatedDurationHours: string | number | null
  estimatedProductCost: string | number | null
  subcontracted?: boolean | null
  subcontractorCost?: string | number | null
  subcontractCoordinationPct?: string | number | null
  isOptional?: boolean | null
}

const n = (v: unknown, fallback = 0): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * How much of this line's economics we can actually vouch for.
 *
 *   full    priced by the calculator with burden settings stored alongside
 *   partial priced by the calculator before burden settings were recorded
 *   none    typed in by hand, so there is a price and nothing else
 */
export type CostConfidence = 'full' | 'partial' | 'none'

export interface LineEconomics {
  description: string
  serviceType: string | null
  revenue: number
  laborHours: number
  burdenedRate: number
  directLabor: number
  materials: number
  equipment: number
  overhead: number
  subcontractorCost: number
  loadedCost: number
  profit: number
  marginPct: number
  subcontracted: boolean
  confidence: CostConfidence
  /** Why the confidence is not full, for the report to show rather than hide. */
  note?: string
}

/**
 * Burden settings as they were when the line was quoted.
 *
 * Before the burden model existed the calculator stored a single flat
 * `wageCost`, which conflated the wage with everything loaded on top of it.
 * Rather than pretend that figure was a base wage, it is treated as an
 * already-burdened rate: back out an implied base so the arithmetic downstream
 * stays consistent, and mark the line partial so nobody reads it as gospel.
 */
function burdenFor(inputs: Record<string, unknown> | null): { burden: Partial<BurdenInputs>; legacy: boolean } {
  if (!inputs) return { burden: {}, legacy: true }

  if (inputs.baseWage != null) {
    return {
      burden: {
        baseWage: n(inputs.baseWage, DEFAULT_BURDEN.baseWage),
        workersCompPct: n(inputs.workersCompPct, DEFAULT_BURDEN.workersCompPct),
        generalLiabilityPct: n(inputs.generalLiabilityPct, DEFAULT_BURDEN.generalLiabilityPct),
        unemploymentPct: n(inputs.unemploymentPct, DEFAULT_BURDEN.unemploymentPct),
        benefitsPct: n(inputs.benefitsPct, DEFAULT_BURDEN.benefitsPct),
        overheadPct: n(inputs.overheadPct, DEFAULT_BURDEN.overheadPct),
      },
      legacy: false,
    }
  }

  if (inputs.wageCost != null) {
    const flat = n(inputs.wageCost)
    // The old flat figure already included taxes and insurance, so dividing by
    // the default multiplier recovers roughly the base wage it implied.
    const multiplier = burdenedRate({ baseWage: 100 }).burdenMultiplier || 1
    return { burden: { baseWage: round2(flat / multiplier) }, legacy: true }
  }

  return { burden: {}, legacy: true }
}

/** Reconstruct one line's economics from what was stored. */
export function lineEconomics(li: StoredLineItem): LineEconomics {
  const revenue = round2(n(li.quantity, 1) * n(li.unitPrice))

  let inputs: Record<string, unknown> | null = null
  if (li.calculatorInputs) {
    try {
      inputs = JSON.parse(li.calculatorInputs)
    } catch {
      inputs = null
    }
  }

  const base = {
    description: li.description,
    serviceType: li.serviceType,
    revenue,
    subcontracted: Boolean(li.subcontracted),
  }

  /* Subcontracted: none of Renovo's labor, machine or overhead applies. */
  if (li.subcontracted) {
    const r = subcontractResult(revenue, {
      subCost: n(li.subcontractorCost),
      coordinationPct: n(li.subcontractCoordinationPct, DEFAULT_COORDINATION_PCT),
    })
    return {
      ...base,
      laborHours: 0,
      burdenedRate: 0,
      directLabor: 0,
      materials: 0,
      equipment: 0,
      overhead: r.coordination,
      subcontractorCost: r.subCost,
      loadedCost: r.loadedCost,
      profit: r.profit,
      marginPct: r.marginPct,
      confidence: r.subCost > 0 ? 'full' : 'none',
      note: r.subCost > 0 ? undefined : 'Marked subcontracted with no cost recorded.',
    }
  }

  const hours = n(li.estimatedDurationHours)

  /* Hand-typed line: a price and nothing else. Say so rather than guessing. */
  if (!li.serviceType || hours <= 0) {
    return {
      ...base,
      laborHours: 0,
      burdenedRate: 0,
      directLabor: 0,
      materials: 0,
      equipment: 0,
      overhead: 0,
      subcontractorCost: 0,
      loadedCost: 0,
      profit: revenue,
      marginPct: revenue > 0 ? 100 : 0,
      confidence: 'none',
      note: 'Entered by hand, so no cost was recorded. Counted as revenue only.',
    }
  }

  const { burden, legacy } = burdenFor(inputs)
  const materials = n(li.estimatedProductCost)
  const equipment = equipmentCostFor(li.serviceType, hours).total
  const cost = jobCost(revenue, hours, materials + equipment, 0, burden)

  return {
    ...base,
    laborHours: hours,
    burdenedRate: cost.burdenedRate,
    directLabor: cost.directLabor,
    materials: round2(materials),
    equipment,
    overhead: cost.overhead,
    subcontractorCost: 0,
    loadedCost: cost.loadedCost,
    profit: cost.profit,
    marginPct: cost.marginPct,
    confidence: legacy ? 'partial' : 'full',
    note: legacy
      ? 'Quoted before burden settings were recorded; costed from the flat wage figure stored at the time.'
      : undefined,
  }
}

export interface JobEconomics {
  revenue: number
  loadedCost: number
  profit: number
  marginPct: number
  laborHours: number
  subcontractorCost: number
  lines: LineEconomics[]
  /** The weakest confidence across the lines that carry real money. */
  confidence: CostConfidence
  /** Revenue on lines with no recorded cost, so the margin can be read honestly. */
  uncostedRevenue: number
}

/**
 * Roll a set of lines into one job.
 *
 * Optional lines are excluded: they were priced for the client's consideration
 * and were not part of what was sold.
 */
export function jobEconomics(lineItems: StoredLineItem[]): JobEconomics {
  const lines = lineItems.filter(li => !li.isOptional).map(lineEconomics)

  const sum = (pick: (l: LineEconomics) => number) => round2(lines.reduce((t, l) => t + pick(l), 0))
  const revenue = sum(l => l.revenue)
  const loadedCost = sum(l => l.loadedCost)
  const profit = round2(revenue - loadedCost)
  const uncostedRevenue = round2(lines.filter(l => l.confidence === 'none').reduce((t, l) => t + l.revenue, 0))

  // Confidence is the weakest link, but only on lines that actually carry
  // money: a $0 placeholder line should not drag a real job's rating down.
  const material = lines.filter(l => l.revenue > 0)
  const confidence: CostConfidence =
    material.some(l => l.confidence === 'none') ? 'none'
      : material.some(l => l.confidence === 'partial') ? 'partial'
        : 'full'

  return {
    revenue,
    loadedCost,
    profit,
    marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
    laborHours: round2(lines.reduce((t, l) => t + l.laborHours, 0)),
    subcontractorCost: sum(l => l.subcontractorCost),
    lines,
    confidence: material.length ? confidence : 'none',
    uncostedRevenue,
  }
}
