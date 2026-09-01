/**
 * Turning a contract frequency into the actual days a crew is on site.
 *
 * A recurring contract used to produce exactly one work order, because
 * createWorkOrderForEstimate refused to make a second one. So a weekly
 * janitorial account sold on one estimate had a single work order covering a
 * year of visits, one completedAt, and one set of actual hours. The
 * profitability report was grading fifty-two visits from one data point, and
 * the schedule could not say who was going where on Thursday.
 *
 * This is the piece that was missing: given a frequency and a starting point,
 * which dates does the crew actually owe.
 *
 * All arithmetic is on UTC date parts. A visit is a calendar day, not an
 * instant, and doing this in local time means the week Utah changes clocks
 * quietly produces a duplicate or a gap.
 */

import { frequencyOf } from './serviceSchedule.mts'

/** 'YYYY-MM-DD' for a UTC date. The form Postgres `date` columns want. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Parses 'YYYY-MM-DD' as UTC midnight, avoiding the local-timezone shift. */
export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime())
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

/**
 * `n` months on from an anchor, clamping to the end of a short month.
 *
 * A monthly contract starting on the 31st is on the 28th in February and back
 * to the 31st in March. Two ways to get that wrong, and this signature exists
 * to rule out both:
 *
 *   * Letting the date overflow walks the schedule forward -- Jan 31 + 1 month
 *     becoming Mar 3, and every visit after it drifting further.
 *   * Stepping from the previous *clamped* date makes the clamp permanent.
 *     February pulls the 31st back to the 28th, March then steps from the 28th,
 *     and the contract silently moves to the 28th for good.
 *
 * So the offset is always measured from the original anchor, never from the
 * date last produced.
 */
function monthsFromAnchor(anchor: Date, n: number): Date {
  const day = anchor.getUTCDate()
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + n, 1))
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, daysInMonth)))
}

export interface VisitPlan {
  /** 'YYYY-MM-DD' */
  date: string
  /** 1-based across the whole contract, continuing from visits already made. */
  sequence: number
}

/**
 * The next `count` visit dates for a frequency, starting on or after `from`.
 *
 * Weekday-based frequencies (daily, 2x, 3x, weekly, biweekly) land on the day
 * pattern the proposal advertised, so the schedule the client was sold is the
 * schedule that gets dispatched. Periodic ones (monthly and longer) step from
 * the start date, keeping the day of the month the client agreed to.
 */
export function visitDates(
  frequencyKey: string | null | undefined,
  from: Date,
  count: number,
  startSequence = 1,
): VisitPlan[] {
  const freq = frequencyOf(frequencyKey)
  if (!freq.recurring || count <= 0) return []

  const out: VisitPlan[] = []
  const push = (d: Date) => out.push({ date: isoDate(d), sequence: startSequence + out.length })

  if (freq.days.length) {
    // Weekday pattern. Walk forward a day at a time and take the matches; the
    // week stride handles biweekly without a separate branch.
    const stride = freq.key === 'biweekly' ? 2 : 1
    let cursor = new Date(from.getTime())
    // Anchor to the Sunday of the starting week so the stride is stable.
    const anchor = addDays(cursor, -cursor.getUTCDay())
    let guard = 0
    while (out.length < count && guard++ < 4000) {
      const weeksFromAnchor = Math.floor((cursor.getTime() - anchor.getTime()) / (7 * 86400000))
      if (weeksFromAnchor % stride === 0 && freq.days.includes(cursor.getUTCDay()) && cursor >= from) {
        push(cursor)
      }
      cursor = addDays(cursor, 1)
    }
    return out
  }

  // Periodic. monthly=1, quarterly=3, semiannual=6, annual=12.
  const monthStep = Math.max(1, Math.round(12 / freq.visitsPerYear))
  for (let i = 0; i < count; i++) push(monthsFromAnchor(from, i * monthStep))
  return out
}

/**
 * How many visits a period covers, so "generate 3 months" means what it says
 * rather than making the operator count Wednesdays.
 */
export function visitsInMonths(frequencyKey: string | null | undefined, months: number): number {
  const freq = frequencyOf(frequencyKey)
  if (!freq.recurring) return 0
  return Math.max(1, Math.round((freq.visitsPerYear * months) / 12))
}

/**
 * Guard rail on how many visits may be generated at once.
 *
 * A daily contract is 260 work orders a year. Generating a year of those in
 * one click makes a list nobody can read and a schedule nobody can change, and
 * every one of them is a row that has to be deleted by hand if the contract
 * moves. A quarter at a time keeps the horizon honest.
 */
export const MAX_VISITS_PER_RUN = 90
