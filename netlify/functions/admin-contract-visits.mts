import { eq, and, desc, inArray } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { generateToken } from './_shared/tokens.mts'
import { frequencyOf, FREQUENCIES } from './_shared/serviceSchedule.mts'
import { visitDates, visitsInMonths, parseIsoDate, isoDate, MAX_VISITS_PER_RUN } from './_shared/visitSchedule.mts'

/**
 * The visits owed under a standing contract, and the button that creates them.
 *
 * A recurring contract used to produce exactly one work order, because
 * createWorkOrderForEstimate refused to make a second. So a weekly janitorial
 * account had one work order covering a year, one completedAt, and one set of
 * actual hours -- the profitability report grading fifty-two visits from a
 * single data point, and the schedule unable to say who was going where.
 *
 * A visit work order is internal dispatch, not a signature request. The client
 * signed the contract; asking them to sign again every Wednesday would be
 * absurd, and it is not how any operator of size works. So these are created
 * silently, with no email and nothing for the client to do.
 */
export default withErrorHandling('admin-contract-visits', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const contractId = Number(context.params.id)
  if (!Number.isInteger(contractId)) return badRequest('Invalid contract id')

  const [contract] = await db
    .select()
    .from(schema.recurringContracts)
    .where(eq(schema.recurringContracts.id, contractId))
    .limit(1)
  if (!contract) return notFound()

  if (request.method === 'GET') {
    const visits = await db
      .select()
      .from(schema.workOrders)
      .where(eq(schema.workOrders.recurringContractId, contractId))
      .orderBy(desc(schema.workOrders.scheduledDate))

    return json({
      visits,
      frequency: frequencyOf(contract.visitFrequency),
      contract,
    })
  }

  if (request.method === 'DELETE') {
    /*
     * Taking visits back off the calendar.
     *
     * Generation can put ninety rows on the schedule in one click, and until
     * now there was no way to take any of them off again -- a client skipping
     * a week, or a contract changing, left work orders nobody could remove.
     *
     * Two things are never deleted. A visit with hours against it is the
     * record that a crew was there, and a visit that has been invoiced is
     * behind a number the client has been billed. Both are evidence, and this
     * endpoint is for tidying a schedule, not for erasing history.
     */
    const params = new URL(request.url).searchParams
    const visitId = params.get('visitId')

    const candidates = await db
      .select()
      .from(schema.workOrders)
      .where(and(
        eq(schema.workOrders.recurringContractId, contractId),
        eq(schema.workOrders.kind, 'visit'),
      ))

    let targets = candidates
    if (visitId) {
      const id = Number(visitId)
      if (!Number.isInteger(id)) return badRequest('Invalid visit id')
      targets = candidates.filter(v => v.id === id)
      /*
       * Deliberately a 400 with a specific message rather than a 404.
       *
       * A 404 from a function here does not reach the caller: it falls through
       * to the next matching route, and this one surfaces as the parent
       * contract handler's "Invalid contract id" -- an error about the wrong
       * thing entirely. Asking to remove a visit that is not on this contract
       * is a mismatched pair anyway, which is a bad request more than a
       * missing one.
       */
      if (!targets.length) {
        return badRequest('That work order is not a scheduled visit on this contract. Only visits generated from the contract can be removed here.')
      }
    } else {
      // No id: clear the rest of the run, from today forward. Past visits stay
      // whether or not anyone logged them -- a gap in the record is itself
      // worth seeing.
      const today = isoDate(new Date())
      targets = candidates.filter(v => v.scheduledDate && v.scheduledDate >= today)
    }

    const invoiced = await db
      .select({ workOrderId: schema.invoices.workOrderId })
      .from(schema.invoices)
      .where(inArray(schema.invoices.workOrderId, targets.length ? targets.map(t => t.id) : [-1]))
    const invoicedIds = new Set(invoiced.map(i => i.workOrderId))

    const removable = targets.filter(v => v.actualHours == null && v.status !== 'completed' && !invoicedIds.has(v.id))
    const kept = targets.length - removable.length

    if (visitId && !removable.length) {
      return badRequest(
        invoicedIds.has(Number(visitId))
          ? 'This visit has been invoiced. Leave it in place.'
          : 'This visit has hours logged against it, so it is a record that the crew was there. Clear the hours first if it really did not happen.',
      )
    }

    for (const v of removable) {
      await db.delete(schema.workOrderPhotos).where(eq(schema.workOrderPhotos.workOrderId, v.id))
      await db.delete(schema.workOrders).where(eq(schema.workOrders.id, v.id))
    }

    return json({ removed: removable.length, kept })
  }

  if (request.method === 'PATCH') {
    /*
     * How often the crew is on site, which is not the same as when the client
     * is billed. A weekly contract billed monthly has four visits behind one
     * invoice, and until this was stored a contract could not say what work it
     * actually owed.
     */
    let body: { visitFrequency?: unknown } = {}
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid request body')
    }
    const key = String(body.visitFrequency || '')
    if (!FREQUENCIES.some(f => f.key === key)) return badRequest('Unknown service frequency')

    const [updated] = await db
      .update(schema.recurringContracts)
      .set({ visitFrequency: key })
      .where(eq(schema.recurringContracts.id, contractId))
      .returning()
    return json({ contract: updated, frequency: frequencyOf(key) })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const freq = frequencyOf(contract.visitFrequency)
  if (!freq.recurring) {
    return badRequest('This contract has no service frequency set, so there are no visits to generate.')
  }
  if (contract.status !== 'active') {
    return badRequest('This contract is ' + contract.status + '. Reactivate it before scheduling visits.')
  }

  /*
   * The contract needs an estimate behind it: the work order's scope, terms
   * and line items all come from there, and a visit with no scope is a row
   * telling a crew to go somewhere and do nothing in particular.
   */
  if (!contract.estimateId) {
    return badRequest('This contract was typed in by hand, so there is no scope to put on a work order. Create it from an approved estimate to schedule visits.')
  }
  const [estimate] = await db
    .select()
    .from(schema.estimates)
    .where(eq(schema.estimates.id, contract.estimateId))
    .limit(1)
  if (!estimate) return badRequest('The estimate behind this contract is missing')

  let body: { months?: unknown; from?: unknown } = {}
  try {
    body = await request.json()
  } catch { /* defaults below */ }

  const months = Number(body.months)
  const period = Number.isFinite(months) && months >= 1 && months <= 12 ? Math.round(months) : 3

  /*
   * Start after the last visit already scheduled, not from today, or a second
   * run duplicates every date in the overlap.
   */
  const existing = await db
    .select()
    .from(schema.workOrders)
    .where(eq(schema.workOrders.recurringContractId, contractId))
    .orderBy(desc(schema.workOrders.scheduledDate))

  const lastDate = existing.find(v => v.scheduledDate)?.scheduledDate
  const requestedFrom = typeof body.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from)
    ? parseIsoDate(body.from)
    : null

  const today = parseIsoDate(isoDate(new Date()))
  let from = requestedFrom || today
  if (lastDate) {
    const dayAfterLast = parseIsoDate(lastDate)
    dayAfterLast.setUTCDate(dayAfterLast.getUTCDate() + 1)
    if (dayAfterLast > from) from = dayAfterLast
  }

  const highestSequence = existing.reduce((max, v) => Math.max(max, v.visitSequence || 0), 0)
  const wanted = Math.min(visitsInMonths(contract.visitFrequency, period), MAX_VISITS_PER_RUN)
  const plan = visitDates(contract.visitFrequency, from, wanted, highestSequence + 1)

  if (!plan.length) {
    return badRequest('Nothing to generate for that period.')
  }

  const lineItems = await db
    .select()
    .from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, estimate.id))
    .orderBy(schema.estimateLineItems.sortOrder)

  const recurringLines = lineItems.filter(li => !li.isOptional && frequencyOf(li.frequency).recurring)
  const scopeLines = (recurringLines.length ? recurringLines : lineItems.filter(li => !li.isOptional))
    .map(li => `  - ${li.description}`)
    .join('\n')

  const created = []
  for (const visit of plan) {
    const termsText = `SERVICE VISIT

Contract: ${contract.description}
Visit ${visit.sequence}, scheduled ${visit.date}
Site: ${estimate.siteAddress || 'See contract'}

Scope of this visit:
${scopeLines}

This visit is performed under the signed service agreement for this contract.
It is not a separate authorization and requires no signature.`

    const [row] = await db
      .insert(schema.workOrders)
      .values({
        estimateId: estimate.id,
        recurringContractId: contractId,
        visitSequence: visit.sequence,
        kind: 'visit',
        token: generateToken(),
        termsText,
        status: 'pending',
        scheduledDate: visit.date,
      })
      .returning()
    created.push(row)
  }

  return json({ created: created.length, visits: created, from: isoDate(from) }, { status: 201 })
})

export const config = {
  path: '/api/admin/contracts/:id/visits',
}
