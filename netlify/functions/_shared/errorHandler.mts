import type { Context } from '@netlify/functions'
import { json } from './http.mts'
import { notifyAdminFunctionError } from './email.mts'

type Handler = (request: Request, context: Context) => Promise<Response>

// Per-function cooldown so a hot-looping failure (bad deploy, DB outage) sends
// one alert instead of flooding the inbox. Best-effort only -- resets on cold
// start, which is fine since a fresh alert after a cold start is still useful.
const ALERT_COOLDOWN_MS = 15 * 60 * 1000
const lastAlertAt = new Map<string, number>()

/**
 * Wraps a Netlify Function handler so an unhandled exception returns a clean
 * JSON 500 (instead of an opaque platform error) and emails the admin once
 * per cooldown window, so real production breakage doesn't sit invisible in
 * function logs nobody checks.
 */
export function withErrorHandling(name: string, handler: Handler): Handler {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      const message = err instanceof Error ? (err.stack || err.message) : String(err)
      console.error(`[unhandled error] ${name}`, err)

      const now = Date.now()
      const last = lastAlertAt.get(name) || 0
      if (now - last > ALERT_COOLDOWN_MS) {
        lastAlertAt.set(name, now)
        await notifyAdminFunctionError(name, message, `${request.method} ${request.url}`).catch((alertErr) => {
          console.error(`[error alert failed] ${name}`, alertErr)
        })
      }

      return json({ error: 'Something went wrong on our end. Please try again or contact support.' }, { status: 500 })
    }
  }
}
