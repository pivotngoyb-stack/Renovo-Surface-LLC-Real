import { createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_COOKIE = 'renovo_admin_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 12 // 12 hours

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET environment variable is not set')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

/** Build a Set-Cookie header value for a fresh admin session. */
export function createSessionCookie(): string {
  const expires = Date.now() + SESSION_TTL_MS
  const payload = String(expires)
  const signature = sign(payload)
  const value = `${payload}.${signature}`
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
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

/** Returns true if the incoming request carries a valid, unexpired admin session cookie. */
export function isAuthenticated(request: Request): boolean {
  const cookies = parseCookies(request.headers.get('cookie'))
  const raw = cookies[SESSION_COOKIE]
  if (!raw) return false

  const dot = raw.lastIndexOf('.')
  if (dot === -1) return false
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  const expires = Number(payload)
  if (!Number.isFinite(expires) || Date.now() > expires) return false

  return true
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
