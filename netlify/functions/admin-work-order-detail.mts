import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

interface SchedulePatch {
  scheduledDate?: string | null
  scheduledStart?: string | null
  completed?: boolean
}

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid work order id')

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1)
  if (!workOrder) return notFound()

  /** Book, reschedule, unschedule, or mark a job finished. */
  if (request.method === 'PATCH') {
    let body: SchedulePatch
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const updates: Record<string, unknown> = {}

    if ('scheduledDate' in body) {
      const d = body.scheduledDate
      // Empty string and null both mean "unschedule this job".
      if (d === null || d === '') updates.scheduledDate = null
      else if (typeof d === 'string' && DATE_RE.test(d)) updates.scheduledDate = d
      else return badRequest('scheduledDate must be YYYY-MM-DD, or empty to unschedule')
    }

    if ('scheduledStart' in body) {
      const t = body.scheduledStart
      if (t === null || t === '') updates.scheduledStart = null
      else if (typeof t === 'string' && TIME_RE.test(t)) updates.scheduledStart = t
      else return badRequest('scheduledStart must be 24-hour HH:MM, or empty for no set time')
    }

    if ('completed' in body) {
      updates.completedAt = body.completed ? new Date() : null
    }

    if (!Object.keys(updates).length) return badRequest('Nothing to update')

    // A start time without a date would never surface on the calendar, which
    // reads by date -- so drop it rather than store a booking nobody can see.
    const nextDate = 'scheduledDate' in updates ? updates.scheduledDate : workOrder.scheduledDate
    if (!nextDate) updates.scheduledStart = null

    const [updated] = await db.update(schema.workOrders).set(updates).where(eq(schema.workOrders.id, id)).returning()
    return json({ workOrder: updated })
  }

  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, workOrder.estimateId)).limit(1)
  const client = estimate ? (await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1))[0] : undefined
  const lineItems = estimate
    ? await db.select().from(schema.estimateLineItems).where(eq(schema.estimateLineItems.estimateId, estimate.id)).orderBy(schema.estimateLineItems.sortOrder)
    : []
  const [signature] = await db.select().from(schema.signatures).where(eq(schema.signatures.workOrderId, id)).limit(1)
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.workOrderId, id)).limit(1)

  return json({ workOrder, estimate, client, lineItems, signature: signature || null, invoice: invoice || null })
}

export const config = {
  path: '/api/admin/work-orders/:id',
}
