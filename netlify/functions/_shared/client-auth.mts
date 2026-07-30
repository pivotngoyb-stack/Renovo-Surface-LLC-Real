import { createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_COOKIE = 'renovo_client_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days
const LOGIN_LINK_TTL_MS = 1000 * 60 * 15 // 15 minutes

/**
 * Deliberately separate from _shared/auth.mts (admin auth) rather than extending
 * it -- different trust boundary (any client vs. the single business owner).
 * Reuses SESSION_SECRET so no new env var is needed, but every signed payload
 * carries an explicit `type` field so an admin cookie can never be replayed here
 * even if the raw cookie value were somehow reused.
 */
function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET environment variable is not set')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

function verify(raw: string): string | null {
  const dot = raw.lastIndexOf('.')
  if (dot === -1) return null
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return payload
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

export function createClientSessionCookie(clientId: number): string {
  const expires = Date.now() + SESSION_TTL_MS
  const payload = JSON.stringify({ clientId, expires, type: 'client-session' })
  const value = `${payload}.${sign(payload)}`
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
}

export function clearClientSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

/** Returns the authenticated client's id, or null if the cookie is missing/invalid/expired. */
export function getClientSession(request: Request): { clientId: number } | null {
  const cookies = parseCookies(request.headers.get('cookie'))
  const raw = cookies[SESSION_COOKIE]
  if (!raw) return null

  const payload = verify(decodeURIComponent(raw))
  if (!payload) return null

  try {
    const data = JSON.parse(payload)
    if (data.type !== 'client-session') return null
    if (!Number.isFinite(data.expires) || Date.now() > data.expires) return null
    if (!Number.isInteger(data.clientId)) return null
    return { clientId: data.clientId }
  } catch {
    return null
  }
}

/** Signed, time-limited magic-link token embedded in the login email URL. No DB row needed. */
export function createLoginLinkToken(clientId: number): string {
  const expires = Date.now() + LOGIN_LINK_TTL_MS
  const payload = JSON.stringify({ clientId, expires, type: 'client-login-link' })
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
}

export function verifyLoginLinkToken(token: string): { clientId: number } | null {
  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const payloadB64 = token.slice(0, dot)
  const signature = token.slice(dot + 1)

  let payload: string
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const data = JSON.parse(payload)
    if (data.type !== 'client-login-link') return null
    if (!Number.isFinite(data.expires) || Date.now() > data.expires) return null
    if (!Number.isInteger(data.clientId)) return null
    return { clientId: data.clientId }
  } catch {
    return null
  }
}
