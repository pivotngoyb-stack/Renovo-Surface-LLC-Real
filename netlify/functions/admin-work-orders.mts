import { eq, desc, and } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const params = new URL(request.url).searchParams
  const statusFilter = params.get('status')

  const conditions = [eq(schema.estimates.archived, false)]
  if (statusFilter === 'pending' || statusFilter === 'signed' || statusFilter === 'completed') {
    conditions.push(eq(schema.workOrders.status, statusFilter))
  }

  /*
   * Authorizations only unless visits are asked for.
   *
   * A weekly contract generates fifty-two visits a year. Listed alongside the
   * one-off jobs they bury them, and this page is where Renovo looks to see
   * what has been sold and what is waiting on a signature. Visits are dispatch:
   * they belong on the schedule and on their contract.
   */
  const kindFilter = params.get('kind')
  if (kindFilter === 'visit' || kindFilter === 'authorization') {
    conditions.push(eq(schema.workOrders.kind, kindFilter))
  } else if (kindFilter !== 'all') {
    conditions.push(eq(schema.workOrders.kind, 'authorization'))
  }

  const rows = await db
    .select({
      id: schema.workOrders.id,
      estimateId: schema.workOrders.estimateId,
      token: schema.workOrders.token,
      status: schema.workOrders.status,
      kind: schema.workOrders.kind,
      visitSequence: schema.workOrders.visitSequence,
      recurringContractId: schema.workOrders.recurringContractId,
      scheduledDate: schema.workOrders.scheduledDate,
      scheduledStart: schema.workOrders.scheduledStart,
      completedAt: schema.workOrders.completedAt,
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
