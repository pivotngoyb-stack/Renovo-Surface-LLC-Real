import { eq, and, or, isNull, ilike, inArray, desc, sql } from 'drizzle-orm'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'
import { changeOrderRef } from './_shared/changeOrders.mts'

interface DocRow {
  type: 'estimate' | 'workOrder' | 'changeOrder' | 'invoice' | 'subcontractorAgreement' | 'contract'
  id: number
  title: string
  name: string
  status: string
  date: string
  detailUrl: string
}

const LIMIT_PER_TYPE = 30

/**
 * Escape LIKE wildcards.
 *
 * Without this a search for "100%" matches every row in the table, and a
 * search for "_" matches everything with at least one character.
 */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`
}

/**
 * A bare number in the search box means a document number.
 *
 * Renovo reads these off a printed page, where they appear as "EST-1430" or
 * "INV-1012" or just "#430". The printed number is 1000 + the row id, which is
 * the convention proposalNumber and the invoice templates already use, so both
 * forms are matched: type either and the right document comes back.
 */
function idCandidates(q: string): number[] {
  const digits = q.replace(/^[a-zA-Z]{2,4}-/, '').replace(/^#/, '').trim()
  if (!/^\d+$/.test(digits)) return []
  const n = Number(digits)
  if (!Number.isSafeInteger(n) || n <= 0) return []
  // Both the raw id and the printed number, deduped.
  return n > 1000 ? [n, n - 1000] : [n]
}

export default async (request: Request) => {
  if (!isAuthenticated(request)) return unauthorized()
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim()
  const typeFilter = url.searchParams.get('type') || ''
  const pattern = q ? likeTerm(q) : null
  const ids = q ? idCandidates(q) : []

  const results: DocRow[] = []

  if (!typeFilter || typeFilter === 'estimate') {
    const rows = await db
      .select({
        id: schema.estimates.id,
        status: schema.estimates.status,
        createdAt: schema.estimates.createdAt,
        clientName: schema.clients.name,
      })
      .from(schema.estimates)
      .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
      .where(and(
        eq(schema.estimates.archived, false),
        pattern ? or(
          ilike(schema.clients.name, pattern),
          ilike(sql`coalesce(${schema.clients.company}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.email}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.propertyAddress}, '')`, pattern),
          ilike(sql`coalesce(${schema.estimates.projectName}, '')`, pattern),
          ilike(sql`coalesce(${schema.estimates.siteAddress}, '')`, pattern),
          ilike(sql`coalesce(${schema.estimates.solicitationNumber}, '')`, pattern),
          ids.length ? inArray(schema.estimates.id, ids) : undefined,
        ) : undefined,
      ))
      .orderBy(desc(schema.estimates.createdAt))
      .limit(LIMIT_PER_TYPE)

    for (const r of rows) {
      results.push({
        type: 'estimate',
        id: r.id,
        title: `Estimate #${r.id}`,
        name: r.clientName || '—',
        status: r.status,
        date: r.createdAt.toISOString(),
        detailUrl: `/admin/estimate-detail.html?id=${r.id}`,
      })
    }
  }

  if (!typeFilter || typeFilter === 'workOrder') {
    const rows = await db
      .select({
        id: schema.workOrders.id,
        status: schema.workOrders.status,
        createdAt: schema.workOrders.createdAt,
        clientName: schema.clients.name,
      })
      .from(schema.workOrders)
      .leftJoin(schema.estimates, eq(schema.workOrders.estimateId, schema.estimates.id))
      .leftJoin(schema.clients, eq(schema.estimates.clientId, schema.clients.id))
      .where(and(
        eq(schema.estimates.archived, false),
        pattern ? or(
          ilike(schema.clients.name, pattern),
          ilike(sql`coalesce(${schema.clients.company}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.email}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.propertyAddress}, '')`, pattern),
          ilike(sql`coalesce(${schema.estimates.projectName}, '')`, pattern),
          ids.length ? inArray(schema.workOrders.id, ids) : undefined,
          ids.length ? inArray(schema.estimates.id, ids) : undefined,
        ) : undefined,
      ))
      .orderBy(desc(schema.workOrders.createdAt))
      .limit(LIMIT_PER_TYPE)

    for (const r of rows) {
      results.push({
        type: 'workOrder',
        id: r.id,
        title: `Work Order #${r.id}`,
        name: r.clientName || '—',
        status: r.status,
        date: r.createdAt.toISOString(),
        detailUrl: `/admin/work-order-detail.html?id=${r.id}`,
      })
    }
  }

  /*
   * Change orders are searchable in their own right.
   *
   * They are the document a dispute turns on -- "why is this invoice larger
   * than the job I signed for" -- and finding one meant knowing which work
   * order it hung off. Searchable by client, by project, and by the text of
   * what changed, because that last one is how anybody actually remembers it.
   */
  if (!typeFilter || typeFilter === 'changeOrder') {
    const rows = await db
      .select({
        id: schema.changeOrders.id,
        workOrderId: schema.changeOrders.workOrderId,
        recurringContractId: schema.changeOrders.recurringContractId,
        sequence: schema.changeOrders.sequence,
        status: schema.changeOrders.status,
        description: schema.changeOrders.description,
        poNumber: schema.changeOrders.poNumber,
        createdAt: schema.changeOrders.createdAt,
        clientName: schema.clients.name,
      })
      .from(schema.changeOrders)
      // Both paths: a change order amends a work order or a contract, and
      // joining only through work orders dropped every contract one from the
      // search entirely.
      .leftJoin(schema.workOrders, eq(schema.changeOrders.workOrderId, schema.workOrders.id))
      .leftJoin(schema.estimates, eq(schema.workOrders.estimateId, schema.estimates.id))
      .leftJoin(schema.recurringContracts, eq(schema.changeOrders.recurringContractId, schema.recurringContracts.id))
      .leftJoin(schema.clients, eq(
        sql`coalesce(${schema.estimates.clientId}, ${schema.recurringContracts.clientId})`,
        schema.clients.id,
      ))
      .where(and(
        // An archived estimate hides its change orders; a contract one has no
        // estimate, so the check must allow a null rather than exclude it.
        or(isNull(schema.estimates.id), eq(schema.estimates.archived, false)),
        eq(schema.changeOrders.archived, false),
        pattern ? or(
          ilike(schema.clients.name, pattern),
          ilike(sql`coalesce(${schema.clients.company}, '')`, pattern),
          ilike(sql`coalesce(${schema.estimates.projectName}, '')`, pattern),
          ilike(schema.changeOrders.description, pattern),
          ilike(sql`coalesce(${schema.changeOrders.poNumber}, '')`, pattern),
          ids.length ? inArray(schema.changeOrders.workOrderId, ids) : undefined,
        ) : undefined,
      ))
      .orderBy(desc(schema.changeOrders.createdAt))
      .limit(LIMIT_PER_TYPE)

    for (const r of rows) {
      results.push({
        type: 'changeOrder',
        id: r.id,
        title: `${changeOrderRef(r)} - ${r.description.split('\n')[0].slice(0, 60)}`,
        name: r.clientName || '—',
        status: r.status,
        date: r.createdAt.toISOString(),
        // The change order lives on its work order, which is where it can be
        // sent, deleted, or seen next to the rest of the job.
        // A contract change order lives on its contract, which is where it can
        // be sent, deleted, or read next to the rest of the agreement.
        detailUrl: r.recurringContractId != null
          ? `/admin/contract-detail.html?id=${r.recurringContractId}`
          : `/admin/work-order-detail.html?id=${r.workOrderId}`,
      })
    }
  }

  if (!typeFilter || typeFilter === 'invoice') {
    const rows = await db
      .select({
        id: schema.invoices.id,
        status: schema.invoices.status,
        createdAt: schema.invoices.createdAt,
        clientName: schema.clients.name,
      })
      .from(schema.invoices)
      .leftJoin(schema.clients, eq(schema.invoices.clientId, schema.clients.id))
      .where(and(
        eq(schema.invoices.archived, false),
        pattern ? or(
          ilike(schema.clients.name, pattern),
          ilike(sql`coalesce(${schema.clients.company}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.email}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.propertyAddress}, '')`, pattern),
          ids.length ? inArray(schema.invoices.id, ids) : undefined,
        ) : undefined,
      ))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(LIMIT_PER_TYPE)

    for (const r of rows) {
      results.push({
        type: 'invoice',
        id: r.id,
        title: `INV-${1000 + r.id}`,
        name: r.clientName || '—',
        status: r.status,
        date: r.createdAt.toISOString(),
        detailUrl: `/admin/invoice-detail.html?id=${r.id}`,
      })
    }
  }

  if (!typeFilter || typeFilter === 'subcontractorAgreement') {
    const rows = await db
      .select()
      .from(schema.subcontractorAgreements)
      .where(and(
        eq(schema.subcontractorAgreements.archived, false),
        pattern ? or(
          ilike(schema.subcontractorAgreements.subcontractorName, pattern),
          ilike(sql`coalesce(${schema.subcontractorAgreements.subcontractorEmail}, '')`, pattern),
          ilike(schema.subcontractorAgreements.subcontractorPhone, pattern),
          ids.length ? inArray(schema.subcontractorAgreements.id, ids) : undefined,
        ) : undefined,
      ))
      .orderBy(desc(schema.subcontractorAgreements.createdAt))
      .limit(LIMIT_PER_TYPE)

    for (const r of rows) {
      results.push({
        type: 'subcontractorAgreement',
        id: r.id,
        title: 'Subcontractor Agreement',
        name: r.subcontractorName,
        status: r.status,
        date: r.createdAt.toISOString(),
        detailUrl: `/admin/subcontractor-detail.html?id=${r.id}`,
      })
    }
  }

  if (!typeFilter || typeFilter === 'contract') {
    const rows = await db
      .select({
        id: schema.recurringContracts.id,
        status: schema.recurringContracts.status,
        createdAt: schema.recurringContracts.createdAt,
        description: schema.recurringContracts.description,
        clientName: schema.clients.name,
      })
      .from(schema.recurringContracts)
      .leftJoin(schema.clients, eq(schema.recurringContracts.clientId, schema.clients.id))
      .where(and(
        eq(schema.recurringContracts.archived, false),
        pattern ? or(
          ilike(schema.clients.name, pattern),
          ilike(sql`coalesce(${schema.clients.company}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.email}, '')`, pattern),
          ilike(sql`coalesce(${schema.clients.propertyAddress}, '')`, pattern),
          ids.length ? inArray(schema.recurringContracts.id, ids) : undefined,
        ) : undefined,
      ))
      .orderBy(desc(schema.recurringContracts.createdAt))
      .limit(LIMIT_PER_TYPE)

    for (const r of rows) {
      results.push({
        type: 'contract',
        id: r.id,
        title: r.description,
        name: r.clientName || '—',
        status: r.status,
        date: r.createdAt.toISOString(),
        detailUrl: `/admin/contract-detail.html?id=${r.id}`,
      })
    }
  }

  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return json({ documents: results })
}

export const config = {
  path: '/api/admin/documents',
}
