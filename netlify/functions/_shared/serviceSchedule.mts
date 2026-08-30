/**
 * Service frequency, annual contract value, and the schedule matrix.
 *
 * A recurring commercial proposal is judged on two numbers the current
 * document could not produce: what it costs per year, and what actually
 * happens on which day. A property manager comparing three janitorial bids
 * cannot compare "$1,240" against "$980" without knowing one is weekly and
 * the other is three times a week.
 *
 * The day patterns below are proposals, not commitments -- the document says
 * so. Contractors set the real days at contract signing, but showing a
 * concrete pattern is what makes a bid readable.
 */

export interface Frequency {
  key: string
  label: string
  /** Billable occurrences per year. One-time work is 1 and excluded from ACV. */
  visitsPerYear: number
  /** 0 = Sunday. Empty for periodic services that do not land on a weekday. */
  days: number[]
  /** True for anything that recurs; drives the annual contract value. */
  recurring: boolean
}

export const FREQUENCIES: Frequency[] = [
  { key: 'one_time', label: 'One-time', visitsPerYear: 1, days: [], recurring: false },
  // 5 weekday services x 52 weeks. Commercial janitorial is almost never 7-day.
  { key: 'daily', label: 'Daily (Mon–Fri)', visitsPerYear: 260, days: [1, 2, 3, 4, 5], recurring: true },
  { key: '3x_week', label: '3x per week', visitsPerYear: 156, days: [1, 3, 5], recurring: true },
  { key: '2x_week', label: '2x per week', visitsPerYear: 104, days: [2, 4], recurring: true },
  { key: 'weekly', label: 'Weekly', visitsPerYear: 52, days: [3], recurring: true },
  { key: 'biweekly', label: 'Every 2 weeks', visitsPerYear: 26, days: [3], recurring: true },
  { key: 'monthly', label: 'Monthly', visitsPerYear: 12, days: [], recurring: true },
  { key: 'quarterly', label: 'Quarterly', visitsPerYear: 4, days: [], recurring: true },
  { key: 'semiannual', label: 'Twice per year', visitsPerYear: 2, days: [], recurring: true },
  { key: 'annual', label: 'Annually', visitsPerYear: 1, days: [], recurring: true },
]

const BY_KEY: Record<string, Frequency> = Object.fromEntries(FREQUENCIES.map(f => [f.key, f]))

export function frequencyOf(key: string | null | undefined): Frequency {
  return BY_KEY[key || 'one_time'] || BY_KEY.one_time
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface ScheduleLine {
  description: string
  quantity: string | number
  unitPrice: string | number
  unit?: string | null
  frequency?: string | null
  siteName?: string | null
  isOptional?: boolean
  serviceType?: string | null
}

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const round2 = (n: number) => Math.round(n * 100) / 100
const lineTotal = (li: ScheduleLine) => money(li.quantity) * money(li.unitPrice)

export interface ContractValue {
  /** Work that happens once: mobilisation, deep cleans, construction phases. */
  oneTimeTotal: number
  /** Per-occurrence value of everything recurring, summed. */
  recurringPerVisit: number
  /** Recurring work extended over twelve months. */
  annualRecurring: number
  /** What the client pays in year one, one-time work included. */
  firstYearTotal: number
  /** Recurring only, averaged per month -- the number a facility manager budgets. */
  monthlyAverage: number
  hasRecurring: boolean
}

/**
 * Annual contract value.
 *
 * Optional lines are excluded throughout: they are alternates the client has
 * not accepted, and rolling them into an annual figure would overstate the
 * commitment being asked for.
 */
export function contractValue(lines: ScheduleLine[]): ContractValue {
  const billable = lines.filter(l => !l.isOptional)

  let oneTimeTotal = 0
  let recurringPerVisit = 0
  let annualRecurring = 0

  for (const li of billable) {
    const f = frequencyOf(li.frequency)
    const total = lineTotal(li)
    if (f.recurring) {
      recurringPerVisit += total
      annualRecurring += total * f.visitsPerYear
    } else {
      oneTimeTotal += total
    }
  }

  return {
    oneTimeTotal: round2(oneTimeTotal),
    recurringPerVisit: round2(recurringPerVisit),
    annualRecurring: round2(annualRecurring),
    firstYearTotal: round2(oneTimeTotal + annualRecurring),
    monthlyAverage: round2(annualRecurring / 12),
    hasRecurring: annualRecurring > 0,
  }
}

export interface MatrixRow {
  service: string
  frequencyLabel: string
  /** Seven booleans, Sunday first. */
  days: boolean[]
  visitsPerYear: number
}

export interface ScheduleMatrix {
  /** Services that land on specific weekdays. */
  weekly: MatrixRow[]
  /** Monthly and longer -- shown as a cadence list, not a weekday grid. */
  periodic: MatrixRow[]
  hasAny: boolean
}

/**
 * The grid every professional janitorial proposal carries.
 *
 * Weekday services get a day grid; monthly and longer get a cadence list,
 * because putting "quarterly" in a Monday column is meaningless.
 */
export function buildScheduleMatrix(lines: ScheduleLine[]): ScheduleMatrix {
  const weekly: MatrixRow[] = []
  const periodic: MatrixRow[] = []

  for (const li of lines) {
    if (li.isOptional) continue
    const f = frequencyOf(li.frequency)
    if (!f.recurring) continue

    // Keep the row label short: the full sentence lives in the scope section.
    const service = String(li.description || 'Service').split(/[.(]/)[0].trim().slice(0, 60)
    const row: MatrixRow = {
      service,
      frequencyLabel: f.label,
      days: [0, 1, 2, 3, 4, 5, 6].map(d => f.days.includes(d)),
      visitsPerYear: f.visitsPerYear,
    }
    ;(f.days.length ? weekly : periodic).push(row)
  }

  return { weekly, periodic, hasAny: weekly.length > 0 || periodic.length > 0 }
}

export interface SiteGroup {
  siteName: string
  lines: ScheduleLine[]
  subtotal: number
}

/**
 * Groups line items by site for portfolio proposals.
 *
 * Returns null when everything belongs to one site, so a single-location
 * proposal is not cluttered with a redundant grouping header.
 */
export function groupBySite(lines: ScheduleLine[]): SiteGroup[] | null {
  const named = lines.filter(l => l.siteName && String(l.siteName).trim())
  if (!named.length) return null

  const distinct = new Set(named.map(l => String(l.siteName).trim()))
  if (distinct.size < 2) return null

  const groups = new Map<string, SiteGroup>()
  for (const li of lines) {
    const key = (li.siteName && String(li.siteName).trim()) || 'Unassigned'
    if (!groups.has(key)) groups.set(key, { siteName: key, lines: [], subtotal: 0 })
    const g = groups.get(key)!
    g.lines.push(li)
    if (!li.isOptional) g.subtotal = round2(g.subtotal + lineTotal(li))
  }
  return [...groups.values()]
}

/**
 * Portfolio discount tier. Managing several properties for one client is
 * genuinely cheaper per site -- shared mobilisation, one invoice, one contact
 * -- and every national competitor prices that in.
 */
export function portfolioDiscountPct(siteCount: number): number {
  if (siteCount >= 10) return 10
  if (siteCount >= 6) return 7
  if (siteCount >= 3) return 5
  return 0
}
