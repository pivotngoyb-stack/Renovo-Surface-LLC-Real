import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, forbidden, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { deletePhoto } from './_shared/jobPhotos.mts'

/**
 * The crew retaking a bad shot.
 *
 * Without this the first blurry frame is permanent, it rides on the invoice
 * next to the good one, and the crew quickly learns not to bother taking any.
 *
 * But only their own. A photo the office added is frequently the record of
 * what a site looked like before anyone touched it, and that record vanishing
 * from a link that needs no password is the one scenario here worth
 * engineering against.
 */
export default withErrorHandling('crew-photo-delete', async (request: Request, context: Context) => {
  const token = context.params.token
  if (!token) return notFound()
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, { status: 405 })

  const photoId = pathId(context.params.photoId)
  if (photoId === null) return notFound()

  const [workOrder] = await db
    .select({ id: schema.workOrders.id })
    .from(schema.workOrders)
    .where(eq(schema.workOrders.crewToken, token))
    .limit(1)
  if (!workOrder) return notFound()

  const [photo] = await db
    .select()
    .from(schema.workOrderPhotos)
    .where(eq(schema.workOrderPhotos.id, photoId))
    .limit(1)
  if (!photo || photo.workOrderId !== workOrder.id) return notFound()

  if (photo.source !== 'crew') {
    return forbidden('The office added that one. Ring them if it needs to come down.')
  }

  await deletePhoto(photo)
  return json({ ok: true })
})

export const config = {
  path: '/api/crew/:token/photos/:photoId',
}
