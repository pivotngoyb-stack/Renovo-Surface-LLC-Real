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

/**
 * "You may not do that to this" -- and deliberately NOT a 403.
 *
 * Netlify treats 403 from a path-routed function the same way it treats 404:
 * the response is discarded, the request is retried against the static-file
 * candidates (`/thing/12.html`, `/thing/12/index.html`, ...), and because those
 * still match the route pattern the function runs again with a nonsense id and
 * answers "Not found". The client never sees the 403 or its message -- it sees
 * a 404 about something else.
 *
 * Established by experiment, not inference: the same handler returning 403
 * produced retries in the dev log and a 404 at the client; returning 409
 * delivered the message intact and produced no retries. 400 and 401 are
 * unaffected.
 *
 * 409 is the closest surviving status. The request is well-formed and the
 * caller is known, so 400 would be a lie; the conflict is between what the
 * caller is asking for and what this link is allowed to touch.
 */
export function forbidden(message: string): Response {
  return json({ error: message }, { status: 409 })
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
