import { eq, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { generateToken } from './_shared/tokens.mts'
import { defaultValidUntil } from './_shared/expiry.mts'
import { json, unauthorized, badRequest } from './_shared/http.mts'

interface LineItemInput {
  description: string
  quantity?: number | string
  unitPrice: number | string
  serviceType?: string
  calculatorInputs?: string
  basePrice?: number | string
  finalPrice?: number | string
  estimatedDurationHours?: number | string
  estimatedProductCost?: number | string
}

interface CreateEstimateBody {
  client: {
    name: string
    email: string
    phone?: string
    company?: string
    propertyAddress?: string
  }
  notes?: string
  validUntil?: string
  projectName?: string
  siteAddress?: string
  /** The client's purchase order, when they issued one before the work was quoted. */
  poNumber?: string
  walkthroughDate?: string
  siteConditions?: string
  bidMode?: string
  solicitationNumber?: string
  optionYears?: number | string
  prevailingWage?: boolean
  lineItems: LineItemInput[]
  taxApplied?: boolean
  taxAmount?: number | string
}

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()

  if (request.method === 'GET') {
    const showArchived = new URL(request.url).searchParams.get('archived') === '1'

    const rows = await db
      .select({
        id: schema.estimates.id,
        status: schema.estimates.status,
        notes: schema.estimates.notes,
        validUntil: schema.estimates.validUntil,
        createdAt: schema.estimates.createdAt,
        updatedAt: schema.estimates.updatedAt,
        token: schema.estimates.token,
        archived: schema.estimates.archived,
        clientName: schema.clients.name,
        clientEmail: schema.clients.email,
      })
      .from(schema.estimates)
      .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
      .where(eq(schema.estimates.archived, showArchived))
      .orderBy(desc(schema.estimates.createdAt))

    return json({ estimates: rows })
  }

  if (request.method === 'POST') {
    let body: CreateEstimateBody
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (!body.client?.name || !body.client?.email) {
      return badRequest('Client name and email are required')
    }
    if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
      return badRequest('At least one line item is required')
    }

    // Reuse an existing client by email if one exists, otherwise create one.
    const existing = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.email, body.client.email))
      .limit(1)

    let clientId: number
    if (existing.length > 0) {
      clientId = existing[0].id
    } else {
      const [created] = await db
        .insert(schema.clients)
        .values({
          name: body.client.name,
          email: body.client.email,
          phone: body.client.phone,
          company: body.client.company,
          propertyAddress: body.client.propertyAddress,
        })
        .returning({ id: schema.clients.id })
      clientId = created.id
    }

    const [estimate] = await db
      .insert(schema.estimates)
      .values({
        clientId,
        token: generateToken(),
        notes: body.notes,
        projectName: body.projectName,
        siteAddress: body.siteAddress,
        poNumber: body.poNumber?.trim() ? body.poNumber.trim().slice(0, 60) : null,
        bidMode: body.bidMode === 'government' ? 'government' : 'standard',
        solicitationNumber: body.solicitationNumber,
        optionYears: Math.max(0, Math.min(Number(body.optionYears) || 0, 9)),
        prevailingWage: Boolean(body.prevailingWage),
        depositPct: body.depositPct != null && body.depositPct !== '' ? String(body.depositPct) : null,
        walkthroughDate: body.walkthroughDate,
        siteConditions: body.siteConditions,
        // Default to a 30-day window. Left blank, an estimate previously had
        // no expiry at all and stayed approvable at stale pricing forever.
        validUntil: body.validUntil || defaultValidUntil(),
        status: 'draft',
        taxApplied: Boolean(body.taxApplied),
        taxAmount: String(body.taxAmount ?? 0),
      })
      .returning()

    await db.insert(schema.estimateLineItems).values(
      body.lineItems.map((item, idx) => ({
        estimateId: estimate.id,
        description: item.description,
        quantity: String(item.quantity ?? 1),
        unitPrice: String(item.unitPrice),
        sortOrder: idx,
        unit: item.unit || 'job',
        frequency: item.frequency || 'one_time',
        siteName: item.siteName || null,
        isOptional: Boolean(item.isOptional),
        serviceType: item.serviceType,
        calculatorInputs: item.calculatorInputs,
        basePrice: item.basePrice != null ? String(item.basePrice) : null,
        finalPrice: item.finalPrice != null ? String(item.finalPrice) : null,
        estimatedDurationHours: item.estimatedDurationHours != null ? String(item.estimatedDurationHours) : null,
        estimatedProductCost: item.estimatedProductCost != null ? String(item.estimatedProductCost) : null,
        subcontracted: Boolean(item.subcontracted),
        subcontractorCost: item.subcontractorCost != null ? String(item.subcontractorCost) : null,
        subcontractCoordinationPct: item.subcontractCoordinationPct != null ? String(item.subcontractCoordinationPct) : null,
      })),
    )

    return json({ estimate }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/admin/estimates',
}
