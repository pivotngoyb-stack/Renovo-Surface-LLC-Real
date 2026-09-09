import { eq, asc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { bidReadiness, suggestedSubmittals, STANDARD_SUBMITTALS } from './_shared/bidReadiness.mts'

const MAX_LABEL = 160
const MAX_TEXT = 600
const MAX_NUMBER = 20

/**
 * The envelope, as opposed to the price.
 *
 * Addenda that have to be acknowledged and documents that have to be enclosed.
 * The cheapest number does not win if either is missing -- the bid is thrown
 * out as non-responsive before anyone reads it, and the bidder finds out weeks
 * later if at all.
 *
 * One route for both because they are one job: the checklist somebody clears
 * in the hour before submitting.
 */
export default withErrorHandling('admin-estimate-bid-desk', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const estimateId = pathId(context.params.id)
  if (estimateId === null) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, estimateId)).limit(1)
  if (!estimate) return notFound()

  const addenda = () => db.select().from(schema.bidAddenda)
    .where(eq(schema.bidAddenda.estimateId, estimateId))
    .orderBy(asc(schema.bidAddenda.number), asc(schema.bidAddenda.id))

  const submittals = () => db.select().from(schema.bidSubmittals)
    .where(eq(schema.bidSubmittals.estimateId, estimateId))
    .orderBy(asc(schema.bidSubmittals.sortOrder), asc(schema.bidSubmittals.id))

  if (request.method === 'GET') {
    const [a, s] = await Promise.all([addenda(), submittals()])
    return json({
      addenda: a,
      submittals: s,
      readiness: bidReadiness({
        addenda: a,
        submittals: s,
        isGovernment: estimate.bidMode === 'government',
        bidDueAt: estimate.bidDueAt,
      }),
      // The library, so the checklist can be started without typing it out.
      library: STANDARD_SUBMITTALS,
      suggested: suggestedSubmittals(estimate.bidMode === 'government').map(x => x.key),
    })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

  const action = body.action

  /* ---- addenda ---- */

  if (action === 'add-addendum') {
    const number = text(body.number, MAX_NUMBER)
    if (!number) return badRequest('Give the addendum its number, as the agency numbered it')

    const existing = await addenda()
    if (existing.some(a => a.number.toLowerCase() === number.toLowerCase())) {
      return badRequest(`Addendum ${number} is already on this bid`)
    }

    const [row] = await db.insert(schema.bidAddenda).values({
      estimateId,
      number,
      receivedAt: typeof body.receivedAt === 'string' && body.receivedAt ? body.receivedAt : null,
      summary: text(body.summary, MAX_TEXT),
      // Received is not acknowledged. Defaulting this true would defeat the
      // entire point of recording it.
      acknowledged: false,
      affectsPrice: Boolean(body.affectsPrice),
    }).returning()
    return json({ addendum: row }, { status: 201 })
  }

  if (action === 'acknowledge-addendum' || action === 'unacknowledge-addendum') {
    const id = pathId(String(body.id ?? ''))
    if (id === null) return badRequest('Which addendum?')
    const [row] = await db.select().from(schema.bidAddenda).where(eq(schema.bidAddenda.id, id)).limit(1)
    if (!row || row.estimateId !== estimateId) return notFound()

    await db.update(schema.bidAddenda)
      .set({ acknowledged: action === 'acknowledge-addendum' })
      .where(eq(schema.bidAddenda.id, id))
    return json({ ok: true })
  }

  if (action === 'remove-addendum') {
    const id = pathId(String(body.id ?? ''))
    if (id === null) return badRequest('Which addendum?')
    const [row] = await db.select().from(schema.bidAddenda).where(eq(schema.bidAddenda.id, id)).limit(1)
    if (!row || row.estimateId !== estimateId) return notFound()
    await db.delete(schema.bidAddenda).where(eq(schema.bidAddenda.id, id))
    return json({ ok: true })
  }

  /* ---- submittals ---- */

  if (action === 'seed-submittals') {
    const existing = await submittals()
    if (existing.length) return badRequest('This bid already has a checklist')

    const rows = suggestedSubmittals(estimate.bidMode === 'government').map((s, i) => ({
      estimateId,
      label: s.label,
      required: true,
      provided: false,
      note: s.why,
      sortOrder: i,
    }))
    if (!rows.length) return json({ submittals: [] }, { status: 201 })
    const created = await db.insert(schema.bidSubmittals).values(rows).returning()
    return json({ submittals: created }, { status: 201 })
  }

  if (action === 'add-submittal') {
    const label = text(body.label, MAX_LABEL)
    if (!label) return badRequest('Name the document before adding it')
    const existing = await submittals()
    const [row] = await db.insert(schema.bidSubmittals).values({
      estimateId,
      label,
      required: body.required === false ? false : true,
      provided: Boolean(body.provided),
      note: text(body.note, MAX_TEXT),
      sortOrder: existing.length,
    }).returning()
    return json({ submittal: row }, { status: 201 })
  }

  if (action === 'set-submittal') {
    const id = pathId(String(body.id ?? ''))
    if (id === null) return badRequest('Which submittal?')
    const [row] = await db.select().from(schema.bidSubmittals).where(eq(schema.bidSubmittals.id, id)).limit(1)
    if (!row || row.estimateId !== estimateId) return notFound()

    const updates: Record<string, unknown> = {}
    if ('provided' in body) updates.provided = Boolean(body.provided)
    if ('required' in body) updates.required = Boolean(body.required)
    if ('note' in body) updates.note = text(body.note, MAX_TEXT)
    if (!Object.keys(updates).length) return badRequest('Nothing to change')

    await db.update(schema.bidSubmittals).set(updates).where(eq(schema.bidSubmittals.id, id))
    return json({ ok: true })
  }

  if (action === 'remove-submittal') {
    const id = pathId(String(body.id ?? ''))
    if (id === null) return badRequest('Which submittal?')
    const [row] = await db.select().from(schema.bidSubmittals).where(eq(schema.bidSubmittals.id, id)).limit(1)
    if (!row || row.estimateId !== estimateId) return notFound()
    await db.delete(schema.bidSubmittals).where(eq(schema.bidSubmittals.id, id))
    return json({ ok: true })
  }

  return badRequest('Unknown action')
})

export const config = {
  path: '/api/admin/estimates/:id/bid-desk',
}
