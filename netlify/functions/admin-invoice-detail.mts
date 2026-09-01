import type { Context } from '@netlify/functions'
import { isAuthenticated } from './_shared/auth.mts'
import { getInvoiceTotals, InvoiceNotFoundError } from './_shared/invoices.mts'
import { json, unauthorized, notFound, pathId } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

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
