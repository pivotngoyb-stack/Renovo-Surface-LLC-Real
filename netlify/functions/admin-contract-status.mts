import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

const VALID_STATUSES = ['active', 'paused', 'cancelled']

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid contract id')

  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return badRequest(`Status must be one of: ${VALID_STATUSES.join(', ')}`)
  }

  const [contract] = await db.select().from(schema.recurringContracts).where(eq(schema.recurringContracts.id, id)).limit(1)
  if (!contract) return notFound()

  await db.update(schema.recurringContracts).set({ status: body.status as 'active' | 'paused' | 'cancelled' }).where(eq(schema.recurringContracts.id, id))

  return json({ ok: true })
}

export const config = {
  path: '/api/admin/contracts/:id/status',
}
