/**
 * Global job conditions: the multipliers that apply to every service.
 *
 * Every calculator here priced a job as if it happened on a Tuesday at 10am,
 * in an empty open-plan room, with two weeks' notice. Almost no commercial
 * cleaning work does. Office janitorial runs after the building empties,
 * medical runs around staff, and a flood callback runs tonight.
 *
 * Four axes, deliberately independent -- a hospital is occupied AND overnight,
 * a vacant tenant improvement is neither:
 *
 *   layout     how the floor plan slows the crew down       -> TIME
 *   occupancy  whether people are in the way                -> TIME
 *   shift      when the work happens                        -> PRICE and WAGE
 *   urgency    how much notice Renovo got                   -> PRICE and WAGE
 *
 * Layout and occupancy extend real time on site, so they raise cost as well as
 * price and they feed crew sizing. Shift and urgency are premiums: an overnight
 * crew is not slower, it is more expensive to staff and worth more to the
 * client. They carry a wage multiplier too, because a night differential is
 * real money out the door -- charging a 30% premium while booking cost at day
 * rates would report a margin Renovo never earned.
 *
 * Premiums apply to the labor and service portion only. Chemicals cost the same
 * at 2am as they do at noon, and marking them up as though they did not is the
 * sort of line an owner's rep will find.
 */

export interface ConditionOption {
  key: string
  label: string
  /** Multiplier on time on site. 1 means no effect. */
  time: number
  /** Multiplier on the labor and service portion of the price. */
  price: number
  /** Multiplier on the burdened wage -- shift differentials and overtime. */
  wage: number
  /** Sentence added to the proposal so the client sees what was assumed. */
  note?: string
}

const plain = (key: string, label: string): ConditionOption =>
  ({ key, label, time: 1, price: 1, wage: 1 })

/**
 * Floor-plan density, in the ISSA sense of obstruction: how much of the hour
 * goes into moving between spaces rather than cleaning them.
 *
 * Deliberately NOT facility type. Janitorial already carries a facility
 * multiplier (medical +45%, restaurant +25%) covering protocol and soil load;
 * putting building use on this axis too would charge for the same thing twice.
 */
export const LAYOUT: ConditionOption[] = [
  plain('standard', 'Standard mix, offices and corridors'),
  { key: 'open', label: 'Open floor plan: warehouse, showroom, big-box', time: 0.9, price: 1, wage: 1 },
  { key: 'partitioned', label: 'Partitioned / cubicle-dense', time: 1.15, price: 1, wage: 1 },
  {
    key: 'compartmented',
    label: 'Highly compartmented: many small rooms, exam rooms',
    time: 1.3, price: 1, wage: 1,
    note: 'Pricing assumes a highly compartmented floor plan; a materially more open layout may reduce the hours required.',
  },
]

export const OCCUPANCY: ConditionOption[] = [
  plain('vacant', 'Vacant / building empty during service'),
  {
    key: 'occupied',
    label: 'Occupied: crew works around staff and public',
    time: 1.15, price: 1, wage: 1,
    note: 'Service is performed while the facility is occupied. Areas in active use at the time of service are cleaned when they become available.',
  },
  {
    key: 'escorted',
    label: 'Restricted zones / escort required',
    time: 1.3, price: 1, wage: 1,
    note: 'Pricing assumes client-provided escort and access to restricted areas at the scheduled start time. Crew standby caused by delayed access is billable at the hourly rate.',
  },
]

/**
 * Shift premiums. The wage side reflects a real night differential (roughly
 * $1-3/hr on a $20 base) and statutory holiday practice; the price side is what
 * the market pays for the same work outside business hours.
 */
export const SHIFT: ConditionOption[] = [
  plain('standard', 'Standard hours, 7am to 5pm'),
  {
    key: 'evening', label: 'After hours, 5pm to 10pm',
    time: 1, price: 1.15, wage: 1.05,
    note: 'Service is scheduled outside normal business hours.',
  },
  {
    key: 'overnight', label: 'Overnight, 10pm to 6am',
    time: 1, price: 1.3, wage: 1.15,
    note: 'Service is scheduled overnight. Building access and alarm codes are to be provided in advance.',
  },
  {
    key: 'weekend', label: 'Weekend',
    time: 1, price: 1.25, wage: 1.1,
    note: 'Service is scheduled on a weekend.',
  },
  {
    key: 'holiday', label: 'Recognised holiday',
    time: 1, price: 1.5, wage: 1.5,
    note: 'Service is scheduled on a recognised holiday and is staffed at holiday pay rates.',
  },
]

export const URGENCY: ConditionOption[] = [
  plain('scheduled', 'Scheduled (normal lead time)'),
  {
    key: 'expedited', label: 'Expedited, within 48 hours',
    time: 1, price: 1.2, wage: 1.05,
    note: 'Expedited scheduling. Crew and equipment are committed ahead of the normal booking window.',
  },
  {
    key: 'emergency', label: 'Emergency, same day',
    time: 1, price: 1.5, wage: 1.25,
    note: 'Emergency same-day response. Crew is diverted from scheduled work and staffed at overtime rates.',
  },
]

export const AXES = { layout: LAYOUT, occupancy: OCCUPANCY, shift: SHIFT, urgency: URGENCY } as const
export type AxisName = keyof typeof AXES

/**
 * Layout and occupancy only mean something indoors. A parking lot has no
 * cubicles and a dumpster pad is never escorted, so offering those controls on
 * exterior work would invite a multiplier that describes nothing.
 */
export const INTERIOR_SERVICES = new Set([
  'janitorial',
  'floorCare',
  'disinfection',
  'carpetExtraction',
  'tileGrout',
  'ventCleaning',
  'windowCleaning',
  'constructionRough',
  'constructionProgress',
  'constructionFinal',
  'constructionTouchup',
])

export function axisApplies(axis: AxisName, service: string): boolean {
  if (axis === 'layout' || axis === 'occupancy') return INTERIOR_SERVICES.has(service)
  return true
}

export type ConditionSelection = Partial<Record<AxisName, string>>

const isNeutral = (o: ConditionOption) => o.time === 1 && o.price === 1 && o.wage === 1

/**
 * An unrecognised or absent key must resolve to a multiplier of 1, never to
 * whatever happens to be listed first. A default that quietly discounts or
 * surcharges every job nobody configured is worse than no default at all.
 */
function option(axis: AxisName, key: string | undefined): ConditionOption {
  const list = AXES[axis]
  return list.find(o => o.key === key) || list.find(isNeutral) || list[0]
}

export interface ConditionEffect {
  /** Multiplier on hours on site. */
  timeMultiplier: number
  /** Multiplier on the labor and service portion of the price. */
  priceMultiplier: number
  /** Multiplier on the burdened wage. */
  wageMultiplier: number
  /** The chosen option on each axis that actually applies to this service. */
  selected: Array<{ axis: AxisName; option: ConditionOption }>
  /** Scope sentences for the proposal, in axis order. */
  notes: string[]
  /** True when anything is non-default -- lets the UI stay quiet otherwise. */
  anyApplied: boolean
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

const pct = (m: number) => `${m > 1 ? '+' : '-'}${Math.round(Math.abs(m - 1) * 100)}%`

/**
 * Dropdown text, with the effect derived from the multipliers rather than typed
 * into the label. Hardcoding "+15%" beside a 1.20 is a lie that survives review
 * because both halves look deliberate.
 */
export function optionLabel(o: ConditionOption): string {
  const bits: string[] = []
  if (o.time !== 1) bits.push(`${pct(o.time)} time`)
  if (o.price !== 1) bits.push(`${pct(o.price)} price`)
  return bits.length ? `${o.label} (${bits.join(', ')})` : o.label
}

/**
 * Resolve a selection into multipliers.
 *
 * Axes stack multiplicatively and are NOT capped. An overnight emergency on a
 * holiday genuinely is a 2.9x job, and clamping the total would hide the reason
 * the number is large -- the same mistake the old price floor made. The
 * combined multiplier is returned so the UI can show it plainly instead.
 */
export function resolveConditions(service: string, sel: ConditionSelection = {}): ConditionEffect {
  const selected: ConditionEffect['selected'] = []
  const notes: string[] = []
  let time = 1
  let price = 1
  let wage = 1

  ;(Object.keys(AXES) as AxisName[]).forEach(axis => {
    if (!axisApplies(axis, service)) return
    const opt = option(axis, sel[axis])
    selected.push({ axis, option: opt })
    time *= opt.time
    price *= opt.price
    wage *= opt.wage
    if (opt.note) notes.push(opt.note)
  })

  return {
    timeMultiplier: round3(time),
    priceMultiplier: round3(price),
    wageMultiplier: round3(wage),
    selected,
    notes,
    anyApplied: selected.some(s => s.option.time !== 1 || s.option.price !== 1),
  }
}

/** Human-readable summary for a work order or line-item description. */
export function conditionSummary(service: string, sel: ConditionSelection = {}): string {
  const eff = resolveConditions(service, sel)
  const parts = eff.selected
    .filter(s => s.option.time !== 1 || s.option.price !== 1)
    .map(s => s.option.label.replace(/\s*\([^)]*\)\s*$/, '').trim())
  return parts.join('; ')
}
