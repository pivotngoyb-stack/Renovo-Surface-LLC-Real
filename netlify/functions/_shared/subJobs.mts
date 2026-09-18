import { linesForJob } from './crewView.mts'

/**
 * What a job bills, and what the sub who did it is owed for it.
 *
 * A subcontractor agreement pays per job: a flat amount, or a percentage of
 * what the job billed. "What the job billed" has to mean the same thing on
 * this page as on the invoice, or the sub is paid on a number nobody else
 * recognises -- so it is the lines this work order actually covers (the same
 * rule the crew link plans from), before tax. Tax is the state's money, not
 * revenue a sub's share can be taken of.
 */

type Line = { quantity: string | number; unitPrice: string | number; frequency?: string | null; isOptional?: boolean | null }

const round2 = (x: number) => Math.round(x * 100) / 100
const num = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** One work order's billed value, tax excluded. */
export function jobValue(lines: Line[], kind: string): number {
  return round2(linesForJob(lines, kind).reduce((s, l) => s + num(l.quantity) * num(l.unitPrice), 0))
}

export interface PayTerms {
  paymentType: string
  paymentAmount: string | number | null
  paymentPercentage: string | number | null
}

/** What the agreement says the sub is owed for a job of this value. */
export function subOwed(terms: PayTerms, value: number): number {
  if (terms.paymentType === 'flat') return round2(Math.max(0, num(terms.paymentAmount)))
  return round2(Math.max(0, value) * Math.max(0, num(terms.paymentPercentage)) / 100)
}

/** The terms in words, as the agreement page states them. */
export function payTermsLabel(terms: PayTerms): string {
  return terms.paymentType === 'flat'
    ? `$${num(terms.paymentAmount).toFixed(2)} a job`
    : `${num(terms.paymentPercentage)}% of what the job bills`
}

/** A sub may be given work only once the agreement is signed and live. */
export function assignable(a: { status: string; archived: boolean }): boolean {
  return a.status === 'signed' && !a.archived
}
