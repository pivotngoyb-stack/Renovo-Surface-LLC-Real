import { verifyPassword, createSessionCookie, clearSessionCookie } from './_shared/auth.mts'
import { json, badRequest } from './_shared/http.mts'

export default async (request: Request) => {
  if (request.method === 'POST') {
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
}

export const config = {
  path: '/api/admin/login',
}
