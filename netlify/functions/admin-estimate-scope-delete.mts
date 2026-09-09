import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

/**
 * Taking a bid-specific statement back off.
 *
 * Removing a suppression restores the library line it was hiding, which is the
 * point: the standard exclusions are the default, and every departure from
 * them is a row somebody deliberately added and can deliberately undo.
 */
export default withErrorHandling('admin-estimate-scope-delete', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, { status: 405 })

  const estimateId = pathId(context.params.id)
  const lineId = pathId(context.params.lineId)
  if (estimateId === null || lineId === null) return notFound()

  const [line] = await db
    .select()
    .from(schema.estimateScopeLines)
    .where(eq(schema.estimateScopeLines.id, lineId))
    .limit(1)
  if (!line || line.estimateId !== estimateId) return notFound()

  await db.delete(schema.estimateScopeLines).where(eq(schema.estimateScopeLines.id, lineId))
  return json({ ok: true })
})

export const config = {
  path: '/api/admin/estimates/:id/scope/:lineId',
}
