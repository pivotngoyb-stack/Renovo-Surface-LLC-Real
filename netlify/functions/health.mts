import { sql } from 'drizzle-orm'
import { db } from './_shared/db.mts'
import { json } from './_shared/http.mts'

/**
 * Public, unauthenticated -- meant for an external uptime monitor. Deliberately
 * exposes no data, just confirms the site + database are reachable.
 */
export default async () => {
  try {
    await db.execute(sql`SELECT 1`)
    return json({ ok: true, db: 'ok', time: new Date().toISOString() })
  } catch (err) {
    console.error('[health] database check failed', err)
    return json({ ok: false, db: 'error' }, { status: 503 })
  }
}

export const config = {
  path: '/api/health',
}
