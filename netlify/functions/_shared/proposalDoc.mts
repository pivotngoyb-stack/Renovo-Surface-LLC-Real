/**
 * Document assembly: the executive summary and the multi-year pricing table.
 *
 * Both exist because of how these documents are actually read. A facilities
 * director with fifteen competing bids reads the first paragraph and the
 * bottom-line number; a contracting officer reads the year-by-year table and
 * the total contract value. Neither reads the scope section first.
 */

import type { ContractValue } from './serviceSchedule.mts'

const round2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface ContractYear {
  label: string
  /** True for the base year, false for each option year. */
  isBase: boolean
  annualValue: number
}

export interface MultiYearSchedule {
  years: ContractYear[]
  totalContractValue: number
  escalationPct: number
  hasOptionYears: boolean
}

/**
 * Base year plus option years.
 *
 * Government solicitations almost always ask for a base year and some number
 * of option years priced separately, because the agency wants the right to
 * renew without re-bidding. Escalation is stated explicitly rather than baked
 * in silently -- an agency that sees a flat five-year price assumes you have
 * either padded year one or will come back asking for more.
 */
export function multiYearSchedule(
  contract: ContractValue,
  optionYears: number,
  escalationPct = 3,
): MultiYearSchedule {
  const options = Math.max(0, Math.min(Math.floor(optionYears || 0), 9))
  const base = contract.annualRecurring
  const years: ContractYear[] = []

  // Year one carries any one-time work; option years are recurring only.
  years.push({ label: 'Base Year', isBase: true, annualValue: round2(base + contract.oneTimeTotal) })

  for (let i = 1; i <= options; i++) {
    years.push({
      label: `Option Year ${i}`,
      isBase: false,
      annualValue: round2(base * Math.pow(1 + escalationPct / 100, i)),
    })
  }

  return {
    years,
    totalContractValue: round2(years.reduce((sum, y) => sum + y.annualValue, 0)),
    escalationPct,
    hasOptionYears: options > 0,
  }
}

export interface SummaryInput {
  serviceLabels: string[]
  contract: ContractValue
  /** Base total for non-recurring bids, tax excluded. */
  subtotal: number
  projectName?: string | null
  siteAddress?: string | null
  siteCount?: number
  walkthroughDate?: string | null
  expiresOn?: string | null
  frequencyLabels?: string[]
}

const fmtDate = (iso?: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Service labels as they should read mid-sentence. Stripping the prefix off
 * "Construction Cleanup — Final" left the word "final" standing alone, which
 * is not a service a client would recognise.
 */
function readableService(label: string): string {
  const m = label.match(/^Construction Cleanup — (.+)$/)
  if (m) return `post-construction ${m[1].toLowerCase()} cleaning`
  return label.replace(/^Commercial /, '').toLowerCase()
}

/** Joins a list the way a person writes it: "a, b and c". */
function readableList(items: string[]): string {
  const parts = items.filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Two or three sentences stating what is proposed, where, how often, and for
 * how much. Composed from the bid's own data so it can never describe work
 * that is not priced below.
 */
export function executiveSummary(input: SummaryInput): string[] {
  const { serviceLabels, contract, subtotal, projectName, siteAddress, siteCount, walkthroughDate, expiresOn, frequencyLabels } = input
  const out: string[] = []

  const services = readableList(serviceLabels.map(readableService))
  const where = (siteCount && siteCount > 1)
    ? `${siteCount} properties`
    : (projectName || siteAddress || 'the property described below')

  out.push(
    services
      ? `Renovo Surface Solutions proposes ${services.toLowerCase()} for ${where}.`
      : `Renovo Surface Solutions proposes the services detailed below for ${where}.`
  )

  if (contract.hasRecurring) {
    const cadence = frequencyLabels && frequencyLabels.length
      ? ` on a ${readableList([...new Set(frequencyLabels)])} schedule`
      : ''
    const oneTime = contract.oneTimeTotal > 0
      ? ` One-time work of ${usd(contract.oneTimeTotal)} is billed in year one only.`
      : ''
    out.push(
      `Recurring services are performed${cadence}, averaging ${usd(contract.monthlyAverage)} per month for an annual contract value of ${usd(contract.annualRecurring)}.${oneTime}`
    )
  } else {
    out.push(`The total price for the scope described is ${usd(subtotal)}, exclusive of applicable sales tax.`)
  }

  const walked = walkthroughDate ? `a site walk completed ${fmtDate(walkthroughDate)}` : 'the conditions described to us'
  const valid = expiresOn ? ` This proposal is valid through ${fmtDate(expiresOn)}.` : ''
  out.push(`Pricing reflects ${walked} and the exclusions and assumptions stated in this document.${valid}`)

  return out
}
