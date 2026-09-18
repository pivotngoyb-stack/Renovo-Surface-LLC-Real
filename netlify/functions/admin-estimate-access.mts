import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { parseSiteAccess, ENTRY_METHODS } from './_shared/siteAccess.mts'

/**
 * How the crew gets into the place an estimate is for.
 *
 * Office-only. The crew link reads the same row through crewAccess(), which
 * drops the codes once the job is logged; nothing a client can open reads it
 * at all.
 */
export default withErrorHandling('admin-estimate-access', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [estimate] = await db
    .select({ id: schema.estimates.id })
    .from(schema.estimates)
    .where(eq(schema.estimates.id, id))
    .limit(1)
  if (!estimate) return notFound()

  if (request.method === 'GET') {
    const [row] = await db.select().from(schema.siteAccess).where(eq(schema.siteAccess.estimateId, id)).limit(1)
    return json({ access: row || null, entryMethods: ENTRY_METHODS })
  }

  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const parsed = parseSiteAccess(body)
  if (!parsed.ok) return badRequest(parsed.error)

  const values = { ...parsed.value, updatedAt: new Date() }

  /*
   * The ORM puts every bound parameter into the text of a failed query's
   * error, and the error handler logs that text and emails it. Here the
   * parameters are door and alarm codes. So a failure is re-thrown as a plain
   * error that says what went wrong without repeating what was being written.
   */
  let row
  try {
    ;[row] = await db
      .insert(schema.siteAccess)
      .values({ estimateId: id, ...values })
      .onConflictDoUpdate({ target: schema.siteAccess.estimateId, set: values })
      .returning()
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code
    throw new Error(`Saving site access for estimate ${id} failed${code ? ` (database code ${code})` : ''}`)
  }

  return json({ ok: true, access: row })
})

export const config = {
  path: '/api/admin/estimates/:id/access',
}
