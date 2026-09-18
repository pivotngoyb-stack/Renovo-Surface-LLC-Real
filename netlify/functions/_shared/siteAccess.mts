/**
 * Getting into a home (or a building after hours), and who is allowed to know.
 *
 * The row lives in its own table so no public route can reach it by accident
 * -- see siteAccess in db/schema.ts. This module is the other half: what a
 * valid entry looks like, and what the crew link is allowed to show.
 *
 * The rule for the crew link is narrow on purpose. The codes are needed for
 * the hours the job is open and at no other time. A link that still opens a
 * front door a month after the clean is a link that has been forwarded,
 * screenshotted and left on a phone somebody else now owns. So the moment the
 * job is logged, the codes drop off it. The office can clear the hours if the
 * crew needs to go back in, and the codes come back with them.
 */

export const ENTRY_METHODS = [
  { key: 'someone_home', label: 'Someone will be home to let the crew in' },
  { key: 'lockbox', label: 'Lockbox' },
  { key: 'keypad', label: 'Door keypad / smart lock code' },
  { key: 'garage_code', label: 'Garage keypad' },
  { key: 'hidden_key', label: 'Key left in an agreed spot' },
  { key: 'key_on_file', label: 'Renovo holds a key' },
  { key: 'other', label: 'Other (see details)' },
] as const

export type EntryMethod = (typeof ENTRY_METHODS)[number]['key']

const METHOD_KEYS = new Set<string>(ENTRY_METHODS.map(m => m.key))

export const entryMethodLabel = (key: string | null | undefined): string | null =>
  ENTRY_METHODS.find(m => m.key === key)?.label ?? null

/** Longest each field may be. Generous for instructions, tight for a code. */
export const ACCESS_LIMITS = {
  entryDetails: 500,
  alarmDetails: 500,
  pets: 300,
  parking: 300,
  instructions: 2000,
} as const

export interface SiteAccessValues {
  entryMethod: EntryMethod | null
  entryDetails: string | null
  alarmDetails: string | null
  pets: string | null
  parking: string | null
  instructions: string | null
}

type Parsed = { ok: true; value: SiteAccessValues } | { ok: false; error: string }

/*
 * Over-long text is refused, not trimmed. A door code cut short at character
 * 500 is a crew standing at a locked door with a code that does not work, and
 * nobody would know why until they were there.
 */
function field(body: Record<string, unknown>, name: keyof typeof ACCESS_LIMITS, label: string): string | null | Error {
  const v = body[name]
  if (v == null) return null
  if (typeof v !== 'string') return new Error(`${label} must be text`)
  const t = v.trim()
  if (!t) return null
  if (t.length > ACCESS_LIMITS[name]) return new Error(`${label} is too long (${ACCESS_LIMITS[name]} characters at most)`)
  return t
}

/** Validates a save from the admin form. Every field may be blank. */
export function parseSiteAccess(body: unknown): Parsed {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' }
  const b = body as Record<string, unknown>

  let entryMethod: EntryMethod | null = null
  if (b.entryMethod != null && b.entryMethod !== '') {
    if (typeof b.entryMethod !== 'string' || !METHOD_KEYS.has(b.entryMethod)) {
      return { ok: false, error: 'Pick how the crew gets in from the list' }
    }
    entryMethod = b.entryMethod as EntryMethod
  }

  const out: Record<string, string | null> = {}
  const labels: Record<keyof typeof ACCESS_LIMITS, string> = {
    entryDetails: 'The entry details',
    alarmDetails: 'The alarm details',
    pets: 'The pets note',
    parking: 'The parking note',
    instructions: 'The instructions',
  }
  for (const name of Object.keys(ACCESS_LIMITS) as (keyof typeof ACCESS_LIMITS)[]) {
    const v = field(b, name, labels[name])
    if (v instanceof Error) return { ok: false, error: v.message }
    out[name] = v
  }

  /*
   * A lockbox with no code is not an entry method, it is a locked door. Caught
   * here, while the owner is looking at the form, rather than by the crew on
   * the doorstep.
   */
  const needsDetails: EntryMethod[] = ['lockbox', 'keypad', 'garage_code', 'hidden_key', 'other']
  if (entryMethod && needsDetails.includes(entryMethod) && !out.entryDetails) {
    return { ok: false, error: `Add the code or where the key is -- "${entryMethodLabel(entryMethod)}" is no use to the crew without it` }
  }

  return {
    ok: true,
    value: {
      entryMethod,
      entryDetails: out.entryDetails,
      alarmDetails: out.alarmDetails,
      pets: out.pets,
      parking: out.parking,
      instructions: out.instructions,
    },
  }
}

/** True while the crew still needs to get in: not completed, no hours logged. */
export function accessIsOpen(workOrder: { status: string; actualHours: unknown }): boolean {
  return workOrder.status !== 'completed' && workOrder.actualHours == null
}

export interface CrewAccess {
  entryMethod: string | null
  entryDetails: string | null
  alarmDetails: string | null
  pets: string | null
  parking: string | null
  instructions: string | null
  /** True when codes existed but are no longer shown because the job is done. */
  codesHidden: boolean
}

/**
 * The access record as the crew link may carry it.
 *
 * An allowlist like every other outbound shape. Pets, parking and instructions
 * stay after the job -- they are not a way into anybody's house, and a crew
 * reading back over a finished job may still need them.
 */
export function crewAccess(
  row: Partial<SiteAccessValues> | null | undefined,
  workOrder: { status: string; actualHours: unknown },
): CrewAccess | null {
  if (!row) return null
  const open = accessIsOpen(workOrder)
  const hadCodes = !!(row.entryDetails || row.alarmDetails)
  const shaped: CrewAccess = {
    entryMethod: entryMethodLabel(row.entryMethod),
    entryDetails: open ? row.entryDetails ?? null : null,
    alarmDetails: open ? row.alarmDetails ?? null : null,
    pets: row.pets ?? null,
    parking: row.parking ?? null,
    instructions: row.instructions ?? null,
    codesHidden: !open && hadCodes,
  }
  // Nothing at all to say: no card on the crew page.
  const empty = !shaped.entryMethod && !shaped.entryDetails && !shaped.alarmDetails
    && !shaped.pets && !shaped.parking && !shaped.instructions && !shaped.codesHidden
  return empty ? null : shaped
}
