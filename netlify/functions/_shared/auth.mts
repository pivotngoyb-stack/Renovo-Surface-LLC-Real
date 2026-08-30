import { createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_COOKIE = 'renovo_admin_session'

/**
 * Session lifetime.
 *
 * This used to be a single fixed 12-hour window stamped at login: it never
 * refreshed on activity and never shortened when idle, so an unattended laptop
 * stayed logged in for the full 12 hours while an admin working all day got
 * signed out mid-task. Now the window slides with activity but is still capped
 * in absolute terms, so a forgotten session dies quietly a couple of hours
 * later and no session can live longer than a working day.
 */
const IDLE_TTL_MS = 1000 * 60 * 60 * 2 // signed out after 2 hours of inactivity
const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 12 // hard ceiling regardless of activity

/** Don't re-issue the cookie on every single request; once a minute is plenty. */
const REFRESH_INTERVAL_MS = 1000 * 60

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET environment variable is not set')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

function cookieFor(issued: number, expires: number): string {
  // Payload is `<issued>.<expires>`; the signature is appended after a final
  // dot, and parsing splits on the LAST dot, so the inner dot is unambiguous.
  const payload = `${issued}.${expires}`
  return `${SESSION_COOKIE}=${payload}.${sign(payload)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.round(IDLE_TTL_MS / 1000)}`
}

/** Build a Set-Cookie header value for a fresh admin session. */
export function createSessionCookie(): string {
  const now = Date.now()
  return cookieFor(now, now + IDLE_TTL_MS)
}

/** Set-Cookie header value that clears the admin session (for logout). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    out[k] = v
  }
  return out
}

interface SessionPayload {
  /** When the session first began. Absent on pre-sliding cookies. */
  issued: number | null
  /** When it lapses if nothing else happens. */
  expires: number
}

/**
 * Verifies the signature and returns the timestamps, or null.
 *
 * Accepts the older single-timestamp payload so sessions minted before sliding
 * expiry existed keep working until they lapse on their own -- rolling this out
 * should not sign everyone out. Those legacy cookies simply never slide.
 */
function readSession(request: Request): SessionPayload | null {
  const cookies = parseCookies(request.headers.get('cookie'))
  const raw = cookies[SESSION_COOKIE]
  if (!raw) return null

  const dot = raw.lastIndexOf('.')
  if (dot === -1) return null
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const parts = payload.split('.')
  if (parts.length === 1) {
    const expires = Number(parts[0])
    if (!Number.isFinite(expires)) return null
    return { issued: null, expires }
  }
  if (parts.length === 2) {
    const issued = Number(parts[0])
    const expires = Number(parts[1])
    if (!Number.isFinite(issued) || !Number.isFinite(expires)) return null
    return { issued, expires }
  }
  return null
}

/** Returns true if the request carries a valid, unexpired admin session. */
export function isAuthenticated(request: Request): boolean {
  const session = readSession(request)
  if (!session) return false

  const now = Date.now()
  if (now > session.expires) return false
  // Absolute ceiling applies only to cookies that record when they began.
  if (session.issued !== null && now > session.issued + ABSOLUTE_TTL_MS) return false
  return true
}

/**
 * A Set-Cookie value extending the idle window for an active admin, or null
 * when there is nothing to do: no valid session, a legacy cookie that carries
 * no start time, the absolute ceiling reached, or simply refreshed recently.
 *
 * Returning null rather than throwing lets callers write
 * `const c = refreshedSessionCookie(req); if (c) headers['Set-Cookie'] = c`.
 */
export function refreshedSessionCookie(request: Request): string | null {
  const session = readSession(request)
  if (!session) return null

  const now = Date.now()
  if (now > session.expires) return null
  if (session.issued === null) return null
  if (now > session.issued + ABSOLUTE_TTL_MS) return null

  // Skip if this cookie was already refreshed within the last interval.
  const lastRefreshed = session.expires - IDLE_TTL_MS
  if (now - lastRefreshed < REFRESH_INTERVAL_MS) return null

  // Never let the sliding window run past the absolute ceiling.
  const nextExpiry = Math.min(now + IDLE_TTL_MS, session.issued + ABSOLUTE_TTL_MS)
  return cookieFor(session.issued, nextExpiry)
}

/** Constant-time password check against the ADMIN_PASSWORD env var. */
export function verifyPassword(submitted: string): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) throw new Error('ADMIN_PASSWORD environment variable is not set')
  const a = Buffer.from(submitted)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
