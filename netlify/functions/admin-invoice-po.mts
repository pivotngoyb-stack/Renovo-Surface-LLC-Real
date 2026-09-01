import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

/**
 * Set or correct the purchase order on an invoice.
 *
 * Editable after the invoice is raised, and after it has been sent, because
 * that is when the problem usually surfaces: accounts payable rejects the
 * invoice, quotes a number nobody at Renovo had, and it has to go back out
 * with the right one. Refusing to edit a sent invoice's PO would mean voiding
 * and re-raising it to change a reference field.
 *
 * Only the PO. Nothing here can touch an amount.
 */
export default withErrorHandling('admin-invoice-po', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  let body: { poNumber?: unknown }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request body')
  }

  // An empty string clears it. A client can withdraw a PO as well as issue one.
  const poNumber = typeof body.poNumber === 'string' && body.poNumber.trim()
    ? body.poNumber.trim().slice(0, 60)
    : null

  const [updated] = await db
    .update(schema.invoices)
    .set({ poNumber })
    .where(eq(schema.invoices.id, id))
    .returning({ id: schema.invoices.id, poNumber: schema.invoices.poNumber })

  if (!updated) return notFound()
  return json({ invoice: updated })
})

export const config = {
  path: '/api/admin/invoices/:id/po',
}
