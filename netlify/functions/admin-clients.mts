import { or, ilike, desc, sql } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const LIMIT = 8

/**
 * Client lookup for the estimate builder.
 *
 * Retyping a name, email, phone, company and address that are already in the
 * database is the slowest part of writing a quote, and the one most likely to
 * introduce a typo in the address the crew will drive to.
 *
 * Search only, never a full dump: an unfiltered client list is a mailing list,
 * and this endpoint is one auth bug away from being public.
 */
export default withErrorHandling('admin-clients', async (request: Request, _context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const q = (new URL(request.url).searchParams.get('q') || '').trim()
  if (q.length < 2) return json({ clients: [] })

  // Escape LIKE wildcards so a client searching for "50% off co" does not match
  // every row in the table.
  const term = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`

  const clients = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      email: schema.clients.email,
      phone: schema.clients.phone,
      company: schema.clients.company,
      propertyAddress: schema.clients.propertyAddress,
    })
    .from(schema.clients)
    .where(or(
      ilike(schema.clients.name, term),
      ilike(schema.clients.email, term),
      ilike(sql`coalesce(${schema.clients.company}, '')`, term),
    ))
    .orderBy(desc(schema.clients.id))
    .limit(LIMIT)

  return json({ clients })
})

export const config = {
  path: '/api/admin/clients',
}
