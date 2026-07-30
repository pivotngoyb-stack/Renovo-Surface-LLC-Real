import { eq } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { verifyLoginLinkToken, createClientSessionCookie } from './_shared/client-auth.mts'
import { json, badRequest } from './_shared/http.mts'

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: { token?: string }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  if (!body.token) return badRequest('Missing token')

  const verified = verifyLoginLinkToken(body.token)
  if (!verified) return badRequest('This login link is invalid or has expired. Please request a new one.')

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, verified.clientId)).limit(1)
  if (!client) return badRequest('This login link is invalid or has expired. Please request a new one.')

  return json(
    { ok: true, clientName: client.name },
    { headers: { 'Set-Cookie': createClientSessionCookie(client.id) } },
  )
}

export const config = {
  path: '/api/client/verify',
}
