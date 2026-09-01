import { eq, and, gte, lte } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { toCsv } from './_shared/csv.mts'
import { json, unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const THRESHOLD = 600

export default withErrorHandling('admin-1099-report', async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()

  const url = new URL(request.url)
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear()
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json'

  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  // Query directly against the payment ledger joined to agreements for name/contact --
  // deliberately NOT filtered by archived, since an archived sub's historical
  // payments still count toward that tax year's 1099 total.
  const rows = await db
    .select({
      subcontractorAgreementId: schema.subcontractorPayments.subcontractorAgreementId,
      amount: schema.subcontractorPayments.amount,
      subcontractorName: schema.subcontractorAgreements.subcontractorName,
      subcontractorPhone: schema.subcontractorAgreements.subcontractorPhone,
      subcontractorEmail: schema.subcontractorAgreements.subcontractorEmail,
    })
    .from(schema.subcontractorPayments)
    .innerJoin(schema.subcontractorAgreements, eq(schema.subcontractorPayments.subcontractorAgreementId, schema.subcontractorAgreements.id))
    .where(and(gte(schema.subcontractorPayments.paidDate, yearStart), lte(schema.subcontractorPayments.paidDate, yearEnd)))

  const bySub = new Map<number, { subcontractorId: number; subcontractorName: string; subcontractorPhone: string; subcontractorEmail: string | null; totalPaid: number; paymentCount: number }>()
  for (const row of rows) {
    const existing = bySub.get(row.subcontractorAgreementId)
    if (existing) {
      existing.totalPaid += Number(row.amount)
      existing.paymentCount += 1
    } else {
      bySub.set(row.subcontractorAgreementId, {
        subcontractorId: row.subcontractorAgreementId,
        subcontractorName: row.subcontractorName,
        subcontractorPhone: row.subcontractorPhone,
        subcontractorEmail: row.subcontractorEmail,
        totalPaid: Number(row.amount),
        paymentCount: 1,
      })
    }
  }

  const subs = Array.from(bySub.values())
    .map((s) => ({ ...s, totalPaid: Math.round(s.totalPaid * 100) / 100, meetsThreshold: s.totalPaid >= THRESHOLD }))
    .sort((a, b) => b.totalPaid - a.totalPaid)

  if (format === 'csv') {
    const csv = toCsv(subs, [
      { key: 'subcontractorName', label: 'Subcontractor' },
      { key: 'subcontractorPhone', label: 'Phone' },
      { key: 'subcontractorEmail', label: 'Email' },
      { key: 'totalPaid', label: `Total Paid ${year}` },
      { key: 'paymentCount', label: 'Payment Count' },
      { key: 'meetsThreshold', label: '1099 Required (>= $600)' },
    ])
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="1099-report-${year}.csv"`,
      },
    })
  }

  return json({ year, subs })
})

export const config = {
  path: '/api/admin/1099-report',
}
