import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { storePhoto, listPhotos } from './_shared/jobPhotos.mts'
import { parsePhotoUpload } from './_shared/photoUpload.mts'

/**
 * Before-and-after photos, from the office.
 *
 * The crew can now add these from their own link, which is where most of them
 * should come from -- the office is not standing in front of the slab. The
 * rules live in _shared/photoUpload.mts and the storage in _shared/jobPhotos.mts,
 * so both routes accept exactly the same images and store them the same way.
 */
export default withErrorHandling('admin-work-order-photos', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const workOrderId = pathId(context.params.id)
  if (workOrderId === null) return notFound()

  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, workOrderId)).limit(1)
  if (!workOrder) return notFound()

  if (request.method === 'GET') {
    return json({ photos: await listPhotos(workOrderId) })
  }

  if (request.method === 'POST') {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const parsed = parsePhotoUpload(body)
    if (!parsed.ok) return badRequest(parsed.error)

    return json({ photo: await storePhoto(workOrderId, parsed.value, 'office') }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/admin/work-orders/:id/photos',
}
