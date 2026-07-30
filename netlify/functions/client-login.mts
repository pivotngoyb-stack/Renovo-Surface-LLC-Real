import { sql } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { createLoginLinkToken, clearClientSessionCookie } from './_shared/client-auth.mts'
import { sendClientLoginLink } from './_shared/email.mts'
import { json, badRequest } from './_shared/http.mts'

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'
const GENERIC_MESSAGE = 'If that email is on file, we\'ve sent a login link. Check your inbox.'

export default async (request: Request) => {
  if (request.method === 'POST') {
    let body: { email?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    if (!body.email?.trim()) return badRequest('Email is required')

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
}

export const config = {
  path: '/api/client/login',
}
