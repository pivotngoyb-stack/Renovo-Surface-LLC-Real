import { eq, desc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'

export default async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const id = Number(context.params.id)
  if (!Number.isInteger(id)) return badRequest('Invalid contract id')

  const [contract] = await db.select().from(schema.recurringContracts).where(eq(schema.recurringContracts.id, id)).limit(1)
  if (!contract) return notFound()

  const client = (await db.select().from(schema.clients).where(eq(schema.clients.id, contract.clientId)).limit(1))[0]
  const invoiceRows = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.recurringContractId, id))
    .orderBy(desc(schema.invoices.createdAt))

  const invoices = await Promise.all(
    invoiceRows.map(async (inv) => {
      const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, inv.id))
      const total = lineItems.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
      return { ...inv, total }
    }),
  )

  return json({ contract, client, invoices })
}

export const config = {
  path: '/api/admin/contracts/:id',
}
