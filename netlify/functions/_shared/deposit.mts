/**
 * Deposit and balance on a project.
 *
 * A large construction clean means fronting a crew, chemicals and a dumpster
 * for weeks before an invoice goes out. A deposit is how a contractor stops
 * financing the client's project out of working capital, and until now the
 * system had no concept of one.
 *
 * Stored as a percent rather than an amount so it survives a scope revision.
 * A $4,000 deposit on a job that grew to $12,000 is not a deposit any more.
 */

const round2 = (n: number) => Math.round(n * 100) / 100

export interface DepositSplit {
  /** True when a deposit was actually asked for. */
  required: boolean
  pct: number
  /** Due before the crew is scheduled. */
  depositDue: number
  /** Due on completion and sign-off. */
  balanceDue: number
  total: number
}

/**
 * Split a total into deposit and balance.
 *
 * The two halves are made to sum to the total exactly: the balance is the
 * remainder rather than its own rounded percentage, so a 50% split of an odd
 * total lands on $4,251.93 and $4,251.92 rather than leaving a cent adrift.
 * That cent is the difference between an invoice that reconciles and one a
 * bookkeeper has to chase.
 */
export function depositSplit(total: number, pct: number | string | null | undefined): DepositSplit {
  const t = round2(Math.max(0, Number(total) || 0))
  const p = Number(pct)

  if (!Number.isFinite(p) || p <= 0 || t <= 0) {
    return { required: false, pct: 0, depositDue: 0, balanceDue: t, total: t }
  }

  const clamped = Math.min(p, 100)
  const depositDue = round2(t * clamped / 100)
  return {
    required: true,
    pct: clamped,
    depositDue,
    balanceDue: round2(t - depositDue),
    total: t,
  }
}
