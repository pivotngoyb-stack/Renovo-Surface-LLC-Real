import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { deletePhoto } from './_shared/jobPhotos.mts'

export default withErrorHandling('admin-work-order-photo-delete', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, { status: 405 })

  const workOrderId = pathId(context.params.id)
  const photoId = pathId(context.params.photoId)
  if (workOrderId === null || photoId === null) return notFound()

  const [photo] = await db.select().from(schema.workOrderPhotos).where(eq(schema.workOrderPhotos.id, photoId)).limit(1)
  if (!photo || photo.workOrderId !== workOrderId) return notFound()

  // The office can remove any photo on the job, including one the crew took.
  await deletePhoto(photo)

  return json({ ok: true })
})

export const config = {
  path: '/api/admin/work-orders/:id/photos/:photoId',
}
