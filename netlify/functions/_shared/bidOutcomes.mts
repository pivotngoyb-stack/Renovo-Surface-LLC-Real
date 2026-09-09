/**
 * What the bid record is telling you about your pricing.
 *
 * Every bid was priced from the same assumptions as the last one, whether the
 * last one won or lost by forty percent, because nothing recorded which. This
 * is the feedback loop: win rate, and how far off the number was when it lost.
 *
 * The two failure modes are opposite and both expensive, which is why a raw
 * win rate on its own is a trap:
 *
 *   Winning almost everything is not good news. It means the number is under
 *   the market and the work is being bought rather than sold -- every job
 *   delivered at a margin somebody else would not have accepted.
 *
 *   Winning almost nothing means the number is over the market, or the wrong
 *   work is being chased, and every bid costs two days that produced nothing.
 *
 * Commercial cleaning and post-construction bids land somewhere around a
 * quarter to a third for a shop that is qualifying its work. Those bounds are
 * a prompt to look, never a target to hit: the honest read of a 100% win rate
 * is "check whether you are cheap", not "you are cheap".
 */

/** Below this, the number is probably over the market or the work is wrong. */
export const WIN_RATE_LOW = 0.15
/** Above this, the number is probably under it. */
export const WIN_RATE_HIGH = 0.5
/** Nothing is said about a win rate until there are enough bids to mean anything. */
export const MIN_BIDS_FOR_A_VERDICT = 8

export type Outcome = 'won' | 'lost' | 'no_bid' | 'withdrawn'

export interface BidRecord {
  id: number
  outcome: Outcome | null
  /** What Renovo bid, in dollars. */
  amount: number
  /** What it lost to, when that was ever found out. */
  lostToAmount?: number | null
  serviceLabel?: string | null
}

export interface OutcomeSummary {
  /** Bids that were actually decided: won or lost. Nothing else is a contest. */
  decided: number
  won: number
  lost: number
  noBid: number
  withdrawn: number
  /** Still out, or never recorded either way. */
  pending: number
  winRate: number | null
  wonValue: number
  lostValue: number
  /**
   * Median percentage above the winner, across losses where the winning
   * number is known. Median rather than mean: one outlier bid against a
   * competitor who priced it wrong would otherwise swamp a year of data.
   */
  medianLossGapPct: number | null
  /** Losses where the winning number was actually recorded. */
  gapSample: number
  /** Plain-language reading, or null when there is not enough to say. */
  verdict: string | null
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function summariseOutcomes(bids: BidRecord[]): OutcomeSummary {
  const won = bids.filter(b => b.outcome === 'won')
  const lost = bids.filter(b => b.outcome === 'lost')
  const noBid = bids.filter(b => b.outcome === 'no_bid').length
  const withdrawn = bids.filter(b => b.outcome === 'withdrawn').length
  const pending = bids.filter(b => !b.outcome).length

  const decided = won.length + lost.length
  const winRate = decided > 0 ? won.length / decided : null

  /*
   * Only losses where the winner's number is known, and only where both
   * figures are real. A "gap" computed against a missing or zero competitor
   * price is not a gap, it is a divide-by-zero wearing a percentage sign.
   */
  const gaps = lost
    .filter(b => Number(b.lostToAmount) > 0 && b.amount > 0)
    .map(b => ((b.amount - Number(b.lostToAmount)) / Number(b.lostToAmount)) * 100)

  const summary: OutcomeSummary = {
    decided,
    won: won.length,
    lost: lost.length,
    noBid,
    withdrawn,
    pending,
    winRate: winRate === null ? null : round1(winRate * 100) / 100,
    wonValue: Math.round(won.reduce((s, b) => s + b.amount, 0) * 100) / 100,
    lostValue: Math.round(lost.reduce((s, b) => s + b.amount, 0) * 100) / 100,
    medianLossGapPct: gaps.length ? round1(median(gaps)!) : null,
    gapSample: gaps.length,
    verdict: null,
  }

  summary.verdict = readOutcomes(summary)
  return summary
}

/**
 * The sentence a person should read, or nothing.
 *
 * Deliberately silent under a handful of bids. A dashboard that announces
 * "you win 100% of your bids" after two of them teaches the owner to ignore
 * the panel, and by the time the number means something nobody is looking.
 */
export function readOutcomes(s: OutcomeSummary): string | null {
  if (s.decided < MIN_BIDS_FOR_A_VERDICT) {
    const need = MIN_BIDS_FOR_A_VERDICT - s.decided
    return s.decided === 0
      ? null
      : `Too early to read anything into this. ${need} more decided bid${need === 1 ? '' : 's'} and it starts to mean something.`
  }

  const rate = s.winRate ?? 0
  const gap = s.medianLossGapPct

  if (rate > WIN_RATE_HIGH) {
    return `Winning ${Math.round(rate * 100)}% of decided bids. That is high enough to be worth checking `
      + 'whether the number is under the market -- the work is being bought rather than sold, and the '
      + 'margin on every one of those jobs is the margin nobody else would take.'
  }

  if (rate < WIN_RATE_LOW) {
    return gap != null && gap > 0
      ? `Winning ${Math.round(rate * 100)}% of decided bids, and the losses run about ${gap}% over the winner. `
        + 'That is a pricing gap, not bad luck. Look at the assumptions before bidding the next one.'
      : `Winning ${Math.round(rate * 100)}% of decided bids. Either the number is over the market or the `
        + 'wrong work is being chased -- and each of those bids cost two days.'
  }

  if (gap != null && gap > 20) {
    return `Win rate is healthy at ${Math.round(rate * 100)}%, but the losses run about ${gap}% over the winner. `
      + 'That is a wide miss on the ones that got away -- worth knowing whether they were a different kind of job.'
  }

  return `Winning ${Math.round(rate * 100)}% of decided bids`
    + (gap != null ? `, losing by about ${gap}%` : '')
    + '. That is a working bid desk.'
}
