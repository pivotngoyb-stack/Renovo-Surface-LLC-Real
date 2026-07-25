import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, badRequest, getClientIp } from './_shared/http.mts'
import { notifyAdminSubcontractorAgreementSigned } from './_shared/email.mts'

interface SignBody {
  signerName: string
  signatureType: 'drawn' | 'typed'
  signatureData: string
  consentConfirmed: boolean
}

export default async (request: Request, context: Context) => {
  const token = context.params.token
  const [agreement] = await db.select().from(schema.subcontractorAgreements).where(eq(schema.subcontractorAgreements.token, token)).limit(1)
  if (!agreement) return notFound()

  if (request.method === 'GET') {
    return json({ agreement })
  }

  if (request.method === 'POST') {
    if (agreement.status === 'signed') {
      return badRequest('This agreement has already been signed')
    }

    let body: SignBody
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (!body.signerName?.trim()) return badRequest('Signer name is required')
    if (!body.signatureData) return badRequest('Signature is required')
    if (body.signatureType !== 'drawn' && body.signatureType !== 'typed') return badRequest('Invalid signature type')
    if (!body.consentConfirmed) return badRequest('Consent to sign electronically is required')

    await db
      .update(schema.subcontractorAgreements)
      .set({
        status: 'signed',
        signerName: body.signerName.trim(),
        signatureType: body.signatureType,
        signatureData: body.signatureData,
        consentConfirmed: true,
        ipAddress: getClientIp(request),
        signedAt: new Date(),
      })
      .where(eq(schema.subcontractorAgreements.id, agreement.id))

    await notifyAdminSubcontractorAgreementSigned(agreement.subcontractorName)

    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/subcontractor-agreement/:token',
}
