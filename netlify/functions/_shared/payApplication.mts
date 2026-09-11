/**
 * Progress billing: getting paid monthly instead of at the end.
 *
 * A twenty-week job billed once on completion means financing the whole thing
 * out of pocket for five months while payroll runs every Friday. That is the
 * hole the cash-to-carry panel shows, and this is the way out of it: a
 * schedule of values agreed at award, then a pay application each month for
 * the work actually done.
 *
 * The arithmetic here follows AIA G702/G703 line for line, deliberately. Every
 * general contractor's accounting department reads that document, in that
 * order, and a pay application whose numbers do not reconcile the way theirs
 * do gets sent back -- which costs another month, on the one thing this whole
 * feature exists to speed up.
 *
 *   1  Original contract sum
 *   2  Net change by change orders
 *   3  Contract sum to date            (1 + 2)
 *   4  Total completed and stored to date
 *   5  Retainage
 *   6  Total earned less retainage      (4 - 5)
 *   7  Less previous certificates       (line 6 of the last one)
 *   8  Current payment due              (6 - 7)
 *   9  Balance to finish, incl retainage (3 - 6)
 */

const round2 = (n: number) => Math.round(n * 100) / 100

/** One line of the schedule of values: a slice of the contract. */
export interface SovLine {
  id: number
  description: string
  /** This line's share of the contract sum, in dollars. */
  scheduledValue: number
  /** Cumulative percent complete as of the previous application, 0-100. */
  previousPct: number
  /** Cumulative percent complete being claimed now, 0-100. */
  thisPct: number
  /**
   * Materials delivered and stored on site but not yet installed.
   *
   * Rare on cleaning work and included because the form has the column: a GC
   * whose form has a blank where their template expects a number sends the
   * whole application back.
   */
  storedMaterials?: number
}

export interface SovLineResult extends SovLine {
  /** Value of work in place at the claimed percentage. */
  completedToDate: number
  /** Earned in this period alone. */
  thisPeriod: number
  /** Completed plus stored, which is what retainage is taken on. */
  totalToDate: number
  balanceToFinish: number
}

export interface PayApplication {
  lines: SovLineResult[]
  /** Line 1. */
  originalContractSum: number
  /** Line 2. Approved change orders, net. */
  changeOrders: number
  /** Line 3. */
  contractSumToDate: number
  /** Line 4. */
  totalCompletedAndStored: number
  /** Line 5. */
  retainage: number
  retainagePct: number
  /** Line 6. */
  totalEarnedLessRetainage: number
  /** Line 7. */
  lessPreviousCertificates: number
  /** Line 8. What the GC should actually pay this month. */
  currentPaymentDue: number
  /** Line 9. */
  balanceToFinish: number
  /** Percent of the contract complete, for the cover sheet. */
  percentComplete: number
  problems: string[]
}

export interface PayApplicationInput {
  lines: SovLine[]
  originalContractSum: number
  changeOrders?: number
  retainagePct?: number
  /** Line 6 from the previous application. Zero on the first. */
  lessPreviousCertificates?: number
}

const clampPct = (n: number) => Math.min(Math.max(Number(n) || 0, 0), 100)

export function buildPayApplication(input: PayApplicationInput): PayApplication {
  const retainagePct = Math.min(Math.max(Number(input.retainagePct) || 0, 0), 50)
  const changeOrders = round2(Number(input.changeOrders) || 0)
  const originalContractSum = round2(Number(input.originalContractSum) || 0)
  const contractSumToDate = round2(originalContractSum + changeOrders)
  const problems: string[] = []

  const lines: SovLineResult[] = input.lines.map(l => {
    const scheduledValue = round2(Number(l.scheduledValue) || 0)
    const previousPct = clampPct(l.previousPct)
    const thisPct = clampPct(l.thisPct)
    const stored = round2(Math.max(0, Number(l.storedMaterials) || 0))

    const completedToDate = round2(scheduledValue * thisPct / 100)
    const totalToDate = round2(completedToDate + stored)

    return {
      ...l,
      scheduledValue,
      previousPct,
      thisPct,
      storedMaterials: stored,
      completedToDate,
      thisPeriod: round2(scheduledValue * (thisPct - previousPct) / 100),
      totalToDate,
      balanceToFinish: round2(scheduledValue - totalToDate),
    }
  })

  /*
   * The schedule of values has to add up to the contract.
   *
   * A GC's accounting department reconciles the G703 total against the
   * subcontract before anything else, and a penny out is a rejected
   * application and another month unpaid. Warned rather than blocked, because
   * an application in progress is legitimately unbalanced while it is being
   * typed -- the route refuses to submit one.
   */
  const scheduled = round2(lines.reduce((s, l) => s + l.scheduledValue, 0))
  if (lines.length && Math.abs(scheduled - contractSumToDate) > 0.005) {
    problems.push(
      `The schedule of values totals ${scheduled.toFixed(2)} against a contract sum of `
      + `${contractSumToDate.toFixed(2)}. They have to match, or the application is rejected before `
      + 'anyone looks at the percentages.',
    )
  }

  /*
   * Percentages going backwards.
   *
   * Legitimate when the GC rejects work already billed, and a mistake far more
   * often -- usually a line typed into the wrong row. Either way it produces a
   * negative amount in the period column, which is exactly the thing that gets
   * an application queried.
   */
  const reversed = lines.filter(l => l.thisPct < l.previousPct)
  if (reversed.length) {
    problems.push(
      `${reversed.length} line${reversed.length === 1 ? '' : 's'} went backwards this period `
      + `(${reversed.map(l => l.description).join('; ')}). That bills a negative amount, which is right `
      + 'only if work already billed was rejected.',
    )
  }

  const totalCompletedAndStored = round2(lines.reduce((s, l) => s + l.totalToDate, 0))
  const retainage = round2(totalCompletedAndStored * retainagePct / 100)
  const totalEarnedLessRetainage = round2(totalCompletedAndStored - retainage)
  const lessPreviousCertificates = round2(Number(input.lessPreviousCertificates) || 0)
  const currentPaymentDue = round2(totalEarnedLessRetainage - lessPreviousCertificates)

  /*
   * A negative payment due means more was certified previously than is earned
   * now -- over-billed, or a percentage pulled back. Surfaced rather than
   * clamped: sending a GC an invoice for a negative number is a conversation,
   * and quietly showing zero hides that the previous application was wrong.
   */
  if (currentPaymentDue < 0) {
    problems.push(
      `This application earns ${totalEarnedLessRetainage.toFixed(2)} against `
      + `${lessPreviousCertificates.toFixed(2)} already certified, so nothing is due and the difference `
      + 'is an over-billing to sort out before submitting.',
    )
  }

  return {
    lines,
    originalContractSum,
    changeOrders,
    contractSumToDate,
    totalCompletedAndStored,
    retainage,
    retainagePct,
    totalEarnedLessRetainage,
    lessPreviousCertificates,
    currentPaymentDue,
    balanceToFinish: round2(contractSumToDate - totalEarnedLessRetainage),
    percentComplete: contractSumToDate > 0
      ? Math.round((totalCompletedAndStored / contractSumToDate) * 1000) / 10
      : 0,
    problems,
  }
}

/**
 * A starting schedule of values from the estimate's own line items.
 *
 * Better than a blank sheet and worse than thinking about it. A GC wants a
 * breakdown they can certify progress against, which usually means phases or
 * areas rather than the way the work was priced -- but the line items at least
 * add up to the contract, which is the part that gets an application rejected.
 */
export function suggestSov(
  lineItems: Array<{ description: string; quantity: string | number; unitPrice: string | number; isOptional?: boolean | null }>,
): Array<{ description: string; scheduledValue: number }> {
  return lineItems
    .filter(li => !li.isOptional)
    .map(li => ({
      description: li.description,
      scheduledValue: round2((Number(li.quantity) || 0) * (Number(li.unitPrice) || 0)),
    }))
    .filter(l => l.scheduledValue > 0)
}

/** Retainage accrued so far, which is the money still being held back. */
export function retainageHeld(applications: Array<{ retainage: number }>): number {
  return round2(applications.reduce((s, a) => s + (Number(a.retainage) || 0), 0))
}
