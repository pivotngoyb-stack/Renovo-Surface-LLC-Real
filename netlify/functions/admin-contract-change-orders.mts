import { eq, desc } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { json, unauthorized, notFound, badRequest } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { generateToken } from './_shared/tokens.mts'
import { frequencyOf } from './_shared/serviceSchedule.mts'
import {
  changeOrderTotal, nextSequence, changeOrderRef, contractChangeEffect,
} from './_shared/changeOrders.mts'

interface IncomingLine {
  description?: unknown
  quantity?: unknown
  unitPrice?: unknown
}

/**
 * Change orders against a standing contract.
 *
 * A one-off job is amended through its work order. A contract has no work order
 * to hang off -- adding a floor to a weekly route changes the agreement itself,
 * and the visits underneath it are dispatch rather than the thing being
 * renegotiated. Without this the only way to reprice a contract was to edit the
 * amount by hand, with nothing recording what the client agreed to. That is the
 * same dispute the job change order exists to prevent, on the recurring side.
 *
 * Lines are priced per visit, the way the estimate prices recurring work. The
 * monthly figure is derived from the contract's service frequency and stored on
 * the change order, so the number the client signs is the number that takes
 * effect even if the contract moves in between.
 */
export default withErrorHandling('admin-contract-change-orders', async (request: Request, context: Context) => {
  if (!isAuthenticated(request)) return unauthorized()

  const contractId = Number(context.params.id)
  if (!Number.isInteger(contractId)) return badRequest('Invalid contract id')

  const [contract] = await db
    .select()
    .from(schema.recurringContracts)
    .where(eq(schema.recurringContracts.id, contractId))
    .limit(1)
  if (!contract) return notFound()

  const freq = frequencyOf(contract.visitFrequency)

  if (request.method === 'GET') {
    const rows = await db
      .select()
      .from(schema.changeOrders)
      .where(eq(schema.changeOrders.recurringContractId, contractId))
      .orderBy(desc(schema.changeOrders.sequence))

    const changeOrders = await Promise.all(rows.map(async (co) => {
      const lines = await db
        .select()
        .from(schema.changeOrderLineItems)
        .where(eq(schema.changeOrderLineItems.changeOrderId, co.id))
        .orderBy(schema.changeOrderLineItems.sortOrder)
      return {
        ...co,
        lineItems: lines,
        total: changeOrderTotal(lines),
        number: changeOrderRef({ recurringContractId: contractId, sequence: co.sequence }),
      }
    }))

    return json({
      changeOrders,
      contract,
      frequency: freq,
      currentMonthly: Number(contract.amount),
    })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  /*
   * A contract with no recurring frequency has no monthly rate to change. The
   * per-visit price could not be turned into a monthly one, so the document
   * would state a change of $0 and then take effect as nothing.
   */
  if (!freq.recurring || freq.visitsPerYear <= 0) {
    return badRequest('This contract has no service frequency set, so there is no monthly rate to change. Set one first.')
  }
  if (contract.status === 'cancelled') {
    return badRequest('This contract is cancelled. Reactivate it before changing what it charges.')
  }

  let body: {
    description?: unknown
    reason?: unknown
    poNumber?: unknown
    lineItems?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request body')
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return badRequest('Describe what is changing about the service')

  const rawLines = Array.isArray(body.lineItems) ? (body.lineItems as IncomingLine[]) : []
  const lines = rawLines
    .map(l => ({
      description: typeof l.description === 'string' ? l.description.trim() : '',
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
    }))
    .filter(l => l.description && Number.isFinite(l.quantity) && Number.isFinite(l.unitPrice))

  if (!lines.length) return badRequest('Add at least one line describing the change, priced per visit')

  const perVisit = changeOrderTotal(lines)
  if (perVisit === 0) {
    return badRequest('This change comes to $0 per visit. Adjust the lines, or note it on the contract instead.')
  }

  const effect = contractChangeEffect(perVisit, freq.visitsPerYear, Number(contract.amount))

  const existing = await db
    .select({ sequence: schema.changeOrders.sequence })
    .from(schema.changeOrders)
    .where(eq(schema.changeOrders.recurringContractId, contractId))

  const [created] = await db
    .insert(schema.changeOrders)
    .values({
      recurringContractId: contractId,
      sequence: nextSequence(existing),
      token: generateToken(),
      status: 'draft',
      description: description.slice(0, 2000),
      reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 200) : null,
      poNumber: typeof body.poNumber === 'string' && body.poNumber.trim() ? body.poNumber.trim().slice(0, 60) : null,
      // Nothing to slip: a rate change has no completion date to move.
      scheduleImpactDays: 0,
      newMonthlyAmount: String(effect.newMonthly),
    })
    .returning()

  await db.insert(schema.changeOrderLineItems).values(
    lines.map((l, i) => ({
      changeOrderId: created.id,
      description: l.description.slice(0, 500),
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      sortOrder: i,
    })),
  )

  return json(
    {
      changeOrder: {
        ...created,
        number: changeOrderRef({ recurringContractId: contractId, sequence: created.sequence }),
        total: perVisit,
      },
      effect,
    },
    { status: 201 },
  )
})

export const config = {
  path: '/api/admin/contracts/:id/change-orders',
}
