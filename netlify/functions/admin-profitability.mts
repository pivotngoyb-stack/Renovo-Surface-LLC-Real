import { eq, inArray, sql } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { jobEconomics, type StoredLineItem, type CostConfidence } from './_shared/jobEconomics.mts'
import { contractEconomics, contractVerdict, DEFAULT_ACQUISITION } from './_shared/contractEconomics.mts'

const round2 = (x: number) => Math.round(x * 100) / 100
const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/**
 * What each sold job actually earned.
 *
 * Renovo could see a margin while writing a quote and nowhere afterwards.
 * Everything downstream -- work orders, invoices, the dashboard -- carries a
 * price and no cost, so the only question the system could answer was "how much
 * did I bill", never "which of this work was worth doing".
 *
 * Three revenue figures are reported per job rather than one, because they
 * disagree and the disagreement is the useful part:
 *
 *   quoted    what the estimate said
 *   invoiced  what was actually billed, once an invoice exists
 *   collected what the client has actually paid
 *
 * Margin is measured against quoted revenue, since that is what the cost model
 * was built against. A job billed for less than it was quoted is a scope
 * problem, and it should be visible as a gap rather than folded into a margin.
 */
export default withErrorHandling('admin-profitability', async (request: Request, _context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  /*
   * Acquisition assumptions come from the caller.
   *
   * How long a bid takes and how much slower a first visit runs are things
   * Renovo knows and this code does not. Baking in a default and never
   * exposing it would make every break-even figure a guess wearing the
   * clothes of a measurement.
   */
  const params = new URL(request.url).searchParams
  const numParam = (key: string): number | undefined => {
    const raw = params.get(key)
    if (raw == null || raw === '') return undefined
    const v = Number(raw)
    return Number.isFinite(v) && v >= 0 ? v : undefined
  }
  const acquisition = {
    bidHours: numParam('bidHours'),
    onboardingMultiplier: numParam('onboardingMultiplier'),
  }

  /* Sold work only: a draft estimate is a hope, not a job. */
  const joined = await db
    .select({
      estimateId: schema.estimates.id,
      approvedAt: schema.estimates.approvedAt,
      createdAt: schema.estimates.createdAt,
      clientId: schema.clients.id,
      clientName: schema.clients.name,
      company: schema.clients.company,
      workOrderId: schema.workOrders.id,
      workOrderStatus: schema.workOrders.status,
      completedAt: schema.workOrders.completedAt,
      actualHours: schema.workOrders.actualHours,
      actualCrewSize: schema.workOrders.actualCrewSize,
      actualMaterialsCost: schema.workOrders.actualMaterialsCost,
    })
    .from(schema.estimates)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.estimates.clientId))
    .leftJoin(schema.workOrders, eq(schema.workOrders.estimateId, schema.estimates.id))
    .where(sql`${schema.estimates.status} = 'approved' and ${schema.estimates.archived} = false`)

  /*
   * One row per estimate.
   *
   * The work-order join is one-to-many in the schema even though the code that
   * creates them allows only one. If a second ever appears -- a race between the
   * automatic creation on approval and a manual convert -- the join would return
   * the estimate twice and this report would count that client's revenue and
   * profit twice. A financial report that silently doubles a number is worse
   * than one that is missing it.
   */
  const jobs = [...new Map(joined.map(j => [j.estimateId, j])).values()]
  const duplicateEstimates = joined.length - jobs.length

  if (!jobs.length) {
    return json({ jobs: [], byService: [], byClient: [], totals: emptyTotals() })
  }

  const estimateIds = jobs.map(j => j.estimateId)

  const allLines = await db
    .select()
    .from(schema.estimateLineItems)
    .where(inArray(schema.estimateLineItems.estimateId, estimateIds))
    .orderBy(schema.estimateLineItems.sortOrder)

  const linesByEstimate = new Map<number, StoredLineItem[]>()
  allLines.forEach(li => {
    const list = linesByEstimate.get(li.estimateId) || []
    list.push(li as StoredLineItem)
    linesByEstimate.set(li.estimateId, list)
  })

  /* Invoiced and collected, per work order. */
  const workOrderIds = jobs.map(j => j.workOrderId).filter((x): x is number => x != null)

  const invoiceRows = workOrderIds.length
    ? await db
        .select({
          invoiceId: schema.invoices.id,
          workOrderId: schema.invoices.workOrderId,
          status: schema.invoices.status,
          taxAmount: schema.invoices.taxAmount,
        })
        .from(schema.invoices)
        .where(inArray(schema.invoices.workOrderId, workOrderIds))
    : []

  const invoiceIds = invoiceRows.map(r => r.invoiceId)

  const invoiceTotals = invoiceIds.length
    ? await db
        .select({
          invoiceId: schema.invoiceLineItems.invoiceId,
          total: sql<string>`sum(${schema.invoiceLineItems.quantity} * ${schema.invoiceLineItems.unitPrice})`,
        })
        .from(schema.invoiceLineItems)
        .where(inArray(schema.invoiceLineItems.invoiceId, invoiceIds))
        .groupBy(schema.invoiceLineItems.invoiceId)
    : []

  const paymentTotals = invoiceIds.length
    ? await db
        .select({
          invoiceId: schema.invoicePayments.invoiceId,
          total: sql<string>`sum(${schema.invoicePayments.amount})`,
        })
        .from(schema.invoicePayments)
        .where(inArray(schema.invoicePayments.invoiceId, invoiceIds))
        .groupBy(schema.invoicePayments.invoiceId)
    : []

  const invoicedBy = new Map(invoiceTotals.map(r => [r.invoiceId, n(r.total)]))
  const collectedBy = new Map(paymentTotals.map(r => [r.invoiceId, n(r.total)]))

  const invoiceByWorkOrder = new Map<number, { invoiced: number; collected: number; status: string }>()
  invoiceRows.forEach(r => {
    if (r.workOrderId == null) return
    const prev = invoiceByWorkOrder.get(r.workOrderId) || { invoiced: 0, collected: 0, status: r.status }
    invoiceByWorkOrder.set(r.workOrderId, {
      invoiced: round2(prev.invoiced + (invoicedBy.get(r.invoiceId) || 0) + n(r.taxAmount)),
      collected: round2(prev.collected + (collectedBy.get(r.invoiceId) || 0)),
      status: r.status,
    })
  })

  /* Per job, plus the rollups. */
  const byService = new Map<string, { serviceType: string; jobs: number; revenue: number; cost: number; profit: number; hours: number }>()
  const byClient = new Map<number, { clientId: number; clientName: string; company: string | null; jobs: number; revenue: number; cost: number; profit: number }>()

  const rows = jobs.map(j => {
    // Real logged hours beat the estimate whenever someone recorded them.
    const econ = jobEconomics(linesByEstimate.get(j.estimateId) || [], j.actualHours, j.actualMaterialsCost)
    const billing = j.workOrderId != null ? invoiceByWorkOrder.get(j.workOrderId) : undefined

    /*
     * A standing agreement is a different question from a one-off job. It
     * costs something to win before it earns anything, and only repays that
     * over a run of visits, so the number that matters is not this visit
     * margin -- it is how long the client has to stay for the contract to
     * have been worth signing.
     */
    let contractRow = null
    if (econ.isRecurring && econ.visitsPerYear > 0) {
      // Only the recurring lines. A one-off deep clean sold alongside a
      // weekly contract is not part of the per-visit economics.
      const rec = econ.lines.filter(l => l.recurring)
      const revPerVisit = round2(rec.reduce((t, l) => t + l.revenue, 0))
      const costPerVisit = round2(rec.reduce((t, l) => t + l.loadedCost, 0))
      const ce = contractEconomics(revPerVisit, costPerVisit, econ.visitsPerYear, acquisition)
      contractRow = { ...ce, verdict: contractVerdict(ce) }
    }

    econ.lines.forEach(l => {
      const key = l.serviceType || 'other'
      const acc = byService.get(key) || { serviceType: key, jobs: 0, revenue: 0, cost: 0, profit: 0, hours: 0 }
      acc.revenue = round2(acc.revenue + l.revenue)
      acc.cost = round2(acc.cost + l.loadedCost)
      acc.profit = round2(acc.profit + l.profit)
      acc.hours = round2(acc.hours + l.laborHours)
      acc.jobs += 1
      byService.set(key, acc)
    })

    if (j.clientId != null) {
      const acc = byClient.get(j.clientId)
        || { clientId: j.clientId, clientName: j.clientName || 'Unknown', company: j.company, jobs: 0, revenue: 0, cost: 0, profit: 0 }
      acc.revenue = round2(acc.revenue + econ.revenue)
      acc.cost = round2(acc.cost + econ.loadedCost)
      acc.profit = round2(acc.profit + econ.profit)
      acc.jobs += 1
      byClient.set(j.clientId, acc)
    }

    return {
      estimateId: j.estimateId,
      workOrderId: j.workOrderId,
      clientName: j.clientName,
      company: j.company,
      approvedAt: j.approvedAt || j.createdAt,
      completedAt: j.completedAt,
      workOrderStatus: j.workOrderStatus,
      invoiceStatus: billing?.status || null,
      quoted: econ.revenue,
      invoiced: billing ? billing.invoiced : null,
      collected: billing ? billing.collected : null,
      loadedCost: econ.loadedCost,
      profit: econ.profit,
      marginPct: econ.marginPct,
      laborHours: econ.laborHours,
      estimatedHours: econ.estimatedHours,
      actualHours: econ.actualHours,
      hoursVariance: econ.hoursVariance,
      estimatedMaterials: econ.estimatedMaterials,
      actualMaterials: econ.actualMaterials,
      actualCrewSize: j.actualCrewSize,
      subcontractorCost: econ.subcontractorCost,
      isRecurring: econ.isRecurring,
      annualRevenue: econ.annualRevenue,
      annualProfit: econ.annualProfit,
      annualMarginPct: econ.annualMarginPct,
      visitsPerYear: econ.visitsPerYear,
      contract: contractRow,
      confidence: econ.confidence,
      uncostedRevenue: econ.uncostedRevenue,
    }
  })

  const withMargin = <T extends { revenue: number; profit: number }>(x: T) => ({
    ...x,
    marginPct: x.revenue > 0 ? Math.round((x.profit / x.revenue) * 1000) / 10 : 0,
  })

  const totals = rows.reduce((t, r) => ({
    jobs: t.jobs + 1,
    quoted: round2(t.quoted + r.quoted),
    invoiced: round2(t.invoiced + (r.invoiced || 0)),
    collected: round2(t.collected + (r.collected || 0)),
    loadedCost: round2(t.loadedCost + r.loadedCost),
    profit: round2(t.profit + r.profit),
    laborHours: round2(t.laborHours + r.laborHours),
    uncostedRevenue: round2(t.uncostedRevenue + r.uncostedRevenue),
    marginPct: 0,
  }), emptyTotals())
  totals.marginPct = totals.quoted > 0 ? Math.round((totals.profit / totals.quoted) * 1000) / 10 : 0

  return json({
    // Non-zero means an estimate carries more than one work order, which should
    // not happen. Reported rather than hidden so it can be chased down.
    duplicateEstimates,
    // Echoed so the page can state the assumptions the numbers rest on.
    acquisitionUsed: {
      bidHours: acquisition.bidHours ?? DEFAULT_ACQUISITION.bidHours,
      onboardingMultiplier: acquisition.onboardingMultiplier ?? DEFAULT_ACQUISITION.onboardingMultiplier,
    },
    jobs: rows.sort((a, b) => a.marginPct - b.marginPct),
    byService: [...byService.values()].map(withMargin).sort((a, b) => a.marginPct - b.marginPct),
    byClient: [...byClient.values()].map(withMargin).sort((a, b) => b.revenue - a.revenue),
    totals,
  })
})

function emptyTotals() {
  return { jobs: 0, quoted: 0, invoiced: 0, collected: 0, loadedCost: 0, profit: 0, laborHours: 0, uncostedRevenue: 0, marginPct: 0 }
}

export const config = {
  path: '/api/admin/profitability',
}
