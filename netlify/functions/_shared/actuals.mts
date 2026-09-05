/**
 * What a job actually took, and the rules for accepting it.
 *
 * Shared because two routes now write it: the admin work-order page and the
 * crew's own link. Duplicated, they would drift, and the drift would be silent
 * -- the crew route quietly accepting a figure the admin route rejects, on the
 * one measurement the whole profitability report rests on.
 */

/** A week of crew time on one job. Anything past this is a typo, not a job. */
export const MAX_HOURS = 400
export const MAX_CREW = 30
export const MAX_NOTE = 500
/** A single visit spending more than this on chemicals is a typo. */
export const MAX_MATERIALS = 50000

export interface ActualsInput {
  actualHours?: unknown
  actualCrewSize?: unknown
  actualMaterialsCost?: unknown
  note?: unknown
}

export interface ParsedActuals {
  hours: string | null
  crew: number | null
  materials: string | null
  note: string | null
  /**
   * True when the submission clears the figures rather than setting them.
   *
   * "Not recorded" and "took no time" are different facts and the report reads
   * them differently, so an empty submission nulls the columns instead of
   * storing zero. Hours are the anchor: clearing them clears the rest, since
   * materials with no hours describes a job nobody worked.
   */
  clearing: boolean
}

/** Either the parsed figures, or the message to send back. */
export type ActualsResult = { ok: true; value: ParsedActuals } | { ok: false; error: string }

export function parseActuals(body: ActualsInput): ActualsResult {
  const clearing = body.actualHours === null || body.actualHours === ''

  let hours: string | null = null
  let crew: number | null = null
  let materials: string | null = null

  if (!clearing) {
    const h = Number(body.actualHours)
    if (!Number.isFinite(h) || h <= 0) {
      return { ok: false, error: 'Enter the total crew hours the job took' }
    }
    if (h > MAX_HOURS) {
      return { ok: false, error: `That is more than ${MAX_HOURS} crew hours -- please check the figure` }
    }
    hours = String(Math.round(h * 100) / 100)

    if (body.actualCrewSize != null && body.actualCrewSize !== '') {
      const c = Number(body.actualCrewSize)
      if (!Number.isInteger(c) || c < 1 || c > MAX_CREW) {
        return { ok: false, error: `Crew size must be a whole number between 1 and ${MAX_CREW}` }
      }
      crew = c
    }

    if (body.actualMaterialsCost != null && body.actualMaterialsCost !== '') {
      const m = Number(body.actualMaterialsCost)
      // Zero is meaningful here in a way it is not for hours: plenty of visits
      // genuinely consume nothing, and recording that is a real measurement.
      if (!Number.isFinite(m) || m < 0) {
        return { ok: false, error: 'Materials cost cannot be negative' }
      }
      if (m > MAX_MATERIALS) {
        return { ok: false, error: `That is more than ${MAX_MATERIALS.toLocaleString()} dollars in materials -- please check the figure` }
      }
      materials = String(Math.round(m * 100) / 100)
    }
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : null
  return { ok: true, value: { hours, crew, materials, note: note || null, clearing } }
}

/**
 * The status change logging hours implies, if any.
 *
 * A visit has nothing to sign, so 'signed' can never arrive and the status
 * would sit at 'pending' forever -- every past visit reading as work nobody
 * did. Hours against it are the only evidence the crew was there, so that is
 * the signal. Clearing them takes it back to pending, because the evidence has
 * been withdrawn.
 *
 * An authorization keeps its own status. That one really is about a client's
 * signature, and hours must never stand in for their agreement.
 */
export function visitStatusFor(kind: string, clearing: boolean):
  { status: 'pending' | 'completed'; completedAt: Date | null } | Record<string, never> {
  if (kind !== 'visit') return {}
  return { status: clearing ? 'pending' : 'completed', completedAt: clearing ? null : new Date() }
}
