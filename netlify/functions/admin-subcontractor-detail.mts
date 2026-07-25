import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid agreement id')

  const [agreement] = await db.select().from(schema.subcontractorAgreements).where(eq(schema.subcontractorAgreements.id, id)).limit(1)
  if (!agreement) return notFound()

  return json({ agreement })
}

export const config = {
  path: '/api/admin/subcontractors/:id',
}
