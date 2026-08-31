import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

/**
 * The proposal as a PDF.
 *
 * The web proposal already prints, and browser print-to-PDF is fine for a
 * client who just wants a copy. It is not fine for a procurement portal, which
 * wants a file uploaded, or for a contracting officer who forwards attachments
 * rather than links. A bid that cannot be submitted in the form the buyer asks
 * for is non-responsive regardless of what it says.
 *
 * Content comes from the same shared helpers the HTML proposal uses --
 * buildProposalScope, contractValue, executiveSummary. Only the rendering is
 * duplicated. Rebuilding the content here is how the two documents would come
 * to say different things about the same job.
 */

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const BOTTOM = 64

const NAVY = rgb(0.051, 0.122, 0.22)
const GRAY = rgb(0.29, 0.35, 0.45)
const LIGHT = rgb(0.54, 0.6, 0.68)
const LINE = rgb(0.87, 0.9, 0.95)
const RULE = rgb(0.79, 0.84, 0.9)

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'

let cachedLogo: ArrayBuffer | null = null
async function logoBytes(): Promise<ArrayBuffer | null> {
  if (cachedLogo) return cachedLogo
  try {
    const res = await fetch(`${SITE_URL}/images/logo.png`)
    if (!res.ok) return null
    cachedLogo = await res.arrayBuffer()
    return cachedLogo
  } catch {
    return null
  }
}

const money = (n: number) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * A cursor that knows when to break the page.
 *
 * pdf-lib draws at absolute coordinates and has no notion of flow, so a
 * document with variable-length scope lists needs this or it silently writes
 * text off the bottom edge -- which looks fine in code and loses a paragraph in
 * the file a client opens.
 */
class Layout {
  page: PDFPage
  y: number
  private pageNo = 1

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footerText: string,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
    this.footer()
  }

  private footer() {
    this.page.drawText(this.footerText, {
      x: MARGIN, y: 36, size: 7.5, font: this.font, color: LIGHT,
    })
    const label = `Page ${this.pageNo}`
    this.page.drawText(label, {
      x: PAGE_WIDTH - MARGIN - this.font.widthOfTextAtSize(label, 7.5),
      y: 36, size: 7.5, font: this.font, color: LIGHT,
    })
  }

  /** Start a new sheet. */
  break() {
    this.pageNo += 1
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
    this.footer()
  }

  /** Break if the next block will not fit whole. */
  need(height: number) {
    if (this.y - height < BOTTOM) this.break()
  }

  gap(h: number) {
    this.y -= h
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: typeof NAVY; indent?: number; leading?: number } = {}) {
    const size = opts.size ?? 9.5
    const font = opts.bold ? this.bold : this.font
    const indent = opts.indent ?? 0
    const leading = opts.leading ?? size * 1.45
    for (const line of wrap(s, font, size, CONTENT_WIDTH - indent)) {
      this.need(leading)
      this.page.drawText(line, {
        x: MARGIN + indent, y: this.y - size, size, font, color: opts.color ?? GRAY,
      })
      this.y -= leading
    }
  }

  heading(num: string, title: string) {
    // Keep the heading with at least the first line under it.
    this.need(42)
    this.gap(10)
    this.page.drawText(num, { x: MARGIN, y: this.y - 11, size: 11, font: this.bold, color: LIGHT })
    this.page.drawText(title, {
      x: MARGIN + this.bold.widthOfTextAtSize(num, 11) + 8,
      y: this.y - 11, size: 11, font: this.bold, color: NAVY,
    })
    this.y -= 17
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 1, color: RULE,
    })
    this.y -= 11
  }

  bullet(s: string, marker = '•') {
    const size = 9
    const indent = 14
    const lines = wrap(s, this.font, size, CONTENT_WIDTH - indent)
    this.need(lines.length * size * 1.4)
    lines.forEach((line, i) => {
      if (i === 0) {
        this.page.drawText(marker, { x: MARGIN + 2, y: this.y - size, size, font: this.font, color: LIGHT })
      }
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font: this.font, color: GRAY })
      this.y -= size * 1.4
    })
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  // pdf-lib's standard fonts are WinAnsi and throw on characters outside it,
  // which an em dash or a curly quote in scope text will happily provide.
  const safe = String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E]/g, '')

  const out: string[] = []
  for (const para of safe.split('\n')) {
    let current = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
        out.push(current)
        current = word
      } else {
        current = trial
      }
    }
    out.push(current)
  }
  return out.length ? out : ['']
}

export interface ProposalPdfArgs {
  proposalNumber: string
  issuedDate: string
  expiresDate: string
  walkthroughDate?: string | null
  solicitationNumber?: string | null
  company: {
    legalName: string; owner: string; ownerTitle: string; phone: string; email: string
    website: string; addressLine: string; city: string; state: string; zip: string
    tagline: string; naics: string; naicsLabel: string; entityType: string; stateOfFormation: string
  }
  client: { name: string; company?: string | null; email: string; phone?: string | null; propertyAddress?: string | null } | null
  projectName: string
  siteAddress: string
  summary: string[]
  scope: {
    sections: Array<{ label: string; scope: string[] }>
    exclusions: string[]
    assumptions: string[]
    compliance: string[]
  }
  siteConditions?: string | null
  lineItems: Array<{ description: string; quantity: string | number; unit?: string | null; unitPrice: string | number; isOptional?: boolean | null }>
  subtotal: number
  taxApplied: boolean
  taxAmount: number
  total: number
  optionalTotal: number
  contract?: { hasRecurring: boolean; monthlyAverage: number; annualRecurring: number; oneTimeTotal: number; firstYearTotal: number } | null
  notes?: string | null
}

export async function generateProposalPdf(a: ProposalPdfArgs): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  doc.setTitle(`${a.proposalNumber} - ${a.projectName}`)
  doc.setAuthor(a.company.legalName)
  doc.setSubject('Commercial cleaning services proposal')
  doc.setProducer(a.company.legalName)

  const footerText = `${a.company.legalName}  |  ${a.proposalNumber}  |  ${a.company.phone}`

  /* ---------- cover ---------- */
  const cover = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let cy = PAGE_HEIGHT - MARGIN

  const logo = await logoBytes()
  if (logo) {
    try {
      const img = await doc.embedPng(logo)
      const w = 46
      const h = (img.height / img.width) * w
      cover.drawImage(img, { x: MARGIN, y: cy - h, width: w, height: h })
      cover.drawText(a.company.legalName, { x: MARGIN + w + 12, y: cy - 18, size: 13, font: bold, color: NAVY })
      cover.drawText(a.company.tagline, { x: MARGIN + w + 12, y: cy - 32, size: 8.5, font, color: LIGHT })
      cy -= h + 8
    } catch {
      cover.drawText(a.company.legalName, { x: MARGIN, y: cy - 18, size: 13, font: bold, color: NAVY })
      cy -= 34
    }
  } else {
    cover.drawText(a.company.legalName, { x: MARGIN, y: cy - 18, size: 13, font: bold, color: NAVY })
    cy -= 34
  }

  // Title block, floated down the page the way a cover reads.
  cy -= 150
  cover.drawText('PROPOSAL FOR COMMERCIAL CLEANING SERVICES', {
    x: MARGIN, y: cy, size: 8.5, font: bold, color: LIGHT,
  })
  cy -= 30
  for (const line of wrap(a.projectName, bold, 23, CONTENT_WIDTH)) {
    cover.drawText(line, { x: MARGIN, y: cy, size: 23, font: bold, color: NAVY })
    cy -= 28
  }
  if (a.siteAddress) {
    cy -= 4
    cover.drawText(wrap(a.siteAddress, font, 10.5, CONTENT_WIDTH)[0], {
      x: MARGIN, y: cy, size: 10.5, font, color: GRAY,
    })
    cy -= 16
  }

  cy -= 40
  cover.drawLine({ start: { x: MARGIN, y: cy }, end: { x: PAGE_WIDTH - MARGIN, y: cy }, thickness: 2, color: NAVY })
  cy -= 22

  const colTop = cy
  const half = CONTENT_WIDTH / 2
  cover.drawText('PREPARED FOR', { x: MARGIN, y: cy, size: 7.5, font: bold, color: LIGHT })
  cover.drawText('SUBMITTED BY', { x: MARGIN + half, y: cy, size: 7.5, font: bold, color: LIGHT })
  cy -= 15

  const left = [a.client?.company, a.client?.name, a.client?.propertyAddress].filter(Boolean) as string[]
  const right = [
    a.company.legalName,
    `${a.company.owner}, ${a.company.ownerTitle}`,
    a.company.addressLine,
    `${a.company.city}, ${a.company.state} ${a.company.zip}`,
    a.company.phone,
    a.company.email,
  ]
  let ly = cy
  for (const l of left) {
    for (const line of wrap(l, font, 9.5, half - 16)) {
      cover.drawText(line, { x: MARGIN, y: ly, size: 9.5, font, color: GRAY })
      ly -= 13
    }
  }
  let ry = cy
  for (const r of right) {
    cover.drawText(wrap(r, font, 9.5, half - 16)[0], { x: MARGIN + half, y: ry, size: 9.5, font, color: GRAY })
    ry -= 13
  }

  cy = Math.min(ly, ry) - 26
  cover.drawLine({ start: { x: MARGIN, y: cy }, end: { x: PAGE_WIDTH - MARGIN, y: cy }, thickness: 1, color: LINE })
  cy -= 18

  const facts: Array<[string, string]> = [
    ['Proposal number', a.proposalNumber],
    ['Date issued', a.issuedDate],
    ['Valid through', a.expiresDate],
  ]
  if (a.walkthroughDate) facts.push(['Site walk-through', a.walkthroughDate])
  if (a.solicitationNumber) facts.push(['Solicitation', a.solicitationNumber])
  facts.push(['NAICS', `${a.company.naics} - ${a.company.naicsLabel}`])

  for (const [k, v] of facts) {
    cover.drawText(k, { x: MARGIN, y: cy, size: 9, font, color: LIGHT })
    cover.drawText(v, {
      x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(v, 9),
      y: cy, size: 9, font: bold, color: NAVY,
    })
    cy -= 15
  }

  cover.drawText(
    `${a.company.entityType} organised in ${a.company.stateOfFormation}  |  ${a.company.website}`,
    { x: MARGIN, y: 52, size: 7.5, font, color: LIGHT },
  )

  /* ---------- body ---------- */
  const L = new Layout(doc, font, bold, footerText)
  let sectionNo = 0
  const next = () => `${++sectionNo}.`

  if (a.summary.length) {
    L.heading(next(), 'Executive Summary')
    for (const p of a.summary) {
      L.text(p)
      L.gap(5)
    }
  }

  L.heading(next(), 'Scope of Work')
  if (a.scope.sections.length) {
    for (const sec of a.scope.sections) {
      L.need(30)
      L.text(sec.label, { bold: true, size: 9.5, color: NAVY })
      L.gap(2)
      for (const item of sec.scope) L.bullet(item)
      L.gap(7)
    }
  } else {
    L.text('Scope as described in the line items below.')
  }

  /* pricing */
  L.heading(next(), 'Pricing')
  const base = a.lineItems.filter(li => !li.isOptional)
  const optional = a.lineItems.filter(li => li.isOptional)

  const drawItems = (items: typeof a.lineItems) => {
    for (const li of items) {
      const amount = Number(li.quantity) * Number(li.unitPrice)
      const descLines = wrap(li.description, font, 8.5, CONTENT_WIDTH - 150)
      L.need(descLines.length * 12 + 6)
      descLines.forEach((line, i) => {
        L.page.drawText(line, { x: MARGIN, y: L.y - 8.5, size: 8.5, font, color: GRAY })
        if (i === 0) {
          const qty = `${li.quantity} ${li.unit || 'job'}`
          L.page.drawText(qty, { x: PAGE_WIDTH - MARGIN - 190, y: L.y - 8.5, size: 8.5, font, color: LIGHT })
          const rate = money(Number(li.unitPrice))
          L.page.drawText(rate, { x: PAGE_WIDTH - MARGIN - 120, y: L.y - 8.5, size: 8.5, font, color: GRAY })
          const amt = money(amount)
          L.page.drawText(amt, {
            x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(amt, 8.5),
            y: L.y - 8.5, size: 8.5, font: bold, color: NAVY,
          })
        }
        L.y -= 12
      })
      L.gap(3)
      L.page.drawLine({
        start: { x: MARGIN, y: L.y + 2 }, end: { x: PAGE_WIDTH - MARGIN, y: L.y + 2 },
        thickness: 0.5, color: LINE,
      })
    }
  }

  drawItems(base)
  L.gap(8)

  const totalRow = (label: string, value: number, strong = false) => {
    L.need(16)
    const f = strong ? bold : font
    const size = strong ? 11 : 9
    L.page.drawText(label, {
      x: PAGE_WIDTH - MARGIN - 230, y: L.y - size, size, font: f, color: strong ? NAVY : GRAY,
    })
    const v = money(value)
    L.page.drawText(v, {
      x: PAGE_WIDTH - MARGIN - f.widthOfTextAtSize(v, size),
      y: L.y - size, size, font: f, color: strong ? NAVY : GRAY,
    })
    L.y -= size * 1.7
  }

  totalRow('Subtotal', a.subtotal)
  if (a.taxApplied) totalRow('Utah Sales Tax (7.25%)', a.taxAmount)
  totalRow('TOTAL', a.total, true)

  if (a.contract?.hasRecurring) {
    L.gap(6)
    L.text('Recurring services, per month (average): ' + money(a.contract.monthlyAverage), { size: 9 })
    L.text('Annual contract value: ' + money(a.contract.annualRecurring), { size: 9, bold: true, color: NAVY })
    if (a.contract.oneTimeTotal > 0) {
      L.text('Total, first year: ' + money(a.contract.firstYearTotal), { size: 9 })
    }
  }

  if (optional.length) {
    L.gap(12)
    L.text('Optional - not included in the total above', { bold: true, size: 9, color: NAVY })
    L.text('Priced for your consideration. Declining them does not change the price above.', { size: 8.5, color: LIGHT })
    L.gap(5)
    drawItems(optional)
    L.gap(4)
    totalRow('If all options accepted, add', a.optionalTotal)
  }

  if (a.scope.exclusions.length) {
    L.heading(next(), 'Exclusions')
    L.text('The following are not included in the pricing above. Any of them can be quoted separately on request.', { size: 8.5, color: LIGHT })
    L.gap(5)
    for (const x of a.scope.exclusions) L.bullet(x)
  }

  if (a.scope.assumptions.length || a.siteConditions) {
    L.heading(next(), 'Assumptions & Site Conditions')
    if (a.siteConditions) {
      L.text('Observed at walk-through: ' + a.siteConditions, { size: 9 })
      L.gap(6)
    }
    L.text('This price depends on the following being true on the service date. If any is not, we will document it and re-quote before proceeding.', { size: 8.5, color: LIGHT })
    L.gap(5)
    for (const x of a.scope.assumptions) L.bullet(x)
  }

  if (a.scope.compliance.length) {
    L.heading(next(), 'Insurance, Compliance & Quality Assurance')
    for (const x of a.scope.compliance) L.bullet(x)
    L.gap(5)
    L.text('If any work does not meet the scope above, contact us within 24 hours and we will return and re-do it at no charge.', { size: 8.5, color: LIGHT })
  }

  /* acceptance, kept whole on one page */
  L.need(230)
  L.heading(next(), 'Terms & Acceptance')
  L.text(
    `This proposal is valid through ${a.expiresDate}. Pricing is based on the scope, exclusions and assumptions stated above. `
    + 'Accepting this proposal authorizes Renovo Surface Solutions LLC to prepare a work order for the scope described. '
    + 'A signed work order is required before any work begins - acceptance here is not itself a work order. '
    + 'Payment terms, cancellation terms and the full service agreement are presented with the work order for signature.',
  )
  if (a.notes) {
    L.gap(6)
    L.text('Notes: ' + a.notes, { size: 9 })
  }

  L.gap(26)
  const signRow = (leftLabel: string, rightLabel: string) => {
    L.need(46)
    const w = (CONTENT_WIDTH - 30) / 2
    L.page.drawLine({ start: { x: MARGIN, y: L.y }, end: { x: MARGIN + w, y: L.y }, thickness: 1, color: NAVY })
    L.page.drawLine({ start: { x: MARGIN + w + 30, y: L.y }, end: { x: PAGE_WIDTH - MARGIN, y: L.y }, thickness: 1, color: NAVY })
    L.y -= 11
    L.page.drawText(leftLabel, { x: MARGIN, y: L.y, size: 7.5, font, color: LIGHT })
    L.page.drawText(rightLabel, { x: MARGIN + w + 30, y: L.y, size: 7.5, font, color: LIGHT })
    L.y -= 30
  }
  signRow('Authorized Signature', 'Date')
  signRow('Print Name & Title', 'PO / Reference')
  signRow('For Renovo Surface Solutions LLC', 'Date')

  return doc.save()
}
