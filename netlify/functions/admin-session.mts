import { isAuthenticated, refreshedSessionCookie } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'

/**
 * Keeps an active admin signed in.
 *
 * The session cookie now expires on inactivity rather than at a fixed hour, so
 * something has to mark activity. Every admin page already routes its API
 * calls through adminFetch(), which pings this endpoint at most once a minute
 * while you are working. Stop working and nothing pings, so the session lapses
 * on its own -- which is the point.
 */
export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  // Null when the session was refreshed moments ago or has hit the absolute
  // ceiling. Either way the caller is still authenticated right now.
  const cookie = refreshedSessionCookie(request)
  return json({ ok: true }, cookie ? { headers: { 'Set-Cookie': cookie } } : {})
}

export const config = {
  path: '/api/admin/session',
}
