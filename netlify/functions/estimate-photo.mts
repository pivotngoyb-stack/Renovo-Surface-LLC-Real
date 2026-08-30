import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { db, schema } from './_shared/db.mts'
import { notFound } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

/**
 * Serves a walk-through photo to whoever holds the proposal link.
 *
 * Its own path rather than an extra lookup inside photo.mts: the two tables are
 * separate, and a serving route that falls through from one to the other on a
 * token miss is a route that will eventually serve the wrong image.
 *
 * The token is the capability. Photos are immutable once uploaded, so they are
 * cached hard.
 */
export default withErrorHandling('estimate-photo', async (request: Request, context: Context) => {
  const token = context.params.token
  const [photo] = await db
    .select()
    .from(schema.estimatePhotos)
    .where(eq(schema.estimatePhotos.token, token))
    .limit(1)
  if (!photo) return notFound()

  const store = getStore('job-photos')
  const bytes = await store.get(photo.blobKey, { type: 'arrayBuffer' })
  if (!bytes) return notFound()

  return new Response(bytes, {
    headers: {
      'Content-Type': photo.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

export const config = {
  path: '/api/estimate-photos/:token',
}
