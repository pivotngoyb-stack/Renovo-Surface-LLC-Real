import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { json, notFound, badRequest, getClientIp } from './_shared/http.mts'
import { sendSignedWorkOrderConfirmation } from './_shared/email.mts'

interface SignBody {
  signerName: string
  signatureType: 'drawn' | 'typed'
  signatureData: string
  consentConfirmed: boolean
}

export default async (request: Request, context: Context) => {
  const token = context.params.token
  const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.token, token)).limit(1)
  if (!workOrder) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, workOrder.estimateId)).limit(1)
  const client = estimate ? (await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1))[0] : undefined

  if (request.method === 'GET') {
    const [signature] = await db.select().from(schema.signatures).where(eq(schema.signatures.workOrderId, workOrder.id)).limit(1)
    const lineItems = estimate
      ? await db.select().from(schema.estimateLineItems).where(eq(schema.estimateLineItems.estimateId, estimate.id))
      : []
    return json({ workOrder, client, signature: signature || null, lineItems })
  }

  if (request.method === 'POST') {
    if (workOrder.status === 'signed') {
      return badRequest('This work order has already been signed')
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

    await db.insert(schema.signatures).values({
      workOrderId: workOrder.id,
      signerName: body.signerName.trim(),
      signatureType: body.signatureType,
      signatureData: body.signatureData,
      consentConfirmed: true,
      ipAddress: getClientIp(request),
    })

    await db.update(schema.workOrders).set({ status: 'signed' }).where(eq(schema.workOrders.id, workOrder.id))

    if (client) await sendSignedWorkOrderConfirmation(client.email, client.name, workOrder.id)

    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/work-order/:token',
}
