import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, badRequest, forbidden } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { storePhoto, listPhotos, countPhotos } from './_shared/jobPhotos.mts'
import { parsePhotoUpload, MAX_PHOTOS_PER_JOB } from './_shared/photoUpload.mts'

/**
 * Before-and-after photos, taken by the people standing in front of the slab.
 *
 * The photo system already existed, but only an authenticated admin could add
 * to it -- and the admin is in an office. In practice that meant the evidence
 * that settles a damage dispute, and the before-and-after a facilities director
 * forwards to their own boss, depended on the owner remembering to ask someone
 * to text him pictures. Most of the time it did not happen.
 *
 * Same bearer link as the hours, and the same reasoning: a password on a phone
 * in a car park is how a step stops getting done.
 */
export default withErrorHandling('crew-photos', async (request: Request, context: Context) => {
  // Never badRequest on a missing path param: Netlify re-invokes a function
  // that 404s with no params at all, and the retry must land on notFound.
  const token = context.params.token
  if (!token) return notFound()

  const [workOrder] = await db
    .select({ id: schema.workOrders.id })
    .from(schema.workOrders)
    .where(eq(schema.workOrders.crewToken, token))
    .limit(1)
  if (!workOrder) return notFound()

  if (request.method === 'GET') {
    return json({ photos: await listPhotos(workOrder.id) })
  }

  if (request.method === 'POST') {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid request body')
    }

    const parsed = parsePhotoUpload(body)
    if (!parsed.ok) return badRequest(parsed.error)

    /*
     * The ceiling applies here and not on the admin route.
     *
     * This is an unauthenticated bearer write with nothing else bounding it.
     * The office is signed in and accountable, so it is never stopped from
     * adding a photo it actually needs.
     */
    if (await countPhotos(workOrder.id) >= MAX_PHOTOS_PER_JOB) {
      return forbidden(`This job already has ${MAX_PHOTOS_PER_JOB} photos. Ring the office before adding more.`)
    }

    return json({ photo: await storePhoto(workOrder.id, parsed.value, 'crew') }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/crew/:token/photos',
}
