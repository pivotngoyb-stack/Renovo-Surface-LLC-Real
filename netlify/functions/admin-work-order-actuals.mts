import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { parseActuals, visitStatusFor } from './_shared/actuals.mts'

/**
 * What the job actually took.
 *
 * Everything upstream of this is an estimate. Without real figures to compare
 * against, the profitability report can only grade its own homework: a
 * production rate that is wrong stays wrong, and a chemical model that is wrong
 * stays wrong, because nothing ever contradicts them. Two numbers entered when
 * the crew comes off site are what turn a quoting model into something that
 * improves.
 *
 * The crew can now enter these themselves from their own link. The rules live
 * in _shared/actuals.mts so both routes accept exactly the same figures.
 */
export default withErrorHandling('admin-work-order-actuals', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const parsed = parseActuals(body as Record<string, unknown>)
  if (!parsed.ok) return badRequest(parsed.error)
  const { hours, crew, materials, note, clearing } = parsed.value

  const visitStatus = visitStatusFor(workOrder.kind, clearing)

  await db
    .update(schema.workOrders)
    .set({
      actualHours: hours,
      actualCrewSize: crew,
      actualMaterialsCost: materials,
      actualHoursNote: note,
      ...visitStatus,
    })
    .where(eq(schema.workOrders.id, id))

  return json({
    ok: true,
    actualHours: hours,
    actualCrewSize: crew,
    actualMaterialsCost: materials,
    actualHoursNote: note,
    ...visitStatus,
  })
})

export const config = {
  path: '/api/admin/work-orders/:id/actuals',
}
