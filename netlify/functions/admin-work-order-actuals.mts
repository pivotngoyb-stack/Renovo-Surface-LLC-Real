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
/** A single visit spending more than this on chemicals is a typo. */
const MAX_MATERIALS = 50000

/**
 * What the job actually took.
 *
 * Everything upstream of this is an estimate. Without real figures to compare
 * against, the profitability report can only grade its own homework: a
 * production rate that is wrong stays wrong, and a chemical model that is wrong
 * stays wrong, because nothing ever contradicts them. Two numbers entered when
 * the crew comes off site are what turn a quoting model into something that
 * improves.
 */
export default withErrorHandling('admin-work-order-actuals', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid work order id')

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  let body: {
    actualHours?: unknown
    actualCrewSize?: unknown
    actualMaterialsCost?: unknown
    note?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  // An empty submission clears the figures rather than storing zero: "not
  // recorded" and "took no time" are different facts and the report reads them
  // differently. Hours are the anchor -- clearing them clears the rest, since
  // materials without hours describes a job nobody worked.
  const clearing = body.actualHours === null || body.actualHours === ''

  let hours: string | null = null
  let crew: number | null = null
  let materials: string | null = null

  if (!clearing) {
    const h = Number(body.actualHours)
    if (!Number.isFinite(h) || h <= 0) return badRequest('Enter the total crew hours the job took')
    if (h > MAX_HOURS) return badRequest(`That is more than ${MAX_HOURS} crew hours -- please check the figure`)
    hours = String(Math.round(h * 100) / 100)

    if (body.actualCrewSize != null && body.actualCrewSize !== '') {
      const c = Number(body.actualCrewSize)
      if (!Number.isInteger(c) || c < 1 || c > MAX_CREW) {
        return badRequest(`Crew size must be a whole number between 1 and ${MAX_CREW}`)
      }
      crew = c
    }

    if (body.actualMaterialsCost != null && body.actualMaterialsCost !== '') {
      const m = Number(body.actualMaterialsCost)
      // Zero is meaningful here in a way it is not for hours: plenty of visits
      // genuinely consume nothing, and recording that is a real measurement.
      if (!Number.isFinite(m) || m < 0) return badRequest('Materials cost cannot be negative')
      if (m > MAX_MATERIALS) {
        return badRequest(`That is more than ${MAX_MATERIALS.toLocaleString()} dollars in materials -- please check the figure`)
      }
      materials = String(Math.round(m * 100) / 100)
    }
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : null

  /*
   * Logging hours on a visit is what marks it done.
   *
   * A visit has nothing to sign, so 'signed' can never arrive and the status
   * would sit at 'pending' forever -- every past visit reading as work nobody
   * did. Hours against it are the only evidence the crew was there, so that is
   * the signal. Clearing the hours takes it back to pending, because the
   * evidence has been withdrawn.
   *
   * An authorization keeps its own status. That one really is about a
   * signature, and hours must not stand in for the client's agreement.
   */
  const visitStatus = workOrder.kind === 'visit'
    ? { status: clearing ? ('pending' as const) : ('completed' as const), completedAt: clearing ? null : new Date() }
    : {}

  await db
    .update(schema.workOrders)
    .set({
      actualHours: hours,
      actualCrewSize: crew,
      actualMaterialsCost: materials,
      actualHoursNote: note || null,
      ...visitStatus,
    })
    .where(eq(schema.workOrders.id, id))

  return json({
    ok: true,
    actualHours: hours,
    actualCrewSize: crew,
    actualMaterialsCost: materials,
    actualHoursNote: note || null,
    ...visitStatus,
  })
})

export const config = {
  path: '/api/admin/work-orders/:id/actuals',
}
