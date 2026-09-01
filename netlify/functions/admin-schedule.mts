import { eq, and, gte, lte, isNotNull, asc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, badRequest } from './_shared/http.mts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Booked jobs in a date range, for the admin schedule view.
 *
 * Returns one row per scheduled work order with everything the calendar needs
 * to render a cell without a second round trip: who it is for, what the job is,
 * and whether it has been signed and finished.
 */
export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return badRequest('from and to are required, as YYYY-MM-DD')
  }
  if (from > to) return badRequest('from must not be after to')

  const rows = await db
    .select({
      id: schema.workOrders.id,
      status: schema.workOrders.status,
      scheduledDate: schema.workOrders.scheduledDate,
      scheduledStart: schema.workOrders.scheduledStart,
      completedAt: schema.workOrders.completedAt,
      // A crew looking at Thursday needs to know whether this is a one-off job
      // the client signed for or one visit of a standing contract. They are
      // dispatched differently and the paperwork is different.
      kind: schema.workOrders.kind,
      visitSequence: schema.workOrders.visitSequence,
      recurringContractId: schema.workOrders.recurringContractId,
      clientName: schema.clients.name,
      clientPhone: schema.clients.phone,
      propertyAddress: schema.clients.propertyAddress,
      estimateId: schema.estimates.id,
    })
    .from(schema.workOrders)
    .innerJoin(schema.estimates, eq(schema.workOrders.estimateId, schema.estimates.id))
    .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
    .where(
      and(
        isNotNull(schema.workOrders.scheduledDate),
        gte(schema.workOrders.scheduledDate, from),
        lte(schema.workOrders.scheduledDate, to),
      ),
    )
    .orderBy(asc(schema.workOrders.scheduledDate), asc(schema.workOrders.scheduledStart))

  // One line-item description per job, so a calendar cell can say what the work
  // actually is instead of just "Work Order #12".
  const jobs = []
  for (const r of rows) {
    const items = await db
      .select({ description: schema.estimateLineItems.description, serviceType: schema.estimateLineItems.serviceType })
      .from(schema.estimateLineItems)
      .where(eq(schema.estimateLineItems.estimateId, r.estimateId))
      .orderBy(schema.estimateLineItems.sortOrder)
    jobs.push({
      ...r,
      services: [...new Set(items.map(i => i.serviceType).filter(Boolean))],
      summary: items[0]?.description || 'Scheduled work',
      itemCount: items.length,
    })
  }

  return json({ jobs })
}

export const config = {
  path: '/api/admin/schedule',
}
