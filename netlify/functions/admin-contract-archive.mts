import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  let body: { archived?: boolean }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  if (typeof body.archived !== 'boolean') return badRequest('archived must be true or false')

  const [contract] = await db.select().from(schema.recurringContracts).where(eq(schema.recurringContracts.id, id)).limit(1)
  if (!contract) return notFound()

  await db.update(schema.recurringContracts).set({ archived: body.archived }).where(eq(schema.recurringContracts.id, id))

  return json({ ok: true })
}

export const config = {
  path: '/api/admin/contracts/:id/archive',
}
