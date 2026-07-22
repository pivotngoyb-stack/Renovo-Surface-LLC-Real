import { eq, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { generateToken } from './_shared/tokens.mts'
import { json, unauthorized, badRequest } from './_shared/http.mts'

interface LineItemInput {
  description: string
  quantity?: number | string
  unitPrice: number | string
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
  lineItems: LineItemInput[]
}

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()

  if (request.method === 'GET') {
    const rows = await db
      .select({
        id: schema.estimates.id,
        status: schema.estimates.status,
        notes: schema.estimates.notes,
        validUntil: schema.estimates.validUntil,
        createdAt: schema.estimates.createdAt,
        updatedAt: schema.estimates.updatedAt,
        token: schema.estimates.token,
        clientName: schema.clients.name,
        clientEmail: schema.clients.email,
      })
      .from(schema.estimates)
      .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
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
        validUntil: body.validUntil,
        status: 'draft',
      })
      .returning()

    await db.insert(schema.estimateLineItems).values(
      body.lineItems.map((item, idx) => ({
        estimateId: estimate.id,
        description: item.description,
        quantity: String(item.quantity ?? 1),
        unitPrice: String(item.unitPrice),
        sortOrder: idx,
      })),
    )

    return json({ estimate }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/admin/estimates',
}
