export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
}

export function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, { status: 401 })
}

export function notFound(): Response {
  return json({ error: 'Not found' }, { status: 404 })
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 })
}

/** Best-effort client IP from Netlify's forwarded headers. */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

/**
 * A positive integer id from the path, or null if there isn't one.
 *
 * Callers must answer null with `notFound()`, not `badRequest()`. That looks
 * like the wrong status until you know what actually happens here.
 *
 * Netlify swallows a 404 returned by a path-routed function and re-invokes the
 * function, and the second invocation arrives with no path parameters at all.
 * So a handler that answered `badRequest('Invalid contract id')` on an
 * unparseable id was emitting that message for a *missing row*: the client
 * asked for contract 999999, the first run correctly returned 404, the retry
 * ran with no id, and the client received "Invalid contract id" -- an error
 * about the wrong thing entirely, pointing at the wrong file. It cost real
 * debugging time twice.
 *
 * Both cases that reach a null here deserve a 404:
 *   - the retry of a request whose honest answer was already 404
 *   - a literal segment colliding with :id, like /api/admin/invoices/export,
 *     which genuinely is not an endpoint
 *
 * Verified rather than assumed: a function returning a 404 with a distinctive
 * body never delivers that body to the client, it delivers the id-guard error
 * instead.
 */
export function pathId(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}
