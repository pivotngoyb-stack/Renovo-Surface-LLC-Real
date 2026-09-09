/**
 * The clock on getting paid.
 *
 * A mechanic's lien is the only real leverage a cleaning contractor has when a
 * general contractor stops answering the phone on a six-figure receivable. It
 * is also the easiest thing in the business to lose: the right is preserved by
 * filing a notice within days of starting work, and nobody thinks about being
 * unpaid in the first week of a job they just won.
 *
 * Miss the window and the invoice is still owed -- it is just unsecured, which
 * on a project where the owner has already paid the GC means it is owed by
 * somebody with no reason to pay and nothing to lose.
 *
 * WHAT THIS IS NOT
 *
 * Not legal advice, and not a filing service. It is a calendar. The windows
 * below are Utah defaults as commonly stated, and they are configurable
 * precisely because deadlines move, vary by project type and public-versus-
 * private, and are exactly the sort of thing that should be confirmed with
 * counsel rather than taken from a cleaning company's admin tool. The value
 * here is being reminded on day four instead of remembering on day forty.
 */

/**
 * Days from first furnishing labor to the preliminary notice deadline.
 *
 * Utah runs this through the State Construction Registry, and the notice is
 * filed against the project rather than served on anybody. Twenty days is the
 * figure usually quoted; a project the notice is late on generally preserves
 * rights only for work performed in the twenty days before it was filed, which
 * is why late is not the same as useless -- but it is not what was earned.
 */
export const PRELIMINARY_NOTICE_DAYS = 20

/** Days from final completion to filing the lien itself. */
export const LIEN_FILING_DAYS = 90

/** Days from filing the lien to starting the action that enforces it. */
export const LIEN_ENFORCEMENT_DAYS = 180

/** Start warning this far out, so there is time to actually do it. */
export const WARN_WITHIN_DAYS = 7

/**
 * Public work has no lien, and that is not a detail.
 *
 * A mechanic's lien attaches to the property, and you cannot attach one to a
 * school or a courthouse. On a public project the remedy is a claim against
 * the general contractor's payment bond instead -- a different document, a
 * different clock, and a deadline that turns on whether Renovo has a direct
 * contract with that contractor.
 *
 * That last part is genuinely a lawyer's question, so this module does not
 * invent a number for it. Marking a project public replaces the lien steps
 * with one instruction -- get the bond and find out the date -- and then
 * tracks whatever date comes back. A confident-looking deadline that was
 * guessed is worse than a blank one that says "go and ask".
 */
export type ProjectType = 'private' | 'public'

export interface LienRecord {
  /** The day the crew first furnished labor. The clock starts here. */
  firstWorkDate: string | null
  preliminaryFiledAt: string | null
  /** Final completion of the project, not of our part of it. */
  completionDate: string | null
  lienFiledAt: string | null
  /** A deliberate decision not to preserve rights on this job. */
  waived: boolean
  /** Private property, or a public owner where no lien can attach. */
  projectType?: ProjectType | null
  /** The bond claim deadline, once counsel or the bond itself has supplied it. */
  bondNoticeDue?: string | null
  bondNoticeFiledAt?: string | null
  /** Surety and bond number, so the claim can be made without hunting. */
  bondReference?: string | null
}

export type LienUrgency = 'none' | 'ok' | 'due-soon' | 'overdue' | 'done' | 'waived'

export interface LienStep {
  key: 'preliminary' | 'lien' | 'bond'
  label: string
  /** ISO date the step is due, or null when the clock has not started. */
  dueOn: string | null
  daysLeft: number | null
  urgency: LienUrgency
  message: string
}

const DAY = 86_400_000

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) ? null : d
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)

/** Whole days from today to the target, negative once it has passed. */
const daysUntil = (target: Date, today: Date) =>
  Math.ceil((target.getTime() - Date.parse(iso(today) + 'T00:00:00Z')) / DAY)

/**
 * Where this job stands on preserving its lien rights.
 *
 * Both steps are always returned, including the ones whose clock has not
 * started. A step that vanishes until it is relevant is a step nobody plans
 * for, and the whole failure being addressed is not planning for it.
 */
export function lienSteps(record: LienRecord, today = new Date()): LienStep[] {
  const waived = record.waived

  const step = (
    key: LienStep['key'],
    label: string,
    startedOn: Date | null,
    windowDays: number,
    filedOn: Date | null,
    notStartedMessage: string,
  ): LienStep => {
    if (waived) {
      return { key, label, dueOn: null, daysLeft: null, urgency: 'waived',
        message: 'Lien rights deliberately not preserved on this job.' }
    }
    if (filedOn) {
      return { key, label, dueOn: null, daysLeft: null, urgency: 'done',
        message: `Filed ${iso(filedOn)}.` }
    }
    if (!startedOn) {
      return { key, label, dueOn: null, daysLeft: null, urgency: 'none', message: notStartedMessage }
    }

    const due = addDays(startedOn, windowDays)
    const left = daysUntil(due, today)

    if (left < 0) {
      return {
        key, label, dueOn: iso(due), daysLeft: left, urgency: 'overdue',
        message: `The window closed ${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} ago, on ${iso(due)}. `
          + 'Filing late may still preserve something, and it is worth asking counsel today rather than next week.',
      }
    }
    if (left <= WARN_WITHIN_DAYS) {
      return {
        key, label, dueOn: iso(due), daysLeft: left, urgency: 'due-soon',
        message: left === 0
          ? `Due today, ${iso(due)}.`
          : `Due in ${left} day${left === 1 ? '' : 's'}, on ${iso(due)}.`,
      }
    }
    return {
      key, label, dueOn: iso(due), daysLeft: left, urgency: 'ok',
      message: `Due ${iso(due)}, ${left} days away.`,
    }
  }

  /*
   * On public work there is one step, and its date is not computed.
   *
   * No lien attaches to a school, so the two windows above are the wrong
   * windows entirely. The bond claim deadline depends on facts this app does
   * not hold -- chiefly whether there is a direct contract with the general
   * contractor -- so it is asked for rather than derived, and until it arrives
   * the step says what to go and do.
   */
  if (record.projectType === 'public') {
    const filed = parse(record.bondNoticeFiledAt)
    const due = parse(record.bondNoticeDue)

    if (waived) {
      return [{ key: 'bond', label: 'Payment bond claim', dueOn: null, daysLeft: null, urgency: 'waived',
        message: 'Bond rights deliberately not preserved on this job.' }]
    }
    if (filed) {
      return [{ key: 'bond', label: 'Payment bond claim', dueOn: null, daysLeft: null, urgency: 'done',
        message: `Notice given ${iso(filed)}.${record.bondReference ? ` Bond ${record.bondReference}.` : ''}` }]
    }
    if (!due) {
      return [{
        key: 'bond', label: 'Payment bond claim', dueOn: null, daysLeft: null, urgency: 'none',
        message: 'Public project, so no lien attaches -- the remedy is a claim on the general contractor\'s '
          + 'payment bond. Ask the contractor for a copy of the bond now, while they are still pleased with you, '
          + 'and confirm the notice deadline with counsel. It turns on whether you contract directly with them. '
          + 'Record the date here and this becomes a countdown.',
      }]
    }

    const left = daysUntil(due, today)
    return [{
      key: 'bond',
      label: 'Payment bond claim',
      dueOn: iso(due),
      daysLeft: left,
      urgency: left < 0 ? 'overdue' : left <= WARN_WITHIN_DAYS ? 'due-soon' : 'ok',
      message: left < 0
        ? `The notice date you recorded passed ${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} ago, on ${iso(due)}. Ring counsel today.`
        : left === 0
          ? `Notice due today, ${iso(due)}.`
          : `Notice due in ${left} day${left === 1 ? '' : 's'}, on ${iso(due)}.`,
    }]
  }

  return [
    step(
      'preliminary',
      'Preliminary notice',
      parse(record.firstWorkDate),
      PRELIMINARY_NOTICE_DAYS,
      parse(record.preliminaryFiledAt),
      'The clock starts the day the crew first furnishes labor. Record that date and this becomes a deadline.',
    ),
    step(
      'lien',
      'Lien filing',
      parse(record.completionDate),
      LIEN_FILING_DAYS,
      parse(record.lienFiledAt),
      'Runs from final completion of the project, which has not been recorded yet.',
    ),
  ]
}

/** The worst state across the steps, for a single badge on a list. */
export function lienUrgency(steps: LienStep[]): LienUrgency {
  const order: LienUrgency[] = ['overdue', 'due-soon', 'ok', 'none', 'done', 'waived']
  for (const u of order) if (steps.some(s => s.urgency === u)) return u
  return 'none'
}

/** True when somebody needs to look at this today. */
export const lienNeedsAttention = (steps: LienStep[]) =>
  steps.some(s => s.urgency === 'overdue' || s.urgency === 'due-soon')
