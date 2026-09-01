/**
 * Change orders: the document that keeps scope growth out of a dispute.
 *
 * On any job past a couple of hours, scope moves. A floor strips down to a
 * substrate that needs a second pass; a client adds two restrooms while the
 * crew is already on site. Without a document for it there are two options and
 * both are bad -- absorb the cost, or put a line on the final invoice the
 * client never agreed to. The second is where disputes come from, and it is
 * always the line nobody can produce a signature for.
 *
 * The rules here are deliberately narrow. Everything about *presenting* a
 * change order lives in the page; this file only knows what one is worth, what
 * it may legally do next, and how it is numbered.
 */

export interface ChangeOrderLine {
  description: string
  quantity: string | number
  unitPrice: string | number
}

export type ChangeOrderStatus = 'draft' | 'sent' | 'approved' | 'declined'

/** Cents, to keep the sum off binary floating point. */
function cents(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/**
 * What the change order is worth.
 *
 * May be negative: scope shrinks too, and a change order that can only add is
 * one Renovo would quietly avoid using on exactly the jobs that need it most.
 */
export function changeOrderTotal(lines: ChangeOrderLine[]): number {
  const total = lines.reduce((sum, l) => sum + cents(l.quantity) * cents(l.unitPrice) / 100, 0)
  return Math.round(total) / 100
}

/** The next sequence number for a work order, 1-based. */
export function nextSequence(existing: { sequence: number }[]): number {
  return existing.reduce((max, c) => Math.max(max, c.sequence), 0) + 1
}

export function changeOrderNumber(workOrderId: number, sequence: number): string {
  return `CO-${workOrderId}-${sequence}`
}

/**
 * Which transitions are allowed.
 *
 * A change order that has been answered is finished. Re-sending one the client
 * already signed would put a second signature request against a record that is
 * already binding, and re-sending a declined one is how a client ends up
 * feeling pressured into an extra they turned down.
 */
export function canSend(status: ChangeOrderStatus): boolean {
  return status === 'draft'
}

export function canEdit(status: ChangeOrderStatus): boolean {
  return status === 'draft'
}

export function canRespond(status: ChangeOrderStatus): boolean {
  return status === 'sent'
}

/**
 * Only approved change orders move money.
 *
 * A sent-but-unanswered change order is a proposal. Billing one would be
 * billing for work the client has not authorised, which is the exact failure
 * the document exists to prevent.
 */
export function billable<T extends { status: string }>(changeOrders: T[]): T[] {
  return changeOrders.filter(c => c.status === 'approved')
}

/**
 * The revised contract sum: the original work order plus every approved change.
 *
 * This is the number that belongs at the top of an invoice on a job that
 * changed. A client who signed for $8,400 and then signed two change orders
 * should see how $9,750 was arrived at, not just be handed it.
 */
export function revisedTotal(originalTotal: number, approvedTotals: number[]): {
  original: number
  changes: number
  revised: number
} {
  const original = Math.round(cents(originalTotal)) / 100
  const changes = Math.round(approvedTotals.reduce((s, t) => s + cents(t), 0)) / 100
  return { original, changes, revised: Math.round(cents(original) + cents(changes)) / 100 }
}

/** Reasons offered in the builder. Free text is still allowed alongside. */
export const CHANGE_REASONS = [
  { key: 'condition_found', label: 'Condition found on site' },
  { key: 'client_request', label: 'Client requested additional work' },
  { key: 'access', label: 'Access or scheduling restriction' },
  { key: 'scope_clarification', label: 'Scope clarification' },
  { key: 'quantity_correction', label: 'Measured quantity differs from estimate' },
  { key: 'reduction', label: 'Scope removed at client request' },
] as const

export function reasonLabel(key: string | null | undefined): string | null {
  if (!key) return null
  const found = CHANGE_REASONS.find(r => r.key === key)
  return found ? found.label : key
}

/**
 * The authorisation paragraph printed above the client's signature.
 *
 * Written to be read by someone who is being asked for more money than they
 * agreed to, which is the moment this document has to be at its clearest.
 */
export function changeOrderTerms(opts: {
  number: string
  workOrderLabel: string
  total: number
  scheduleImpactDays: number
}): string {
  const money = (n: number) =>
    `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const direction = opts.total < 0 ? 'reduce' : 'increase'
  const schedule = opts.scheduleImpactDays > 0
    ? ` The completion date moves out by ${opts.scheduleImpactDays} ${opts.scheduleImpactDays === 1 ? 'day' : 'days'}.`
    : ' There is no change to the completion date.'

  return `CHANGE ORDER ${opts.number}

This change order amends ${opts.workOrderLabel}. All other terms of that work
authorization remain in force.

Signing below authorizes the work described above and will ${direction} the
contract sum by ${money(Math.abs(opts.total))}.${schedule}

Work under this change order does not begin until it is signed.`
}
