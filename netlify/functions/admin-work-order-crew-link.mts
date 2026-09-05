import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { generateToken } from './_shared/tokens.mts'

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'

/**
 * The crew's link to a job, issued on first ask.
 *
 * A separate token from the client's, so a client who noticed the URL and
 * changed the page name still cannot reach the job plan. Minted lazily rather
 * than on work-order creation: most work orders never need one, and a token
 * that exists is a token that can leak.
 *
 * POST rather than GET because the first call creates something. Calling it
 * again returns the same link -- re-rolling the token on every view would
 * break the one already sent to a phone.
 */
export default withErrorHandling('admin-work-order-crew-link', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  let crewToken = workOrder.crewToken
  if (!crewToken) {
    crewToken = generateToken()
    await db.update(schema.workOrders).set({ crewToken }).where(eq(schema.workOrders.id, id))
  }

  return json({ crewToken, url: `${SITE_URL}/crew.html?t=${crewToken}` })
})

export const config = {
  path: '/api/admin/work-orders/:id/crew-link',
}
