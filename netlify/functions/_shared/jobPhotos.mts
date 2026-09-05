import { eq, asc, count } from 'drizzle-orm'
import { getStore } from '@netlify/blobs'
import { db, schema } from './db.mts'
import { generateToken } from './tokens.mts'
import type { PhotoUpload } from './photoUpload.mts'

/**
 * Where a job photo goes, and how it comes back.
 *
 * Shared because two routes now write them: the admin work-order page and the
 * crew's own link. Duplicated, the two would drift, and the drift would be
 * silent -- one route storing a blob under a key the other's delete cannot
 * find, leaving a thumbnail that 404s forever.
 *
 * These photos are the only record of what a site looked like. They settle a
 * damage dispute, they are what a facilities director forwards upstairs to
 * justify the spend, and they ride on the invoice. The rules for what counts
 * as an acceptable one live in photoUpload.mts.
 */

/** What the API hands back. Never the blob key -- that is storage, not identity. */
export const PHOTO_FIELDS = {
  id: schema.workOrderPhotos.id,
  token: schema.workOrderPhotos.token,
  category: schema.workOrderPhotos.category,
  caption: schema.workOrderPhotos.caption,
  contentType: schema.workOrderPhotos.contentType,
  sizeBytes: schema.workOrderPhotos.sizeBytes,
  sortOrder: schema.workOrderPhotos.sortOrder,
  source: schema.workOrderPhotos.source,
  uploadedAt: schema.workOrderPhotos.uploadedAt,
}

/** Writes the blob first, then the row: a row pointing at a blob that failed to
 *  write is a broken thumbnail forever, while an orphan blob is only bytes. */
export async function storePhoto(workOrderId: number, upload: PhotoUpload, source: 'office' | 'crew') {
  const token = generateToken()
  const blobKey = `${workOrderId}/${token}.${upload.extension}`

  await getStore('job-photos').set(blobKey, upload.bytes, { metadata: { contentType: upload.contentType } })

  const [photo] = await db
    .insert(schema.workOrderPhotos)
    .values({
      workOrderId,
      token,
      blobKey,
      category: upload.category,
      caption: upload.caption,
      contentType: upload.contentType,
      sizeBytes: upload.bytes.byteLength,
      source,
    })
    .returning(PHOTO_FIELDS)

  return photo
}

/** How many photos the job already holds, for the per-job ceiling. */
export async function countPhotos(workOrderId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.workOrderPhotos)
    .where(eq(schema.workOrderPhotos.workOrderId, workOrderId))
  return Number(row?.n || 0)
}

export async function listPhotos(workOrderId: number) {
  return db
    .select(PHOTO_FIELDS)
    .from(schema.workOrderPhotos)
    .where(eq(schema.workOrderPhotos.workOrderId, workOrderId))
    .orderBy(asc(schema.workOrderPhotos.sortOrder), asc(schema.workOrderPhotos.id))
}

/** Blob then row. The other order leaves a row whose image 404s. */
export async function deletePhoto(photo: { id: number; blobKey: string }) {
  await getStore('job-photos').delete(photo.blobKey)
  await db.delete(schema.workOrderPhotos).where(eq(schema.workOrderPhotos.id, photo.id))
}
