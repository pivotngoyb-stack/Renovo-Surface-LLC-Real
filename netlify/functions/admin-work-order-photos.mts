import { eq, asc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { generateToken } from './_shared/tokens.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const MAX_BYTES = 4 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export default withErrorHandling('admin-work-order-photos', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const workOrderId = pathId(context.params.id)
  if (workOrderId === null) return notFound()

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, workOrderId)).limit(1)
  if (!workOrder) return notFound()

  if (request.method === 'GET') {
    const photos = await db
      .select({
        id: schema.workOrderPhotos.id,
        token: schema.workOrderPhotos.token,
        category: schema.workOrderPhotos.category,
        caption: schema.workOrderPhotos.caption,
        contentType: schema.workOrderPhotos.contentType,
        sizeBytes: schema.workOrderPhotos.sizeBytes,
        sortOrder: schema.workOrderPhotos.sortOrder,
        uploadedAt: schema.workOrderPhotos.uploadedAt,
      })
      .from(schema.workOrderPhotos)
      .where(eq(schema.workOrderPhotos.workOrderId, workOrderId))
      .orderBy(asc(schema.workOrderPhotos.sortOrder))

    return json({ photos })
  }

  if (request.method === 'POST') {
    let body: { category?: string; caption?: string; dataUrl?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (body.category !== 'before' && body.category !== 'after') return badRequest('Category must be "before" or "after"')
    if (!body.dataUrl) return badRequest('Missing image data')

    const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.dataUrl)
    if (!match) return badRequest('Invalid image data URL')
    const [, contentType, base64] = match
    if (!ALLOWED_TYPES[contentType]) return badRequest('Only JPEG, PNG, or WebP images are allowed')

    const bytes = Buffer.from(base64, 'base64')
    if (bytes.byteLength > MAX_BYTES) return badRequest('Image is too large (max 4MB) -- please retake or use a smaller photo')

    const token = generateToken()
    const blobKey = `${workOrderId}/${token}.${ALLOWED_TYPES[contentType]}`

    const store = getStore('job-photos')
    await store.set(blobKey, bytes, { metadata: { contentType } })

    const [photo] = await db
      .insert(schema.workOrderPhotos)
      .values({
        workOrderId,
        token,
        blobKey,
        category: body.category,
        caption: body.caption?.trim() || null,
        contentType,
        sizeBytes: bytes.byteLength,
      })
      .returning({
        id: schema.workOrderPhotos.id,
        token: schema.workOrderPhotos.token,
        category: schema.workOrderPhotos.category,
        caption: schema.workOrderPhotos.caption,
        contentType: schema.workOrderPhotos.contentType,
        sizeBytes: schema.workOrderPhotos.sizeBytes,
        uploadedAt: schema.workOrderPhotos.uploadedAt,
      })

    return json({ photo }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/admin/work-orders/:id/photos',
}
