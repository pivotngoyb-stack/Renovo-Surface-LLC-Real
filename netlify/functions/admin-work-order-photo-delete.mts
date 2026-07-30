import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

export default withErrorHandling('admin-work-order-photo-delete', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, { status: 405 })

  const workOrderId = Number(context.params.id)
  const photoId = Number(context.params.photoId)
  if (!Number.isInteger(workOrderId) || !Number.isInteger(photoId)) return badRequest('Invalid id')

  const [photo] = await db.select().from(schema.workOrderPhotos).where(eq(schema.workOrderPhotos.id, photoId)).limit(1)
  if (!photo || photo.workOrderId !== workOrderId) return notFound()

  const store = getStore('job-photos')
  await store.delete(photo.blobKey)
  await db.delete(schema.workOrderPhotos).where(eq(schema.workOrderPhotos.id, photoId))

  return json({ ok: true })
})

export const config = {
  path: '/api/admin/work-orders/:id/photos/:photoId',
}
