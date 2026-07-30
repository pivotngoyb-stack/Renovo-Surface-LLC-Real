import type { Context } from '@netlify/functions'
import { isAuthenticated } from './_shared/auth.mts'
import { getInvoiceTotals, InvoiceNotFoundError } from './_shared/invoices.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid invoice id')

  try {
    const { invoice, client, lineItems, payments, subtotal, total, amountPaid, balanceDue } = await getInvoiceTotals(id)
    return json({ invoice, client, lineItems, payments, subtotal, total, amountPaid, balanceDue })
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return notFound()
    throw err
  }
}

export const config = {
  path: '/api/admin/invoices/:id',
}
