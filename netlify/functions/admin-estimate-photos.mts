import { eq, asc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { generateToken } from './_shared/tokens.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const MAX_BYTES = 4 * 1024 * 1024
const MAX_PHOTOS = 12
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Walk-through photos on an estimate.
 *
 * These end up on a proposal a prospect reads, which is why there is a cap:
 * a bid document with thirty phone photos in it stops looking like evidence
 * and starts looking like a camera roll.
 */
export default withErrorHandling('admin-estimate-photos', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const estimateId = Number(context.params.id)
  if (!Number.isInteger(estimateId)) return badRequest('Invalid estimate id')

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, estimateId)).limit(1)
  if (!estimate) return notFound()

  const listColumns = {
    id: schema.estimatePhotos.id,
    token: schema.estimatePhotos.token,
    caption: schema.estimatePhotos.caption,
    contentType: schema.estimatePhotos.contentType,
    sizeBytes: schema.estimatePhotos.sizeBytes,
    sortOrder: schema.estimatePhotos.sortOrder,
    uploadedAt: schema.estimatePhotos.uploadedAt,
  }

  if (request.method === 'GET') {
    const photos = await db
      .select(listColumns)
      .from(schema.estimatePhotos)
      .where(eq(schema.estimatePhotos.estimateId, estimateId))
      .orderBy(asc(schema.estimatePhotos.sortOrder), asc(schema.estimatePhotos.id))

    return json({ photos })
  }

  if (request.method === 'POST') {
    let body: { caption?: string; dataUrl?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (!body.dataUrl) return badRequest('Missing image data')

    const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.dataUrl)
    if (!match) return badRequest('Invalid image data URL')
    const [, contentType, base64] = match
    if (!ALLOWED_TYPES[contentType]) return badRequest('Only JPEG, PNG, or WebP images are allowed')

    const bytes = Buffer.from(base64, 'base64')
    if (bytes.byteLength > MAX_BYTES) {
      return badRequest('Image is too large (max 4MB) -- please retake or use a smaller photo')
    }

    const existing = await db
      .select({ sortOrder: schema.estimatePhotos.sortOrder })
      .from(schema.estimatePhotos)
      .where(eq(schema.estimatePhotos.estimateId, estimateId))
    if (existing.length >= MAX_PHOTOS) {
      return badRequest(`A proposal carries at most ${MAX_PHOTOS} photos. Remove one before adding another.`)
    }
    const nextOrder = existing.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1

    const token = generateToken()
    const blobKey = `estimates/${estimateId}/${token}.${ALLOWED_TYPES[contentType]}`

    const store = getStore('job-photos')
    await store.set(blobKey, bytes, { metadata: { contentType } })

    const [photo] = await db
      .insert(schema.estimatePhotos)
      .values({
        estimateId,
        token,
        blobKey,
        caption: body.caption?.trim() || null,
        contentType,
        sizeBytes: bytes.byteLength,
        sortOrder: nextOrder,
      })
      .returning(listColumns)

    return json({ photo }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/admin/estimates/:id/photos',
}
