import { eq, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, badRequest } from './_shared/http.mts'

interface CreateContractBody {
  client: {
    name: string
    email: string
    phone?: string
    company?: string
    propertyAddress?: string
  }
  description: string
  amount: number | string
  billingDay: number
}

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()

  if (request.method === 'GET') {
    const rows = await db
      .select({
        id: schema.recurringContracts.id,
        description: schema.recurringContracts.description,
        amount: schema.recurringContracts.amount,
        billingDay: schema.recurringContracts.billingDay,
        status: schema.recurringContracts.status,
        lastBilledAt: schema.recurringContracts.lastBilledAt,
        createdAt: schema.recurringContracts.createdAt,
        autoChargeEnabled: schema.recurringContracts.autoChargeEnabled,
        cardBrand: schema.recurringContracts.cardBrand,
        cardLast4: schema.recurringContracts.cardLast4,
        clientId: schema.clients.id,
        clientName: schema.clients.name,
        clientEmail: schema.clients.email,
      })
      .from(schema.recurringContracts)
      .leftJoin(schema.clients, eq(schema.recurringContracts.clientId, schema.clients.id))
      .orderBy(desc(schema.recurringContracts.createdAt))

    return json({ contracts: rows })
  }

  if (request.method === 'POST') {
    let body: CreateContractBody
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    if (!body.client?.name || !body.client?.email) return badRequest('Client name and email are required')
    if (!body.description?.trim()) return badRequest('Description is required')
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) return badRequest('Amount must be a positive number')
    const billingDay = Number(body.billingDay)
    if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
      return badRequest('Billing day must be an integer between 1 and 28 (capped at 28 so it works in every month)')
    }

    const existing = await db.select().from(schema.clients).where(eq(schema.clients.email, body.client.email)).limit(1)
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

    const [contract] = await db
      .insert(schema.recurringContracts)
      .values({
        clientId,
        description: body.description.trim(),
        amount: String(amount),
        billingDay,
        status: 'active',
      })
      .returning()

    return json({ contract }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/admin/contracts',
}
