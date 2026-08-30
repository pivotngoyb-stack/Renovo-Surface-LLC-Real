/**
 * Renovo's own particulars, in one place.
 *
 * These were previously hardcoded into estimate.html, invoice.html and
 * work-order.html separately, which meant a phone number change was a
 * three-file edit and a government identifier had nowhere to live at all.
 *
 * Government buyers screen on the registration block before they read a price.
 * A bid missing a NAICS code or a UEI is frequently non-responsive on its face,
 * so these fields are part of the document, not decoration.
 */

export interface CompanyProfile {
  legalName: string
  tradeName: string
  owner: string
  ownerTitle: string
  phone: string
  email: string
  website: string
  addressLine: string
  city: string
  state: string
  zip: string
  tagline: string
  serviceArea: string
  /** Primary NAICS. 561720 is Janitorial Services. */
  naics: string
  naicsLabel: string
  entityType: string
  stateOfFormation: string
  /** Unique Entity ID from SAM.gov. Empty until registration activates. */
  uei: string
  /** Commercial and Government Entity code. Empty until assigned. */
  cage: string
  samStatus: string
  /** Small-business / diversity certifications held. Empty array is honest. */
  certifications: string[]
}

export const COMPANY: CompanyProfile = {
  legalName: 'Renovo Surface Solutions LLC',
  tradeName: 'Renovo Surface Solutions',
  owner: 'Pivot Ngoy',
  ownerTitle: 'Founder and Owner',
  phone: '801-369-2330',
  email: 'info@renovosurface.com',
  website: 'renovosurface.com',
  addressLine: '30 N Orange Street',
  city: 'Salt Lake City',
  state: 'UT',
  zip: '84116',
  tagline: 'Restore. Renew. Maintain.',
  serviceArea: 'Utah — Wasatch Front',
  naics: '561720',
  naicsLabel: 'Janitorial Services',
  entityType: 'Limited Liability Company',
  stateOfFormation: 'Utah',
  // Left blank deliberately. Printing a placeholder UEI on a federal bid is
  // worse than printing none: it reads as either careless or false.
  uei: '',
  cage: '',
  samStatus: 'Registered — activation pending',
  certifications: [],
}

/** Single-line address for document headers. */
export function addressOneLine(c: CompanyProfile = COMPANY): string {
  return `${c.addressLine}, ${c.city}, ${c.state} ${c.zip}`
}

export interface RegistrationRow {
  label: string
  value: string
  /** False when we do not yet hold it -- shown as pending, never invented. */
  held: boolean
}

/**
 * The vendor registration block for a government bid.
 *
 * Anything not yet held is reported as pending rather than omitted. A
 * contracting officer would rather read "activation pending" than wonder why
 * a field is missing, and inventing an identifier is disqualifying.
 */
export function registrationRows(c: CompanyProfile = COMPANY): RegistrationRow[] {
  return [
    { label: 'Legal entity', value: `${c.legalName} — ${c.entityType}, ${c.stateOfFormation}`, held: true },
    { label: 'Primary NAICS', value: `${c.naics} — ${c.naicsLabel}`, held: true },
    { label: 'SAM.gov registration', value: c.uei ? 'Active' : c.samStatus, held: !!c.uei },
    { label: 'Unique Entity ID (UEI)', value: c.uei || 'Pending SAM.gov activation', held: !!c.uei },
    { label: 'CAGE code', value: c.cage || 'Pending assignment', held: !!c.cage },
    { label: 'Small business certifications', value: c.certifications.length ? c.certifications.join(', ') : 'None claimed', held: c.certifications.length > 0 },
    { label: 'Insurance', value: 'Commercial general liability in force; certificate naming the agency as additional insured available on request', held: true },
    { label: 'W-9', value: 'Available on request for vendor onboarding', held: true },
  ]
}

/**
 * Statements that only belong on a bid subject to prevailing wage.
 *
 * Davis-Bacon applies to federally funded construction; Utah has its own
 * prevailing wage rules on state work. Committing to it changes the labor
 * rate, so it is a deliberate flag on the estimate rather than a default.
 */
export const PREVAILING_WAGE_STATEMENTS: string[] = [
  'Labor for this contract is priced at the applicable prevailing wage determination. Renovo will pay all covered workers not less than the wage and fringe rates in the determination incorporated into the solicitation.',
  'Certified payroll reports will be submitted for each pay period covered by the contract, in the format the contracting agency requires.',
  'Renovo maintains the payroll records required for the retention period specified in the contract and will make them available for audit on request.',
]
