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
