import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'

export default withErrorHandling('admin-subcontractor-payment-delete', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, { status: 405 })

  const subId = pathId(context.params.id)
  const paymentId = pathId(context.params.paymentId)
  if (subId === null || paymentId === null) return notFound()

  const [payment] = await db
    .select()
    .from(schema.subcontractorPayments)
    .where(eq(schema.subcontractorPayments.id, paymentId))
    .limit(1)
  if (!payment || payment.subcontractorAgreementId !== subId) return notFound()

  await db.delete(schema.subcontractorPayments).where(eq(schema.subcontractorPayments.id, paymentId))

  return json({ ok: true })
})

export const config = {
  path: '/api/admin/subcontractors/:id/payments/:paymentId',
}
