import type { Context } from '@netlify/functions'
import { isAuthenticated } from './_shared/auth.mts'
import { markInvoicePaid, InvoiceAlreadyPaidError, InvoiceNotFoundError } from './_shared/invoices.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

export default withErrorHandling('admin-invoice-mark-paid', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  try {
    await markInvoicePaid(id)
    return json({ ok: true })
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return notFound()
    if (err instanceof InvoiceAlreadyPaidError) return badRequest('This invoice is already marked paid')
    throw err
  }
})

export const config = {
  path: '/api/admin/invoices/:id/mark-paid',
}
