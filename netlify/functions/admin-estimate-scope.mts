import { eq, and, asc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { buildProposalScope, isProtectedExclusion } from './_shared/scopeLibrary.mts'

const KINDS = ['scope', 'exclusion', 'assumption', 'clarification'] as const
type Kind = (typeof KINDS)[number]

/** Long enough for a real clarification, short enough not to be a contract. */
const MAX_TEXT = 600

/**
 * The statements this bid makes, beyond what its services imply.
 *
 * Every proposal used to carry exactly the boilerplate its service types
 * produced -- nothing could be added and nothing removed. That is fine for a
 * driveway. On a construction bid it is the whole problem: the library cannot
 * know that this building is released floor by floor, that the parking
 * structure is out, or that another trade's overspray is not ours to remove,
 * and those are precisely the sentences that decide who pays when the
 * superintendent disagrees.
 *
 * GET returns the assembled document *and* the custom rows behind it, so the
 * editor can show what the client will read and what can be changed in the
 * same breath -- rather than making the owner send a preview to find out.
 */
export default withErrorHandling('admin-estimate-scope', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const estimateId = pathId(context.params.id)
  if (estimateId === null) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, estimateId)).limit(1)
  if (!estimate) return notFound()

  const lines = () => db
    .select()
    .from(schema.estimateScopeLines)
    .where(eq(schema.estimateScopeLines.estimateId, estimateId))
    .orderBy(asc(schema.estimateScopeLines.sortOrder), asc(schema.estimateScopeLines.id))

  if (request.method === 'GET') {
    const custom = await lines()
    const serviceTypes = (await db
      .select({ serviceType: schema.estimateLineItems.serviceType })
      .from(schema.estimateLineItems)
      .where(eq(schema.estimateLineItems.estimateId, estimateId)))
      .map(r => r.serviceType)

    return json({
      custom,
      // What the client will actually read, library and custom composed the
      // same way the proposal composes it.
      composed: buildProposalScope(serviceTypes, custom),
      // The untouched library, so the editor can offer a line to suppress
      // without the owner having to remember what it said.
      library: buildProposalScope(serviceTypes),
    })
  }

  if (request.method === 'POST') {
    let body: { kind?: unknown; text?: unknown; suppress?: unknown }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (!KINDS.includes(body.kind as Kind)) {
      return badRequest(`Kind must be one of: ${KINDS.join(', ')}`)
    }
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) return badRequest('Write the statement before adding it')
    if (text.length > MAX_TEXT) return badRequest(`Keep it under ${MAX_TEXT} characters`)

    const suppress = Boolean(body.suppress)

    /*
     * Some exclusions do not come off.
     *
     * They are the ones stating that Renovo is a cleaning contractor, holds no
     * trade licence, and does not touch hazardous material. A bid without them
     * invites a general contractor to hand over work that is not a scope
     * dispute but an uninsured one -- and the moment that is one click away, it
     * happens at eleven at night before a deadline.
     */
    if (suppress && body.kind === 'exclusion' && isProtectedExclusion(text)) {
      return badRequest(
        'That exclusion stays on every bid. It is what says Renovo is a cleaning contractor and holds '
        + 'no trade licence, and removing it invites work we cannot insure or licence. If this job '
        + 'genuinely needs different wording, add a clarification instead.',
      )
    }

    const existing = await lines()

    /*
     * The same statement twice is noise on a document a client reads closely,
     * and a duplicated suppression does nothing at all. Matched on trimmed
     * text within the kind, which is what a person would call "the same line".
     */
    if (existing.some(l => l.kind === body.kind && l.suppress === suppress && l.text.trim() === text)) {
      return badRequest('That line is already on this bid')
    }

    const [row] = await db
      .insert(schema.estimateScopeLines)
      .values({
        estimateId,
        kind: body.kind as Kind,
        text,
        suppress,
        sortOrder: existing.length,
      })
      .returning()

    return json({ line: row }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/admin/estimates/:id/scope',
}
