import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

/** A week of crew time on one job. Anything past this is a typo, not a job. */
const MAX_HOURS = 400
const MAX_CREW = 30
const MAX_NOTE = 500

/**
 * What the job actually took.
 *
 * Everything upstream of this is an estimate. Without a real figure to compare
 * against, the profitability report can only grade its own homework: a
 * production rate that is wrong stays wrong, because nothing ever contradicts
 * it. One number entered when the crew comes off site is what turns a quoting
 * model into something that improves.
 */
export default withErrorHandling('admin-work-order-actuals', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid work order id')

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  let body: { actualHours?: unknown; actualCrewSize?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  // An empty submission clears the figures rather than storing zero: "not
  // recorded" and "took no time" are different facts and the report reads them
  // differently.
  const clearing = body.actualHours === null || body.actualHours === ''

  let hours: string | null = null
  let crew: number | null = null

  if (!clearing) {
    const h = Number(body.actualHours)
    if (!Number.isFinite(h) || h <= 0) return badRequest('Enter the total crew hours the job took')
    if (h > MAX_HOURS) return badRequest(`That is more than ${MAX_HOURS} crew hours -- please check the figure`)
    hours = String(Math.round(h * 100) / 100)

    if (body.actualCrewSize != null && body.actualCrewSize !== '') {
      const c = Number(body.actualCrewSize)
      if (!Number.isInteger(c) || c < 1 || c > MAX_CREW) return badRequest('Crew size must be a whole number between 1 and ' + MAX_CREW)
      crew = c
    }
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : null

  await db
    .update(schema.workOrders)
    .set({ actualHours: hours, actualCrewSize: crew, actualHoursNote: note || null })
    .where(eq(schema.workOrders.id, id))

  return json({ ok: true, actualHours: hours, actualCrewSize: crew, actualHoursNote: note || null })
})

export const config = {
  path: '/api/admin/work-orders/:id/actuals',
}
