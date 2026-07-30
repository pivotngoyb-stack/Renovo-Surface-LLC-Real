import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { eq } from 'drizzle-orm'
import { getInvoiceTotals, InvoiceNotFoundError } from './_shared/invoices.mts'
import { invoiceNumber } from './_shared/money.mts'
import { generateInvoicePdf } from './_shared/pdf.mts'
import { notFound } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

export default withErrorHandling('invoice-pdf', async (request: Request, context: Context) => {
  const token = context.params.token
  const [invoiceRow] = await db.select().from(schema.invoices).where(eq(schema.invoices.token, token)).limit(1)
  if (!invoiceRow) return notFound()

  try {
    const { invoice, client, lineItems, subtotal, total, amountPaid, balanceDue } = await getInvoiceTotals(invoiceRow.id)
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

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${numberLabel}.pdf"`,
      },
    })
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) return notFound()
    throw err
  }
})

export const config = {
  path: '/api/invoice/:token/pdf',
}
