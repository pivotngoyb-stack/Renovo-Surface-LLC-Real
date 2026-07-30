import { and, eq, gte, lt } from 'drizzle-orm'
import { db, schema } from './db.mts'

/**
 * Returns true if `key` is still under `maxAttempts` within the last `windowMinutes`,
 * and records this attempt. Returns false (caller should reject) once the limit is hit.
 * Backed by a plain table rather than in-memory state, since serverless function
 * instances don't share memory across invocations.
 */
export async function checkRateLimit(key: string, maxAttempts: number, windowMinutes: number): Promise<boolean> {
  // Opportunistic cleanup so this table doesn't grow unbounded -- no separate cron needed.
  if (Math.random() < 0.05) {
    await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.attemptedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
  }

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000)
  const attempts = await db
    .select()
    .from(schema.loginAttempts)
    .where(and(eq(schema.loginAttempts.key, key), gte(schema.loginAttempts.attemptedAt, windowStart)))

  if (attempts.length >= maxAttempts) return false

  await db.insert(schema.loginAttempts).values({ key })
  return true
}
