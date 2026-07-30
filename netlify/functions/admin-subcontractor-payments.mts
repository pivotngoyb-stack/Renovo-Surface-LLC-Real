import { eq, desc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

const VALID_METHODS = new Set(['cash', 'check', 'card', 'other'])

export default withErrorHandling('admin-subcontractor-payments', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const subId = Number(context.params.id)
  if (!Number.isInteger(subId)) return badRequest('Invalid subcontractor id')

  const [agreement] = await db.select().from(schema.subcontractorAgreements).where(eq(schema.subcontractorAgreements.id, subId)).limit(1)
  if (!agreement) return notFound()

  if (request.method === 'GET') {
    const payments = await db
      .select()
      .from(schema.subcontractorPayments)
      .where(eq(schema.subcontractorPayments.subcontractorAgreementId, subId))
      .orderBy(desc(schema.subcontractorPayments.paidDate))

    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0)
    return json({ payments, totalPaid })
  }

  if (request.method === 'POST') {
    let body: { amount?: number; method?: string; paidDate?: string; note?: string }
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) return badRequest('Amount must be a positive number')
    const method = body.method && VALID_METHODS.has(body.method) ? body.method : 'other'
    const paidDate = body.paidDate || new Date().toISOString().slice(0, 10)

    const [payment] = await db
      .insert(schema.subcontractorPayments)
      .values({ subcontractorAgreementId: subId, amount: String(amount), method: method as any, paidDate, note: body.note })
      .returning()

    return json({ payment }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
})

export const config = {
  path: '/api/admin/subcontractors/:id/payments',
}
