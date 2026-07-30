import { eq, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { computeTotal, invoiceNumber } from './_shared/money.mts'
import { toCsv } from './_shared/csv.mts'
import { unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

export default withErrorHandling('admin-invoices-export', async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()

  const url = new URL(request.url)
  const showArchived = url.searchParams.get('archived') === '1'
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const invoiceRows = await db
    .select({
      id: schema.invoices.id,
      status: schema.invoices.status,
      dueDate: schema.invoices.dueDate,
      createdAt: schema.invoices.createdAt,
      paidAt: schema.invoices.paidAt,
      taxApplied: schema.invoices.taxApplied,
      taxAmount: schema.invoices.taxAmount,
      workOrderId: schema.invoices.workOrderId,
      recurringContractId: schema.invoices.recurringContractId,
      clientName: schema.clients.name,
      clientEmail: schema.clients.email,
    })
    .from(schema.invoices)
    .leftJoin(schema.clients, eq(schema.invoices.clientId, schema.clients.id))
    .where(eq(schema.invoices.archived, showArchived))
    .orderBy(desc(schema.invoices.createdAt))

  const allLineItems = await db.select().from(schema.invoiceLineItems)
  const allPayments = await db.select().from(schema.invoicePayments)

  let rows = invoiceRows.map((inv) => {
    const items = allLineItems.filter((li) => li.invoiceId === inv.id)
    const subtotal = computeTotal(items)
    const total = subtotal + Number(inv.taxAmount || 0)
    const ledgerSum = allPayments.filter((p) => p.invoiceId === inv.id).reduce((sum, p) => sum + Number(p.amount), 0)
    const amountPaid = ledgerSum > 0 ? ledgerSum : inv.status === 'paid' ? total : 0
    const balanceDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100)

    return {
      invoiceNumber: invoiceNumber(inv.id),
      clientName: inv.clientName || '',
      clientEmail: inv.clientEmail || '',
      status: inv.status,
      subtotal: subtotal.toFixed(2),
      tax: Number(inv.taxAmount || 0).toFixed(2),
      total: total.toFixed(2),
      amountPaid: amountPaid.toFixed(2),
      balanceDue: balanceDue.toFixed(2),
      dueDate: inv.dueDate || '',
      createdDate: new Date(inv.createdAt).toISOString().slice(0, 10),
      paidDate: inv.paidAt ? new Date(inv.paidAt).toISOString().slice(0, 10) : '',
      workOrderId: inv.workOrderId || '',
      contractId: inv.recurringContractId || '',
      createdAtRaw: inv.createdAt,
    }
  })

  if (from) rows = rows.filter((r) => r.createdAtRaw >= new Date(from))
  if (to) rows = rows.filter((r) => r.createdAtRaw <= new Date(to))

  const csv = toCsv(rows, [
    { key: 'invoiceNumber', label: 'Invoice #' },
    { key: 'clientName', label: 'Client Name' },
    { key: 'clientEmail', label: 'Client Email' },
    { key: 'status', label: 'Status' },
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'tax', label: 'Tax' },
    { key: 'total', label: 'Total' },
    { key: 'amountPaid', label: 'Amount Paid' },
    { key: 'balanceDue', label: 'Balance Due' },
    { key: 'dueDate', label: 'Due Date' },
    { key: 'createdDate', label: 'Created Date' },
    { key: 'paidDate', label: 'Paid Date' },
    { key: 'workOrderId', label: 'Work Order ID' },
    { key: 'contractId', label: 'Contract ID' },
  ])

  const filename = `invoices-export-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

export const config = {
  path: '/api/admin/invoices-export',
}
