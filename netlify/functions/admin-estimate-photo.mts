import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const MAX_CAPTION = 200

/** Caption or remove a single walk-through photo. */
export default withErrorHandling('admin-estimate-photo', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const estimateId = pathId(context.params.id)
  const photoId = pathId(context.params.photoId)
  if (estimateId === null || photoId === null) return notFound()

  const [photo] = await db.select().from(schema.estimatePhotos).where(eq(schema.estimatePhotos.id, photoId)).limit(1)
  // Ownership as well as existence: a photo id alone must not be enough to
  // touch something hanging off a different estimate.
  if (!photo || photo.estimateId !== estimateId) return notFound()

  if (request.method === 'PATCH') {
    let body: { caption?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const caption = (body.caption ?? '').trim()
    if (caption.length > MAX_CAPTION) return badRequest(`Caption must be ${MAX_CAPTION} characters or fewer`)

    await db
      .update(schema.estimatePhotos)
      .set({ caption: caption || null })
      .where(eq(schema.estimatePhotos.id, photoId))

    return json({ ok: true, caption: caption || null })
  }

  if (request.method === 'DELETE') {
    const store = getStore('job-photos')
    await store.delete(photo.blobKey)
    await db.delete(schema.estimatePhotos).where(eq(schema.estimatePhotos.id, photoId))
    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/admin/estimates/:id/photos/:photoId',
}
