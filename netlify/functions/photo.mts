import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { db, schema } from './_shared/db.mts'
import { notFound } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  const token = context.params.token
  const [photo] = await db.select().from(schema.workOrderPhotos).where(eq(schema.workOrderPhotos.token, token)).limit(1)
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
}

export const config = {
  path: '/api/photos/:token',
}
