import type { Context } from '@netlify/functions'
import { isAuthenticated } from './_shared/auth.mts'
import { markInvoicePaid, InvoiceAlreadyPaidError, InvoiceNotFoundError } from './_shared/invoices.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid invoice id')

  try {
    await markInvoicePaid(id)
    return json({ ok: true })
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return notFound()
    if (err instanceof InvoiceAlreadyPaidError) return badRequest('This invoice is already marked paid')
    throw err
  }
}

export const config = {
  path: '/api/admin/invoices/:id/mark-paid',
}
