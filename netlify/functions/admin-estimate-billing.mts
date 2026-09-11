import { eq, asc, desc, and } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest, pathId } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { generateToken } from './_shared/tokens.mts'
import { buildPayApplication, suggestSov, type SovLine } from './_shared/payApplication.mts'
import { changeOrderTotal } from './_shared/changeOrders.mts'

const MAX_LABEL = 200

/**
 * Progress billing: the schedule of values, and a pay application each month.
 *
 * A twenty-week job billed once on completion means financing it for five
 * months while payroll runs every Friday -- which is the hole the cash-to-carry
 * panel shows and this is the way out of.
 *
 * Submitting raises an ordinary invoice for the net amount, so progress
 * billing rides every rail already built: the client's payment page, Stripe,
 * the reminder ladder, the PDF, the ageing report. A parallel billing system
 * would have needed all of that again and would have disagreed with the first
 * one within a month.
 */
export default withErrorHandling('admin-estimate-billing', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const estimateId = pathId(context.params.id)
  if (estimateId === null) return notFound()

  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.id, estimateId)).limit(1)
  if (!estimate) return notFound()

  const sov = () => db.select().from(schema.sovLines)
    .where(eq(schema.sovLines.estimateId, estimateId))
    .orderBy(asc(schema.sovLines.sortOrder), asc(schema.sovLines.id))

  const apps = () => db.select().from(schema.payApplications)
    .where(eq(schema.payApplications.estimateId, estimateId))
    .orderBy(asc(schema.payApplications.number))

  const lineItems = () => db.select().from(schema.estimateLineItems)
    .where(eq(schema.estimateLineItems.estimateId, estimateId))
    .orderBy(schema.estimateLineItems.sortOrder)

  /** Original contract, and what approved change orders did to it. */
  const contractSums = async () => {
    const items = await lineItems()
    const original = items
      .filter(li => !li.isOptional)
      .reduce((s, li) => s + Number(li.quantity) * Number(li.unitPrice), 0)

    /*
     * Only approved change orders move the contract. One still out with the
     * client authorises nothing, and billing against it is billing for work
     * nobody agreed to.
     */
    const workOrders = await db.select({ id: schema.workOrders.id }).from(schema.workOrders)
      .where(eq(schema.workOrders.estimateId, estimateId))
    let changeOrders = 0
    if (workOrders.length) {
      const cos = await db.select().from(schema.changeOrders)
        .where(and(eq(schema.changeOrders.status, 'approved'), eq(schema.changeOrders.archived, false)))
      for (const co of cos.filter(c => workOrders.some(w => w.id === c.workOrderId))) {
        const cols = await db.select().from(schema.changeOrderLineItems)
          .where(eq(schema.changeOrderLineItems.changeOrderId, co.id))
        changeOrders += changeOrderTotal(cols)
      }
    }
    return { original: Math.round(original * 100) / 100, changeOrders: Math.round(changeOrders * 100) / 100 }
  }

  /** The last submitted application's line 6, which the next one subtracts. */
  const previousCertificates = (list: Array<typeof schema.payApplications.$inferSelect>) => {
    const submitted = list.filter(a => a.status === 'submitted')
    if (!submitted.length) return 0
    return Number(submitted[submitted.length - 1].totalEarnedLessRetainage) || 0
  }

  /** Cumulative percent per schedule line as of the last submitted application. */
  const previousPercents = async (list: Array<typeof schema.payApplications.$inferSelect>) => {
    const submitted = list.filter(a => a.status === 'submitted')
    if (!submitted.length) return new Map<number, number>()
    const last = submitted[submitted.length - 1]
    const rows = await db.select().from(schema.payApplicationLines)
      .where(eq(schema.payApplicationLines.payApplicationId, last.id))
    return new Map(rows.map(r => [r.sovLineId, Number(r.thisPct) || 0]))
  }

  if (request.method === 'GET') {
    const [lines, list, sums] = await Promise.all([sov(), apps(), contractSums()])
    const prev = await previousPercents(list)

    const draft = list.find(a => a.status === 'draft') || null
    const draftLines = draft
      ? await db.select().from(schema.payApplicationLines)
          .where(eq(schema.payApplicationLines.payApplicationId, draft.id))
      : []
    const claimed = new Map(draftLines.map(r => [r.sovLineId, r]))

    const working: SovLine[] = lines.map(l => ({
      id: l.id,
      description: l.description,
      scheduledValue: Number(l.scheduledValue),
      previousPct: prev.get(l.id) || 0,
      thisPct: Number(claimed.get(l.id)?.thisPct ?? prev.get(l.id) ?? 0),
      storedMaterials: Number(claimed.get(l.id)?.storedMaterials || 0),
    }))

    return json({
      sov: lines,
      applications: list,
      draft,
      preview: buildPayApplication({
        lines: working,
        originalContractSum: sums.original,
        changeOrders: sums.changeOrders,
        retainagePct: draft ? Number(draft.retainagePct) : 0,
        lessPreviousCertificates: previousCertificates(list),
      }),
      contract: sums,
      // A starting schedule, offered rather than imposed.
      suggested: lines.length ? [] : suggestSov(await lineItems()),
    })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const action = body.action

  /* ---- the schedule of values ---- */

  if (action === 'seed-sov' || action === 'add-sov') {
    const existingApps = await apps()
    if (existingApps.some(a => a.status === 'submitted')) {
      return badRequest(
        'An application has already been submitted against this schedule. Changing it now would rewrite '
        + 'what was billed. Add a change order instead, which is what the contract expects anyway.',
      )
    }

    if (action === 'seed-sov') {
      if ((await sov()).length) return badRequest('This job already has a schedule of values')
      const rows = suggestSov(await lineItems()).map((l, i) => ({
        estimateId, description: l.description, scheduledValue: String(l.scheduledValue), sortOrder: i,
      }))
      if (!rows.length) return badRequest('There are no priced line items to build a schedule from')
      return json({ sov: await db.insert(schema.sovLines).values(rows).returning() }, { status: 201 })
    }

    const description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim().slice(0, MAX_LABEL) : null
    if (!description) return badRequest('Name the schedule line')
    const value = Number(body.scheduledValue)
    if (!Number.isFinite(value) || value <= 0) return badRequest('A schedule line needs a value above zero')

    const [row] = await db.insert(schema.sovLines).values({
      estimateId, description, scheduledValue: String(Math.round(value * 100) / 100),
      sortOrder: (await sov()).length,
    }).returning()
    return json({ line: row }, { status: 201 })
  }

  if (action === 'remove-sov') {
    const id = pathId(String(body.id ?? ''))
    if (id === null) return badRequest('Which line?')
    if ((await apps()).some(a => a.status === 'submitted')) {
      return badRequest('An application has been submitted against this schedule; it can no longer be changed')
    }
    const [row] = await db.select().from(schema.sovLines).where(eq(schema.sovLines.id, id)).limit(1)
    if (!row || row.estimateId !== estimateId) return notFound()
    await db.delete(schema.sovLines).where(eq(schema.sovLines.id, id))
    return json({ ok: true })
  }

  /* ---- the application ---- */

  if (action === 'save-draft') {
    const lines = await sov()
    if (!lines.length) return badRequest('Build the schedule of values first')

    const list = await apps()
    let draft = list.find(a => a.status === 'draft') || null
    const retainagePct = String(Math.min(Math.max(Number(body.retainagePct) || 0, 0), 50))
    const periodTo = typeof body.periodTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.periodTo)
      ? body.periodTo : null

    if (!draft) {
      const [created] = await db.insert(schema.payApplications).values({
        estimateId,
        number: list.length + 1,
        periodTo,
        retainagePct,
      }).returning()
      draft = created
    } else {
      await db.update(schema.payApplications).set({ periodTo, retainagePct })
        .where(eq(schema.payApplications.id, draft.id))
    }

    const claims = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : []
    await db.delete(schema.payApplicationLines)
      .where(eq(schema.payApplicationLines.payApplicationId, draft.id))

    const rows = lines.map(l => {
      const claim = claims.find(c => Number(c.sovLineId) === l.id)
      return {
        payApplicationId: draft!.id,
        sovLineId: l.id,
        thisPct: String(Math.min(Math.max(Number(claim?.thisPct) || 0, 0), 100)),
        storedMaterials: String(Math.max(0, Number(claim?.storedMaterials) || 0)),
        // Frozen with the claim, so a later schedule edit cannot rewrite it.
        description: l.description,
        scheduledValue: l.scheduledValue,
      }
    })
    if (rows.length) await db.insert(schema.payApplicationLines).values(rows)

    return json({ ok: true, id: draft.id })
  }

  if (action === 'submit') {
    const list = await apps()
    const draft = list.find(a => a.status === 'draft')
    if (!draft) return badRequest('There is no draft application to submit')

    const [lines, sums] = await Promise.all([sov(), contractSums()])
    const prev = await previousPercents(list)
    const claimed = await db.select().from(schema.payApplicationLines)
      .where(eq(schema.payApplicationLines.payApplicationId, draft.id))

    const built = buildPayApplication({
      lines: lines.map(l => ({
        id: l.id,
        description: l.description,
        scheduledValue: Number(l.scheduledValue),
        previousPct: prev.get(l.id) || 0,
        thisPct: Number(claimed.find(c => c.sovLineId === l.id)?.thisPct || 0),
        storedMaterials: Number(claimed.find(c => c.sovLineId === l.id)?.storedMaterials || 0),
      })),
      originalContractSum: sums.original,
      changeOrders: sums.changeOrders,
      retainagePct: Number(draft.retainagePct),
      lessPreviousCertificates: previousCertificates(list),
    })

    /*
     * A schedule that does not total the contract is refused here rather than
     * warned about. Every other problem this raises is a judgement call the
     * owner can make; that one is arithmetic the GC will check first, and
     * submitting it wastes a month for both of them.
     */
    const fatal = built.problems.filter(p => /schedule of values totals/.test(p))
    if (fatal.length) return badRequest(fatal.join(' '))
    if (built.currentPaymentDue <= 0) {
      return badRequest(
        `This application bills ${built.currentPaymentDue.toFixed(2)}. There is nothing to invoice -- `
        + 'move a percentage before submitting it.',
      )
    }

    const [client] = await db.select().from(schema.clients)
      .where(eq(schema.clients.id, estimate.clientId)).limit(1)
    if (!client) return badRequest('This estimate has no client to invoice')

    /*
     * One invoice per application, for the net. Everything downstream --
     * the payment page, Stripe, reminders, the ageing report -- then works
     * without knowing progress billing exists.
     */
    const [invoice] = await db.insert(schema.invoices).values({
      clientId: client.id,
      token: generateToken(),
      status: 'unpaid',
      poNumber: estimate.poNumber,
      notes: `Application for Payment No. ${draft.number}`
        + (draft.periodTo ? `, period to ${draft.periodTo}` : ''),
    }).returning()

    await db.insert(schema.invoiceLineItems).values([
      {
        invoiceId: invoice.id,
        description: `Work completed to date (${built.percentComplete}% of contract)`,
        quantity: '1',
        unitPrice: String(built.totalCompletedAndStored),
        sortOrder: 0,
      },
      {
        invoiceId: invoice.id,
        description: `Less retainage held at ${built.retainagePct}%`,
        quantity: '1',
        unitPrice: String(-built.retainage),
        sortOrder: 1,
      },
      {
        invoiceId: invoice.id,
        description: 'Less previously certified',
        quantity: '1',
        unitPrice: String(-built.lessPreviousCertificates),
        sortOrder: 2,
      },
    ])

    await db.update(schema.payApplications).set({
      status: 'submitted',
      submittedAt: new Date(),
      invoiceId: invoice.id,
      totalCompleted: String(built.totalCompletedAndStored),
      retainage: String(built.retainage),
      totalEarnedLessRetainage: String(built.totalEarnedLessRetainage),
      lessPreviousCertificates: String(built.lessPreviousCertificates),
      currentPaymentDue: String(built.currentPaymentDue),
    }).where(eq(schema.payApplications.id, draft.id))

    return json({ ok: true, application: built, invoiceId: invoice.id, invoiceToken: invoice.token }, { status: 201 })
  }

  return badRequest('Unknown action')
})

export const config = {
  path: '/api/admin/estimates/:id/billing',
}
