import type { Config, Context } from '@netlify/edge-functions'

/**
 * Blocks unauthenticated requests to the admin UI at the CDN edge.
 *
 * Without this, public/admin/*.html are ordinary static assets: anyone could
 * open /admin/estimate-new.html and read the page source. The API behind those
 * pages was always 401-gated so no customer records were exposed, but the
 * pricing engine is inlined in that page -- hourly rate, wage cost, margin
 * math, minimum billable hours, chemical costs, market-rate floors -- so the
 * whole pricing model was readable by anyone who guessed the URL.
 *
 * This runs on Deno, not Node, so it cannot import _shared/auth.mts. The
 * verification below MUST stay byte-for-byte identical to isAuthenticated()
 * there: same cookie name, same `<issued>.<expires>.<base64url-hmac-sha256>`
 * format, same secret, same absolute ceiling. If the two drift apart, either
 * every session breaks or the gate stops gating.
 */

const SESSION_COOKIE = 'renovo_admin_session'

/** Must match ABSOLUTE_TTL_MS in _shared/auth.mts. */
const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 12

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  // Node's .digest('base64url') emits unpadded base64url, so strip '='.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return base64url(new Uint8Array(sig))
}

/** Length-safe, data-independent comparison. Web Crypto has no timingSafeEqual. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

async function hasValidSession(request: Request, secret: string): Promise<boolean> {
  const raw = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (!raw) return false

  const dot = raw.lastIndexOf('.')
  if (dot === -1) return false
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)

  if (!constantTimeEqual(signature, await sign(payload, secret))) return false

  // `<issued>.<expires>`, or a bare `<expires>` on cookies minted before
  // sliding expiry existed. Legacy cookies have no start time, so the absolute
  // ceiling cannot apply to them; they simply lapse at their own expiry.
  const parts = payload.split('.')
  let issued: number | null = null
  let expires: number

  if (parts.length === 1) {
    expires = Number(parts[0])
  } else if (parts.length === 2) {
    issued = Number(parts[0])
    expires = Number(parts[1])
    if (!Number.isFinite(issued)) return false
  } else {
    return false
  }
  if (!Number.isFinite(expires)) return false

  const now = Date.now()
  if (now > expires) return false
  if (issued !== null && now > issued + ABSOLUTE_TTL_MS) return false
  return true
}

/**
 * Netlify exposes env through the Netlify global on edge; Deno is the fallback.
 *
 * Each source is tried in turn and only a non-empty value ends the search. The
 * earlier version returned the first source's result even when it was
 * undefined, which made the Deno fallback unreachable -- and since this
 * function failing closes the whole admin area, a dead fallback meant a 503
 * with no second chance.
 */
function getSecret(): string | undefined {
  let value: string | undefined

  // @ts-ignore -- Netlify global is injected by the edge runtime.
  if (typeof Netlify !== 'undefined' && Netlify?.env?.get) value = Netlify.env.get('SESSION_SECRET')
  // @ts-ignore -- Deno global exists in the underlying runtime.
  if (!value && typeof Deno !== 'undefined' && Deno?.env?.get) value = Deno.env.get('SESSION_SECRET')

  return value || undefined
}

function redirectToLogin(request: Request): Response {
  // Built by hand rather than Response.redirect() so the redirect carries
  // no-store -- a cached 302 would keep bouncing an admin who just logged in.
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL('/admin/login.html', request.url).toString(),
      'Cache-Control': 'no-store, must-revalidate',
    },
  })
}

export default async (request: Request, context: Context) => {
  const secret = getSecret()

  // Fail closed. A missing secret means we cannot verify anyone, and serving
  // the admin UI unverified is exactly the hole this function exists to close.
  if (!secret) {
    return new Response('Admin area unavailable: server is not configured.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    })
  }

  if (!(await hasValidSession(request, secret))) return redirectToLogin(request)

  const response = await context.next()
  // Never let a CDN or browser cache an authenticated admin page.
  response.headers.set('Cache-Control', 'no-store, must-revalidate')
  return response
}

export const config: Config = {
  // '/admin/*' does not match the bare '/admin', so both are listed.
  // login.html must stay reachable or the redirect loops forever.
  path: ['/admin', '/admin/*'],
  excludedPath: '/admin/login.html',
}
