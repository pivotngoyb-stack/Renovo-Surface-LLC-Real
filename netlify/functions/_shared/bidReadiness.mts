/**
 * Whether this bid is actually ready to submit.
 *
 * The cheapest number does not win if the envelope is incomplete. A bid missing
 * an insurance certificate, or one that never acknowledged Addendum 2, is
 * thrown out as non-responsive before anyone reads the price -- and the bidder
 * usually finds out weeks later, if at all. That is the most galling way to
 * lose work: not being beaten, but being disqualified on paperwork that took
 * ten minutes to assemble.
 *
 * This is the checklist that gets cleared before submitting, and the reason the
 * send route refuses a bid with an unacknowledged addendum on it.
 */

/** One document a solicitation can demand alongside the price. */
export interface StandardSubmittal {
  key: string
  label: string
  /** Why it is asked for, in the words the person assembling it needs. */
  why: string
  /** Suggested as required by default on a public or institutional bid. */
  usual: boolean
}

/*
 * The standard list for a commercial cleaning or post-construction bid.
 *
 * Suggested, never imposed: the solicitation is the authority and it will ask
 * for things no library can predict. Everything here is defaulted from what a
 * public or institutional buyer asks for in practice -- a private general
 * contractor usually wants the first six and nothing else.
 */
export const STANDARD_SUBMITTALS: StandardSubmittal[] = [
  {
    key: 'bid_form',
    label: 'Signed bid or proposal form',
    why: 'The agency\'s own form, signed. A price on your letterhead instead of theirs is a common disqualification.',
    usual: true,
  },
  {
    key: 'addenda_ack',
    label: 'Acknowledgment of every addendum',
    why: 'Signed acknowledgment that you received and priced each one. The single most common reason a complete bid is thrown out.',
    usual: true,
  },
  {
    key: 'coi',
    label: 'Certificate of insurance at the required limits',
    why: 'With additional insured, waiver of subrogation and primary/non-contributory if the solicitation says so. The limits in the solicitation, not the ones on your current certificate.',
    usual: true,
  },
  {
    key: 'workers_comp',
    label: 'Workers\' compensation certificate',
    why: 'Separate from the general liability certificate, and separately demanded.',
    usual: true,
  },
  {
    key: 'w9',
    label: 'W-9',
    why: 'Vendor onboarding will not start without it, and some agencies want it in the bid envelope.',
    usual: true,
  },
  {
    key: 'license',
    label: 'Business licence',
    why: 'State registration and the municipal licence for where the work is performed.',
    usual: true,
  },
  {
    key: 'references',
    label: 'Three references on comparable work',
    why: 'Comparable in size and type. Three small offices is not a reference for a 60,000 sqft school.',
    usual: true,
  },
  {
    key: 'bid_bond',
    label: 'Bid bond',
    why: 'Usually 5-10% of the bid. Needs a surety relationship in place before the deadline, not on the day.',
    usual: false,
  },
  {
    key: 'emr',
    label: 'Experience modification rate letter',
    why: 'From your carrier. Many general contractors will not let a sub on site above 1.0.',
    usual: false,
  },
  {
    key: 'safety_program',
    label: 'Written safety program and OSHA 300 logs',
    why: 'Hazard communication, respiratory protection and fall protection at minimum, plus the injury log for the last three years.',
    usual: false,
  },
  {
    key: 'key_personnel',
    label: 'Key personnel and supervisor qualifications',
    why: 'Who runs the account, who supervises on site, and what they have done before.',
    usual: false,
  },
  {
    key: 'equipment_list',
    label: 'Equipment list',
    why: 'What you own and will put on this job. An agency comparing two bids uses it to decide whether the cheap one is real.',
    usual: false,
  },
  {
    key: 'sam_uei',
    label: 'SAM.gov registration and UEI',
    why: 'Federal and federally funded work only, and registration takes weeks. Check this the day the solicitation drops, not the week it is due.',
    usual: false,
  },
  {
    key: 'non_collusion',
    label: 'Non-collusion affidavit',
    why: 'A notarised statement that the price was reached independently. Notarising takes an afternoon nobody budgets for.',
    usual: false,
  },
  {
    key: 'e_verify',
    label: 'E-Verify affidavit',
    why: 'Utah public contracts commonly require enrolment and a signed statement of it.',
    usual: false,
  },
  {
    key: 'financials',
    label: 'Financial statement or bank reference',
    why: 'Asked for on larger contracts to show you can carry the job. Worth having ready before you need it.',
    usual: false,
  },
  {
    key: 'green_seal',
    label: 'Green Seal or product data sheets',
    why: 'Where the specification names environmental standards, or the building is chasing LEED credits.',
    usual: false,
  },
]

export const submittalByKey = new Map(STANDARD_SUBMITTALS.map(s => [s.key, s]))

/** Suggested starting checklist for a bid, given whether it is a public one. */
export function suggestedSubmittals(isGovernment: boolean): StandardSubmittal[] {
  return isGovernment ? STANDARD_SUBMITTALS.filter(s => s.usual) : STANDARD_SUBMITTALS.slice(0, 6)
}

export interface AddendumLike {
  number: string
  acknowledged: boolean
  affectsPrice: boolean
}

export interface SubmittalLike {
  label: string
  required: boolean
  provided: boolean
}

export interface ReadinessProblem {
  /** 'blocking' stops the send; 'warning' is said once and stepped over. */
  level: 'blocking' | 'warning'
  message: string
}

/**
 * What still stands between this bid and the envelope.
 *
 * The distinction that matters: an unacknowledged addendum is a fact recorded
 * in this app by the person who received it, so refusing to send on it is a
 * rail rather than a guess. A missing submittal is not -- the certificate may
 * be attached to the email already -- so it is said loudly and stepped over.
 * Blocking on something the app cannot actually know is how a safety rail
 * becomes an obstacle people learn to route around.
 */
export function bidReadiness(opts: {
  addenda: AddendumLike[]
  submittals: SubmittalLike[]
  isGovernment: boolean
  bidDueAt: Date | string | null
}): ReadinessProblem[] {
  const problems: ReadinessProblem[] = []

  const unacknowledged = opts.addenda.filter(a => !a.acknowledged)
  if (unacknowledged.length) {
    const list = unacknowledged.map(a => a.number).join(', ')
    problems.push({
      level: 'blocking',
      message: `Addend${unacknowledged.length === 1 ? 'um' : 'a'} ${list} ${unacknowledged.length === 1 ? 'has' : 'have'} not been acknowledged. `
        + 'An unacknowledged addendum is the most common reason a complete bid is thrown out, and any of them may have changed the scope you priced.',
    })
  }

  const pricing = opts.addenda.filter(a => a.affectsPrice && a.acknowledged)
  if (pricing.length) {
    problems.push({
      level: 'warning',
      message: `Addend${pricing.length === 1 ? 'um' : 'a'} ${pricing.map(a => a.number).join(', ')} `
        + `changed the scope. Check the price still reflects ${pricing.length === 1 ? 'it' : 'them'} before sending.`,
    })
  }

  const missing = opts.submittals.filter(s => s.required && !s.provided)
  if (missing.length) {
    problems.push({
      level: 'warning',
      message: `${missing.length} required submittal${missing.length === 1 ? '' : 's'} not marked ready: `
        + `${missing.map(s => s.label).join('; ')}. A bid missing one of these is thrown out before the price is read.`,
    })
  }

  if (opts.isGovernment && !opts.bidDueAt) {
    problems.push({
      level: 'warning',
      message: 'No bid deadline recorded, so this will not appear on the bid board calendar. '
        + 'The most expensive way to lose a bid is to be late with the cheapest number.',
    })
  }

  return problems
}

export const isBlocked = (problems: ReadinessProblem[]) => problems.some(p => p.level === 'blocking')
