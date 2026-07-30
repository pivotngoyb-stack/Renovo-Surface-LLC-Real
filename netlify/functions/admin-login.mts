import { verifyPassword, createSessionCookie, clearSessionCookie } from './_shared/auth.mts'
import { json, badRequest, getClientIp } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { checkRateLimit } from './_shared/rateLimit.mts'

const MAX_ATTEMPTS = 8
const WINDOW_MINUTES = 15

export default withErrorHandling('admin-login', async (request: Request) => {
  if (request.method === 'POST') {
    const allowed = await checkRateLimit(`admin-login:${getClientIp(request)}`, MAX_ATTEMPTS, WINDOW_MINUTES)
    if (!allowed) {
      return json({ error: 'Too many login attempts. Please try again in a few minutes.' }, { status: 429 })
    }

    let body: { password?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid request body')
    }
    if (!body.password || typeof body.password !== 'string') {
      return badRequest('Password is required')
    }

    let valid: boolean
    try {
      valid = verifyPassword(body.password)
    } catch (err) {
      console.error(err)
      return json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    if (!valid) {
      return json({ error: 'Incorrect password' }, { status: 401 })
    }

    return json(
      { ok: true },
      { headers: { 'Set-Cookie': createSessionCookie() } },
    )
  }

  if (request.method === 'DELETE') {
    return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/admin/login',
}
