import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import {
  lienSteps, lienUrgency, PRELIMINARY_NOTICE_DAYS, LIEN_FILING_DAYS,
} from './_shared/lienDeadlines.mts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_REF = 120
const MAX_NOTES = 1000

/**
 * Lien deadlines for one project.
 *
 * A calendar, not a filing service and not legal advice. The value is being
 * reminded on day four instead of remembering on day forty -- by which point
 * the only leverage a cleaning contractor has over an unpaid six-figure
 * receivable is gone, and the invoice is owed by somebody with no reason to
 * pay it.
 *
 * The row is created on first write rather than with the estimate, because
 * most jobs are a driveway and do not need one.
 */
export default withErrorHandling('admin-estimate-lien', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const estimateId = pathId(context.params.id)
  if (estimateId === null) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, estimateId)).limit(1)
  if (!estimate) return notFound()

  const load = async () => {
    const [row] = await db.select().from(schema.lienNotices)
      .where(eq(schema.lienNotices.estimateId, estimateId)).limit(1)
    return row || null
  }

  const respond = (row: typeof schema.lienNotices.$inferSelect | null) => {
    const record = {
      firstWorkDate: row?.firstWorkDate ?? null,
      preliminaryFiledAt: row?.preliminaryFiledAt ?? null,
      completionDate: row?.completionDate ?? null,
      lienFiledAt: row?.lienFiledAt ?? null,
      waived: row?.waived ?? false,
      projectType: (row?.projectType === 'public' ? 'public' : 'private') as 'public' | 'private',
      bondNoticeDue: row?.bondNoticeDue ?? null,
      bondNoticeFiledAt: row?.bondNoticeFiledAt ?? null,
      bondReference: row?.bondReference ?? null,
    }
    const steps = lienSteps(record)
    return json({
      lien: row,
      steps,
      urgency: lienUrgency(steps),
      windows: { preliminaryDays: PRELIMINARY_NOTICE_DAYS, lienDays: LIEN_FILING_DAYS },
    })
  }

  if (request.method === 'GET') return respond(await load())
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  /*
   * A date is either a real ISO date or absent. A half-parsed one would silently
   * become a deadline computed from nonsense, which on this particular feature
   * is worse than having no deadline at all -- a wrong date reassures.
   */
  const dateOrNull = (v: unknown, field: string): string | null | undefined => {
    if (v === undefined) return undefined            // not being changed
    if (v === null || v === '') return null          // being cleared
    if (typeof v !== 'string' || !DATE_RE.test(v)) throw new Error(`${field} must be a date, as YYYY-MM-DD`)
    return v
  }

  const updates: Record<string, unknown> = {}
  try {
    for (const [key, label] of [
      ['firstWorkDate', 'The first work date'],
      ['preliminaryFiledAt', 'The preliminary filing date'],
      ['completionDate', 'The completion date'],
      ['lienFiledAt', 'The lien filing date'],
      ['bondNoticeDue', 'The bond notice deadline'],
      ['bondNoticeFiledAt', 'The bond notice date'],
    ] as const) {
      const v = dateOrNull(body[key], label)
      if (v !== undefined) updates[key] = v
    }
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : 'Invalid date')
  }

  if ('waived' in body) updates.waived = Boolean(body.waived)
  if ('projectType' in body) {
    // Anything that is not explicitly public stays private, which is the
    // shape that produces a real computed deadline rather than a prompt.
    updates.projectType = body.projectType === 'public' ? 'public' : 'private'
  }
  if ('bondReference' in body) {
    updates.bondReference = typeof body.bondReference === 'string' && body.bondReference.trim()
      ? body.bondReference.trim().slice(0, MAX_REF) : null
  }
  if ('preliminaryReference' in body) {
    updates.preliminaryReference = typeof body.preliminaryReference === 'string' && body.preliminaryReference.trim()
      ? body.preliminaryReference.trim().slice(0, MAX_REF) : null
  }
  if ('notes' in body) {
    updates.notes = typeof body.notes === 'string' && body.notes.trim()
      ? body.notes.trim().slice(0, MAX_NOTES) : null
  }

  if (!Object.keys(updates).length) return badRequest('Nothing to update')

  const existing = await load()
  if (existing) {
    await db.update(schema.lienNotices)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.lienNotices.estimateId, estimateId))
  } else {
    await db.insert(schema.lienNotices).values({ estimateId, ...updates })
  }

  return respond(await load())
})

export const config = {
  path: '/api/admin/estimates/:id/lien',
}
