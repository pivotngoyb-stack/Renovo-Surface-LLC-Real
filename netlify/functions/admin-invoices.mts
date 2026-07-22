import { eq, desc } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { generateToken } from './_shared/tokens.mts'
import { computeTotal } from './_shared/money.mts'
import { json, unauthorized, badRequest, notFound } from './_shared/http.mts'

interface LineItemInput {
  description: string
  quantity?: number | string
  unitPrice: number | string
}

interface CreateInvoiceBody {
  workOrderId?: number
  client?: {
    name: string
    email: string
    phone?: string
    company?: string
    propertyAddress?: string
  }
  notes?: string
  dueDate?: string
  lineItems?: LineItemInput[]
}

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()

  if (request.method === 'GET') {
    const showArchived = new URL(request.url).searchParams.get('archived') === '1'

    const invoiceRows = await db
      .select({
        id: schema.invoices.id,
        status: schema.invoices.status,
        dueDate: schema.invoices.dueDate,
        createdAt: schema.invoices.createdAt,
        paidAt: schema.invoices.paidAt,
        token: schema.invoices.token,
        archived: schema.invoices.archived,
        clientId: schema.clients.id,
        clientName: schema.clients.name,
        clientEmail: schema.clients.email,
      })
      .from(schema.invoices)
      .leftJoin(schema.clients, eq(schema.invoices.clientId, schema.clients.id))
      .where(eq(schema.invoices.archived, showArchived))
      .orderBy(desc(schema.invoices.createdAt))

    const allLineItems = await db.select().from(schema.invoiceLineItems)
    const invoices = invoiceRows.map((inv) => {
      const items = allLineItems.filter((li) => li.invoiceId === inv.id)
      return { ...inv, total: computeTotal(items) }
    })

    return json({ invoices })
  }

  if (request.method === 'POST') {
    let body: CreateInvoiceBody
    try {
      body = await request.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    let clientId: number
    let lineItems: LineItemInput[]
    let workOrderId: number | undefined

    if (body.workOrderId) {
      const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, body.workOrderId)).limit(1)
      if (!workOrder) return notFound()
      if (workOrder.status !== 'signed') return badRequest('Work order must be signed before invoicing')

      const [existingInvoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.workOrderId, workOrder.id)).limit(1)
      if (existingInvoice) return badRequest('An invoice already exists for this work order')

      const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, workOrder.estimateId)).limit(1)
      if (!estimate) return notFound()
      clientId = estimate.clientId
      workOrderId = workOrder.id

      const estimateItems = await db
        .select()
        .from(schema.estimateLineItems)
        .where(eq(schema.estimateLineItems.estimateId, estimate.id))
        .orderBy(schema.estimateLineItems.sortOrder)
      lineItems = estimateItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice }))
    } else {
      if (!body.client?.name || !body.client?.email) return badRequest('Client name and email are required')
      if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) return badRequest('At least one line item is required')

      const existing = await db.select().from(schema.clients).where(eq(schema.clients.email, body.client.email)).limit(1)
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
      lineItems = body.lineItems
    }

    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        clientId,
        workOrderId,
        token: generateToken(),
        notes: body.notes,
        dueDate: body.dueDate,
        status: 'unpaid',
      })
      .returning()

    await db.insert(schema.invoiceLineItems).values(
      lineItems.map((item, idx) => ({
        invoiceId: invoice.id,
        description: item.description,
        quantity: String(item.quantity ?? 1),
        unitPrice: String(item.unitPrice),
        sortOrder: idx,
      })),
    )

    return json({ invoice }, { status: 201 })
  }

  return json({ error: 'Method not allowed' }, { status: 405 })
}

export const config = {
  path: '/api/admin/invoices',
}
