import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, { status: 405 })

  const subId = Number(context.params.id)
  const paymentId = Number(context.params.paymentId)
  if (!Number.isInteger(subId) || !Number.isInteger(paymentId)) return badRequest('Invalid id')

  const [payment] = await db
    .select()
    .from(schema.subcontractorPayments)
    .where(eq(schema.subcontractorPayments.id, paymentId))
    .limit(1)
  if (!payment || payment.subcontractorAgreementId !== subId) return notFound()

  await db.delete(schema.subcontractorPayments).where(eq(schema.subcontractorPayments.id, paymentId))

  return json({ ok: true })
}

export const config = {
  path: '/api/admin/subcontractors/:id/payments/:paymentId',
}
