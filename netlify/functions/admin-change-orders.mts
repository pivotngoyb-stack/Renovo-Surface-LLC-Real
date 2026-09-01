import { eq, desc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { generateToken } from './_shared/tokens.mts'
import { changeOrderTotal, nextSequence, changeOrderNumber } from './_shared/changeOrders.mts'

interface IncomingLine {
  description?: unknown
  quantity?: unknown
  unitPrice?: unknown
}

/**
 * Change orders belonging to one work order: list them, or draft a new one.
 *
 * Created as a draft, never sent on creation. Renovo is usually writing this
 * standing on a job site with the client waiting, and a document that emails
 * itself the moment the last line is typed is one that goes out with the
 * wrong number in it.
 */
export default withErrorHandling('admin-change-orders', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const workOrderId = pathId(context.params.id)
  if (workOrderId === null) return notFound()

  const [workOrder] = await db
    .select()
    .from(schema.workOrders)
    .where(eq(schema.workOrders.id, workOrderId))
    .limit(1)
  if (!workOrder) return notFound()

  if (request.method === 'GET') {
    const changeOrders = await db
      .select()
      .from(schema.changeOrders)
      .where(eq(schema.changeOrders.workOrderId, workOrderId))
      .orderBy(desc(schema.changeOrders.sequence))

    const withTotals = await Promise.all(
      changeOrders.map(async (co) => {
        const lines = await db
          .select()
          .from(schema.changeOrderLineItems)
          .where(eq(schema.changeOrderLineItems.changeOrderId, co.id))
          .orderBy(schema.changeOrderLineItems.sortOrder)
        return { ...co, lineItems: lines, total: changeOrderTotal(lines), number: changeOrderNumber(workOrderId, co.sequence) }
      }),
    )
    return json({ changeOrders: withTotals })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: {
    description?: unknown
    reason?: unknown
    poNumber?: unknown
    scheduleImpactDays?: unknown
    lineItems?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request body')
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return badRequest('Describe what changed')

  const rawLines = Array.isArray(body.lineItems) ? (body.lineItems as IncomingLine[]) : []
  const lines = rawLines
    .map((l) => ({
      description: typeof l.description === 'string' ? l.description.trim() : '',
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
    }))
    .filter(l => l.description && Number.isFinite(l.quantity) && Number.isFinite(l.unitPrice))

  if (!lines.length) return badRequest('Add at least one line describing the change')

  /*
   * A zero-value change order is refused. If nothing about the money is
   * changing there is nothing to authorise, and sending one anyway trains the
   * client to sign these without reading them -- which is the whole value of
   * the document gone.
   */
  const total = changeOrderTotal(lines)
  if (total === 0) return badRequest('This change order comes to $0. Adjust the lines, or note the change on the work order instead.')

  const existing = await db
    .select({ sequence: schema.changeOrders.sequence })
    .from(schema.changeOrders)
    .where(eq(schema.changeOrders.workOrderId, workOrderId))

  const days = Number(body.scheduleImpactDays)

  const [created] = await db
    .insert(schema.changeOrders)
    .values({
      workOrderId,
      sequence: nextSequence(existing),
      token: generateToken(),
      status: 'draft',
      description: description.slice(0, 2000),
      reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 200) : null,
      poNumber: typeof body.poNumber === 'string' && body.poNumber.trim() ? body.poNumber.trim().slice(0, 60) : null,
      scheduleImpactDays: Number.isInteger(days) && days >= 0 && days <= 365 ? days : 0,
    })
    .returning()

  await db.insert(schema.changeOrderLineItems).values(
    lines.map((l, i) => ({
      changeOrderId: created.id,
      description: l.description.slice(0, 500),
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      sortOrder: i,
    })),
  )

  return json(
    { changeOrder: { ...created, number: changeOrderNumber(workOrderId, created.sequence), total } },
    { status: 201 },
  )
})

export const config = {
  path: '/api/admin/work-orders/:id/change-orders',
}
