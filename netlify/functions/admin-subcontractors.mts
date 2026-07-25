import { eq, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, badRequest } from './_shared/http.mts'
import { generateToken } from './_shared/tokens.mts'
import { sendSubcontractorAgreementLink } from './_shared/email.mts'

interface CreateAgreementBody {
  subcontractorName: string
  subcontractorPhone: string
  subcontractorEmail?: string
  paymentType: 'flat' | 'percentage'
  paymentAmount?: number | string
  paymentPercentage?: number | string
}

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()

  if (request.method === 'GET') {
    const showArchived = new URL(request.url).searchParams.get('archived') === '1'

    const rows = await db
      .select()
      .from(schema.subcontractorAgreements)
      .where(eq(schema.subcontractorAgreements.archived, showArchived))
      .orderBy(desc(schema.subcontractorAgreements.createdAt))

    return json({ agreements: rows })
  }

  if (request.method === 'POST') {
    let body: CreateAgreementBody
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (!body.subcontractorName?.trim()) return badRequest('Subcontractor name is required')
    if (!body.subcontractorPhone?.trim()) return badRequest('Subcontractor phone is required')
    if (body.paymentType !== 'flat' && body.paymentType !== 'percentage') {
      return badRequest('Payment type must be "flat" or "percentage"')
    }

    let paymentAmount: string | null = null
    let paymentPercentage: string | null = null
    if (body.paymentType === 'flat') {
      const amount = Number(body.paymentAmount)
      if (!Number.isFinite(amount) || amount <= 0) return badRequest('Payment amount must be a positive number')
      paymentAmount = String(amount)
    } else {
      const pct = Number(body.paymentPercentage)
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return badRequest('Payment percentage must be between 0 and 100')
      paymentPercentage = String(pct)
    }

    const [agreement] = await db
      .insert(schema.subcontractorAgreements)
      .values({
        token: generateToken(),
        subcontractorName: body.subcontractorName.trim(),
        subcontractorPhone: body.subcontractorPhone.trim(),
        subcontractorEmail: body.subcontractorEmail?.trim() || null,
        paymentType: body.paymentType,
        paymentAmount,
        paymentPercentage,
        status: 'pending',
      })
      .returning()

    if (agreement.subcontractorEmail) {
      await sendSubcontractorAgreementLink(agreement.subcontractorEmail, agreement.subcontractorName, agreement.token)
    }

    return json({ agreement }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/admin/subcontractors',
}
