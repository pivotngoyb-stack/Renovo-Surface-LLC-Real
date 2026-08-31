import { eq, desc } from 'drizzle-orm'
import { depositSplit } from './_shared/deposit.mts'
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
  /** 'deposit' or 'balance' on a project that carries a deposit; 'full' otherwise. */
  kind?: 'full' | 'deposit' | 'balance'
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
        taxApplied: schema.invoices.taxApplied,
        taxAmount: schema.invoices.taxAmount,
        clientId: schema.clients.id,
        clientName: schema.clients.name,
        clientEmail: schema.clients.email,
      })
      .from(schema.invoices)
      .leftJoin(schema.clients, eq(schema.invoices.clientId, schema.clients.id))
      .where(eq(schema.invoices.archived, showArchived))
      .orderBy(desc(schema.invoices.createdAt))

    const allLineItems = await db.select().from(schema.invoiceLineItems)
    const allPayments = await db.select().from(schema.invoicePayments)
    const invoices = invoiceRows.map((inv) => {
      const items = allLineItems.filter((li) => li.invoiceId === inv.id)
      const total = computeTotal(items) + Number(inv.taxAmount || 0)
      const ledgerSum = allPayments.filter((p) => p.invoiceId === inv.id).reduce((sum, p) => sum + Number(p.amount), 0)
      // Invoices paid before the ledger existed have no ledger rows -- fall back to total.
      const amountPaid = ledgerSum > 0 ? ledgerSum : inv.status === 'paid' ? total : 0
      const balanceDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100)
      return { ...inv, total, amountPaid, balanceDue }
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
    let taxApplied = false
    let taxAmount = '0'
    // Which half of a split project this invoice is, or 'full' for everything else.
    let kind: 'full' | 'deposit' | 'balance' = 'full'

    if (body.workOrderId) {
      const [workOrder] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, body.workOrderId)).limit(1)
      if (!workOrder) return notFound()
      if (workOrder.status !== 'signed') return badRequest('Work order must be signed before invoicing')

      const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, workOrder.estimateId)).limit(1)
      if (!estimate) return notFound()

      const estimateItems = await db
        .select()
        .from(schema.estimateLineItems)
        .where(eq(schema.estimateLineItems.estimateId, estimate.id))
        .orderBy(schema.estimateLineItems.sortOrder)

      const billable = estimateItems.filter(li => !li.isOptional)
      const itemsTotal = billable.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
      const split = depositSplit(
        itemsTotal + (estimate.taxApplied ? Number(estimate.taxAmount) : 0),
        estimate.depositPct,
      )

      /*
       * A project with a deposit bills twice, so the old one-invoice-per-work-order
       * rule has to become one-of-each. Without a deposit nothing changes: a single
       * full invoice, and a second attempt is still refused.
       */
      const priorInvoices = await db
        .select({ id: schema.invoices.id, kind: schema.invoices.kind })
        .from(schema.invoices)
        .where(eq(schema.invoices.workOrderId, workOrder.id))

      // Check what was asked for before defaulting it, or the guard below can
      // never fire: forcing kind to 'full' first would make the test vacuous.
      if (!split.required && body.kind && body.kind !== 'full') {
        return badRequest('This project was not quoted with a deposit, so there is nothing to split. Create a single invoice instead.')
      }
      kind = split.required ? (body.kind || 'deposit') : 'full'
      if (priorInvoices.some(i => i.kind === kind)) {
        return badRequest(
          kind === 'full'
            ? 'An invoice already exists for this work order'
            : `The ${kind} invoice for this work order has already been created`,
        )
      }
      if (kind === 'balance' && !priorInvoices.some(i => i.kind === 'deposit')) {
        return badRequest('Create the deposit invoice first, so the two together add up to the project total')
      }

      clientId = estimate.clientId
      workOrderId = workOrder.id

      if (kind === 'full') {
        taxApplied = estimate.taxApplied
        taxAmount = estimate.taxAmount
        lineItems = billable.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice }))
      } else {
        // The deposit is a percentage of the total INCLUDING tax, the way the
        // proposal states it, so these two invoices carry no separate tax line.
        // Adding one would tax the tax.
        taxApplied = false
        taxAmount = '0'
        const project = estimate.projectName || 'this project'
        lineItems = [
          kind === 'deposit'
            ? {
                description: `Deposit - ${split.pct}% of the project total for ${project}, due to schedule and hold the crew`,
                quantity: 1,
                unitPrice: split.depositDue,
              }
            : {
                description: `Balance due on completion - ${project}, less the ${split.pct}% deposit already invoiced`,
                quantity: 1,
                unitPrice: split.balanceDue,
              },
        ]
      }
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
        taxApplied,
        taxAmount,
        kind,
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
