/**
 * What a job photo is allowed to be.
 *
 * Kept apart from the storage in jobPhotos.mts, and free of any database
 * import, so these rules can be tested directly. That matters more than usual
 * here: the size limit cannot be exercised over HTTP at all, because
 * netlify-cli throws an unhandled "Stream body too big" and the dev server
 * exits rather than answering. A rule that can only be checked by killing the
 * environment is a rule nobody checks.
 *
 * Shared by two routes -- the admin work-order page and the crew's own link --
 * so both accept exactly the same images.
 */

/** After the browser downscales to 1600px and re-encodes at JPEG 0.75, a phone
 *  photo lands around 300-600KB. 4MB is generous headroom, not a target.
 *
 *  This is the second line, not the first: the platform caps a function request
 *  body before the handler runs, so anything genuinely enormous never arrives.
 *  This catches what does. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024
export const MAX_CAPTION = 200

/**
 * A ceiling on how many photos one job can hold.
 *
 * The crew link is an unauthenticated bearer write and nothing else bounds it:
 * whoever holds the link, or anyone they forwarded it to, could fill the blob
 * store a few hundred kilobytes at a time and nobody would notice until the
 * bill arrived.
 *
 * 200 is set to never bind on real work. A large forecourt shot in five areas,
 * before and after, generously, is under fifty. Anything approaching this is
 * not a thorough crew.
 */
export const MAX_PHOTOS_PER_JOB = 200

/*
 * JPEG, PNG and WebP only.
 *
 * Notably not SVG, which is a document that can carry script, served back from
 * our own origin to whoever opens the work order. And not GIF, which nothing
 * produces here and which the browser re-encodes to JPEG anyway.
 */
export const ALLOWED_PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface PhotoUpload {
  category: 'before' | 'after'
  caption: string | null
  contentType: string
  extension: string
  bytes: Buffer
}

export type PhotoUploadResult = { ok: true; value: PhotoUpload } | { ok: false; error: string }

export function parsePhotoUpload(body: { category?: unknown; caption?: unknown; dataUrl?: unknown }): PhotoUploadResult {
  if (body.category !== 'before' && body.category !== 'after') {
    return { ok: false, error: 'Category must be "before" or "after"' }
  }
  if (typeof body.dataUrl !== 'string' || !body.dataUrl) {
    return { ok: false, error: 'Missing image data' }
  }

  const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.dataUrl)
  if (!match) return { ok: false, error: 'Invalid image data URL' }

  const [, contentType, base64] = match
  const extension = ALLOWED_PHOTO_TYPES[contentType]
  if (!extension) return { ok: false, error: 'Only JPEG, PNG, or WebP images are allowed' }

  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) return { ok: false, error: 'That image came through empty -- please retake it' }
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'Image is too large (max 4MB) -- please retake or use a smaller photo' }
  }

  const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, MAX_CAPTION) : ''
  return { ok: true, value: { category: body.category, caption: caption || null, contentType, extension, bytes } }
}
