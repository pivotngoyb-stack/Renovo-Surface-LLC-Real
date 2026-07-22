import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid estimate id')

  let body: { archived?: boolean }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  if (typeof body.archived !== 'boolean') return badRequest('archived must be true or false')

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).limit(1)
  if (!estimate) return notFound()

  await db.update(schema.estimates).set({ archived: body.archived }).where(eq(schema.estimates.id, id))

  return json({ ok: true })
}

export const config = {
  path: '/api/admin/estimates/:id/archive',
}
