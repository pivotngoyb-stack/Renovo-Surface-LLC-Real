import { eq, and } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, badRequest, getClientIp } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { buildJobPlan } from './_shared/jobModel.mts'
import { crewPlan, crewScope, crewChangeScope } from './_shared/crewView.mts'
import { changeOrderRef } from './_shared/changeOrders.mts'
import { parseActuals, visitStatusFor } from './_shared/actuals.mts'

/**
 * The crew's own link to a job, and where they log what it took.
 *
 * The one real measurement in this system is actual crew hours: without it the
 * profitability report grades its own homework, a production rate that is wrong
 * stays wrong, and the dashboard's list of unlogged visits just grows. Until
 * now only a signed-in admin could enter them, which meant the owner typing in
 * numbers for work he was not on site for, from memory, later. That is not a
 * measurement.
 *
 * No login, by design. This opens on a phone in a car park with cold hands, and
 * a password there is a guarantee the hours never get entered. It is a bearer
 * link, like the client's -- which is exactly why it is a *different* token
 * from the client's, and why the money is stripped out of the plan before it
 * goes anywhere near here.
 */
export default withErrorHandling('crew-public', async (request: Request, context: Context) => {
  const token = context.params.token
  if (!token) return notFound()

  const [workOrder] = await db
    .select()
    .from(schema.workOrders)
    .where(eq(schema.workOrders.crewToken, token))
    .limit(1)
  if (!workOrder) return notFound()

  const [estimate] = await db
    .select()
    .from(schema.estimates)
    .where(eq(schema.estimates.id, workOrder.estimateId))
    .limit(1)
  const [client] = estimate
    ? await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)
    : []

  if (request.method === 'GET') {
    const lineItems = await db
      .select()
      .from(schema.estimateLineItems)
      .where(eq(schema.estimateLineItems.estimateId, workOrder.estimateId))
      .orderBy(schema.estimateLineItems.sortOrder)

    const [contract] = workOrder.recurringContractId != null
      ? await db.select().from(schema.recurringContracts)
          .where(eq(schema.recurringContracts.id, workOrder.recurringContractId)).limit(1)
      : []

    /*
     * Scope, assembled from the line descriptions rather than taken from the
     * work order's terms text.
     *
     * The terms text is the document the client signed, and it prints every
     * unit price and the job total -- shipping it here would have handed the
     * whole quote to anyone the link was forwarded to. Rebuilding the scope
     * from the lines costs two more queries and cannot carry a figure at all.
     *
     * Approved change orders only: one still out with the client authorises
     * nothing, and a crew doing work off an unsigned document is the exact
     * dispute change orders exist to prevent. A job can be amended through its
     * own work order, and a visit through the contract above it, so both are
     * gathered.
     */
    const scope = crewScope(lineItems)
    const amendments = await db
      .select({ id: schema.changeOrders.id, sequence: schema.changeOrders.sequence, workOrderId: schema.changeOrders.workOrderId })
      .from(schema.changeOrders)
      .where(and(
        workOrder.recurringContractId != null
          ? eq(schema.changeOrders.recurringContractId, workOrder.recurringContractId)
          : eq(schema.changeOrders.workOrderId, workOrder.id),
        eq(schema.changeOrders.status, 'approved'),
        eq(schema.changeOrders.archived, false),
      ))
      .orderBy(schema.changeOrders.sequence)

    for (const co of amendments) {
      const lines = await db
        .select({ description: schema.changeOrderLineItems.description })
        .from(schema.changeOrderLineItems)
        .where(eq(schema.changeOrderLineItems.changeOrderId, co.id))
        .orderBy(schema.changeOrderLineItems.sortOrder)
      const ref = changeOrderRef({
        workOrderId: co.workOrderId,
        recurringContractId: workOrder.recurringContractId,
        sequence: co.sequence,
      })
      scope.push(...crewChangeScope(ref, lines))
    }

    return json({
      job: {
        id: workOrder.id,
        kind: workOrder.kind,
        visitSequence: workOrder.visitSequence,
        scheduledDate: workOrder.scheduledDate,
        scheduledStart: workOrder.scheduledStart,
        completedAt: workOrder.completedAt,
      },
      // Enough to find the place and to ring someone when the door is locked.
      site: {
        clientName: client?.name || null,
        company: client?.company || null,
        phone: client?.phone || null,
        address: estimate?.siteAddress || client?.propertyAddress || null,
        projectName: estimate?.projectName || null,
        siteConditions: estimate?.siteConditions || null,
      },
      contractDescription: contract?.description || null,
      scope,
      plan: crewPlan(buildJobPlan(lineItems)),
      actuals: {
        actualHours: workOrder.actualHours,
        actualCrewSize: workOrder.actualCrewSize,
        actualMaterialsCost: workOrder.actualMaterialsCost,
        actualHoursNote: workOrder.actualHoursNote,
      },
    })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request body')
  }

  const parsed = parseActuals(body as Record<string, unknown>)
  if (!parsed.ok) return badRequest(parsed.error)
  const { hours, crew, materials, note, clearing } = parsed.value

  /*
   * Where it came from goes on the note.
   *
   * Hours entered on site by the crew and hours typed in afterwards by the
   * office are different qualities of evidence, and the report treats them the
   * same. Recording which is which costs nothing now and is the sort of thing
   * that matters when a figure looks wrong six months later.
   */
  const stamped = clearing
    ? null
    : [note, `Logged on site ${new Date().toISOString().slice(0, 10)} (${getClientIp(request)})`]
        .filter(Boolean).join(' -- ').slice(0, 500)

  await db
    .update(schema.workOrders)
    .set({
      actualHours: hours,
      actualCrewSize: crew,
      actualMaterialsCost: materials,
      actualHoursNote: stamped,
      ...visitStatusFor(workOrder.kind, clearing),
    })
    .where(eq(schema.workOrders.id, workOrder.id))

  return json({ ok: true, actualHours: hours, actualCrewSize: crew, actualMaterialsCost: materials })
})

export const config = {
  path: '/api/crew/:token',
}
