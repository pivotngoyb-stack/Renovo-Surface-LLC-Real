/**
 * Estimate expiry.
 *
 * The client-facing estimate has always printed an "Expires" date, but nothing
 * enforced it: a client could open a months-old link and approve it, which
 * auto-creates a work order at stale pricing. These helpers are the single
 * source of truth so the date shown to the client and the date enforced on
 * approval can never drift apart.
 *
 * Dates are compared as calendar days in the business's own timezone. Comparing
 * in UTC would expire a Utah estimate up to seven hours early -- an estimate
 * valid "through the 30th" must stay approvable all day on the 30th, local time.
 */

const BUSINESS_TZ = 'America/Denver'
export const DEFAULT_VALID_DAYS = 30

/** Calendar date in the business timezone, as YYYY-MM-DD. */
function toBusinessDate(d: Date): string {
  // 'en-CA' formats as YYYY-MM-DD, which sorts correctly as a plain string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Today in the business timezone, as YYYY-MM-DD. */
export function businessToday(): string {
  return toBusinessDate(new Date())
}

/** Default expiry for a new estimate: 30 days out, as YYYY-MM-DD. */
export function defaultValidUntil(from: Date = new Date()): string {
  const d = new Date(from.getTime())
  d.setUTCDate(d.getUTCDate() + DEFAULT_VALID_DAYS)
  return toBusinessDate(d)
}

/**
 * The date an estimate actually expires. Rows created before expiry existed
 * have no validUntil; they fall back to created + 30 days, which is exactly
 * what the client-facing page has been displaying to them all along.
 */
export function effectiveExpiry(validUntil: string | null | undefined, createdAt: Date): string {
  return validUntil || defaultValidUntil(createdAt)
}

/** True once the expiry date has fully passed in the business timezone. */
export function isExpired(validUntil: string | null | undefined, createdAt: Date): boolean {
  return businessToday() > effectiveExpiry(validUntil, createdAt)
}
