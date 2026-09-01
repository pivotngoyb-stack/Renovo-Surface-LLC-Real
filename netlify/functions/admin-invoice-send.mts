import type { Context } from '@netlify/functions'
import { isAuthenticated } from './_shared/auth.mts'
import { formatMoney, invoiceNumber } from './_shared/money.mts'
import { getInvoiceTotals, InvoiceNotFoundError } from './_shared/invoices.mts'
import { generateInvoicePdf } from './_shared/pdf.mts'
import { sendInvoiceToClient } from './_shared/email.mts'
import { json, unauthorized, notFound, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

export default withErrorHandling('admin-invoice-send', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = pathId(context.params.id)
  if (id === null) return notFound()

  try {
    const { invoice, client, lineItems, subtotal, total, amountPaid, balanceDue } = await getInvoiceTotals(id)
    if (!client) return notFound()

    const numberLabel = invoiceNumber(invoice.id)
    const pdfBytes = await generateInvoicePdf({
      invoiceNumber: numberLabel,
      status: invoice.status,
      client,
      lineItems,
      subtotal,
      taxApplied: invoice.taxApplied,
      taxAmount: Number(invoice.taxAmount || 0),
      total,
      amountPaid,
      balanceDue,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
    })

    await sendInvoiceToClient(client.email, client.name, invoice.token, numberLabel, formatMoney(balanceDue > 0 ? balanceDue : total), pdfBytes)

    return json({ ok: true })
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return notFound()
    throw err
  }
})

export const config = {
  path: '/api/admin/invoices/:id/send',
}
