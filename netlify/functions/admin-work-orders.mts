import { eq, desc, and } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const statusFilter = new URL(request.url).searchParams.get('status')

  const conditions = [eq(schema.estimates.archived, false)]
  if (statusFilter === 'pending' || statusFilter === 'signed') {
    conditions.push(eq(schema.workOrders.status, statusFilter))
  }

  const rows = await db
    .select({
      id: schema.workOrders.id,
      estimateId: schema.workOrders.estimateId,
      token: schema.workOrders.token,
      status: schema.workOrders.status,
      createdAt: schema.workOrders.createdAt,
      clientId: schema.clients.id,
      clientName: schema.clients.name,
      clientEmail: schema.clients.email,
      signerName: schema.signatures.signerName,
      signedAt: schema.signatures.signedAt,
    })
    .from(schema.workOrders)
    .leftJoin(schema.estimates, eq(schema.workOrders.estimateId, schema.estimates.id))
    .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
    .leftJoin(schema.signatures, eq(schema.signatures.workOrderId, schema.workOrders.id))
    .where(and(...conditions))
    .orderBy(desc(schema.workOrders.createdAt))

  return json({ workOrders: rows })
}

export const config = {
  path: '/api/admin/work-orders',
}
