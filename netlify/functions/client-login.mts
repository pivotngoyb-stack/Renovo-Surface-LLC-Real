import { sql } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { createLoginLinkToken, clearClientSessionCookie } from './_shared/client-auth.mts'
import { sendClientLoginLink } from './_shared/email.mts'
import { json, badRequest, getClientIp } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { checkRateLimit } from './_shared/rateLimit.mts'

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'
const GENERIC_MESSAGE = 'If that email is on file, we\'ve sent a login link. Check your inbox.'

export default withErrorHandling('client-login', async (request: Request) => {
  if (request.method === 'POST') {
    let body: { email?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    if (!body.email?.trim()) return badRequest('Email is required')

    // Rate-limit by IP (blocks a scripted sweep across many emails) and by the
    // specific email (stops one inbox getting spammed with links from different
    // IPs). Neither check depends on whether the email actually matches a
    // client, so it can't be used to enumerate which emails are clients.
    const ipAllowed = await checkRateLimit(`client-login-ip:${getClientIp(request)}`, 10, 15)
    const emailAllowed = await checkRateLimit(`client-login-email:${body.email.trim().toLowerCase()}`, 3, 15)
    if (!ipAllowed || !emailAllowed) {
      return json({ error: 'Too many requests. Please try again in a few minutes.' }, { status: 429 })
    }

    // Always return the same generic response whether or not a match exists,
    // so this endpoint can't be used to enumerate which emails are clients.
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(sql`lower(${schema.clients.email}) = lower(${body.email.trim()})`)
      .limit(1)

    if (client) {
      const token = createLoginLinkToken(client.id)
      const url = `${SITE_URL}/client/verify.html?token=${token}`
      await sendClientLoginLink(client.email, client.name, url)
    }

    return json({ ok: true, message: GENERIC_MESSAGE })
  }

  if (request.method === 'DELETE') {
    return json({ ok: true }, { headers: { 'Set-Cookie': clearClientSessionCookie() } })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/client/login',
}
