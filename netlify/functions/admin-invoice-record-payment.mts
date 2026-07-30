import type { Context } from '@netlify/functions'
import { isAuthenticated } from './_shared/auth.mts'
import { getInvoiceTotals, recordPayment, InvoiceAlreadyPaidError, InvoiceNotFoundError } from './_shared/invoices.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const VALID_METHODS = new Set(['cash', 'check', 'card', 'other'])

export default withErrorHandling('admin-invoice-record-payment', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid invoice id')

  let body: { amount?: number; method?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return badRequest('Amount must be a positive number')
  const method = body.method && VALID_METHODS.has(body.method) ? body.method : 'other'

  try {
    const totals = await getInvoiceTotals(id)
    if (amount > totals.balanceDue + 0.01) {
      return badRequest(`Amount exceeds the balance due (${totals.balanceDue.toFixed(2)})`)
    }

    const { fullyPaid } = await recordPayment(id, { amount, method: method as any, note: body.note })
    return json({ ok: true, fullyPaid })
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return notFound()
    if (err instanceof InvoiceAlreadyPaidError) return badRequest('This invoice is already paid in full')
    throw err
  }
})

export const config = {
  path: '/api/admin/invoices/:id/record-payment',
}
