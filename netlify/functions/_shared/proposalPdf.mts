import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { ascii } from './pdfText.mts'

/**
 * The proposal as a PDF, in Renovo's document house style.
 *
 * The web proposal already prints, and browser print-to-PDF is fine for a
 * client who just wants a copy. It is not fine for a procurement portal, which
 * wants a file uploaded, or a contracting officer who forwards attachments
 * rather than links. A bid that cannot be submitted in the form the buyer asks
 * for is non-responsive regardless of what it says.
 *
 * Laid out to match the invoice template Renovo already sends: wordmark left
 * and document type right, a right-aligned meta stack under it with a coloured
 * status line, two labelled columns, then a navy-headed table with striped
 * rows. A client who has had an invoice from Renovo should recognise this page
 * as coming from the same company.
 *
 * Content comes from the same shared helpers the HTML proposal calls --
 * buildProposalScope, contractValue, executiveSummary. Only the rendering is
 * duplicated. Rebuilding the content here is how the two documents would come
 * to describe different jobs.
 */

const PAGE_W = 612
const PAGE_H = 792
const M = 54
const W = PAGE_W - M * 2
const BOTTOM = 60

const NAVY = rgb(0.078, 0.145, 0.263)
const HEAD_BAR = rgb(0.106, 0.176, 0.298)
const INK = rgb(0.267, 0.290, 0.325)
const MUTED = rgb(0.53, 0.57, 0.63)
const LABEL = rgb(0.106, 0.451, 0.325)
const STRIPE = rgb(0.961, 0.969, 0.976)
const HAIR = rgb(0.867, 0.886, 0.910)
const AMBER = rgb(0.769, 0.365, 0.055)

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
 * The standard PDF fonts are WinAnsi and throw outright on anything outside it.
 * The scope library is full of em dashes and curly quotes, so every string is
 * folded to ASCII before it reaches pdf-lib.
 *
 * The rule itself now lives in pdfText.mts, shared with the change order, which
 * carries free text typed at a job site and is if anything more likely to
 * contain something unprintable. Two copies would drift, and the failure mode
 * is not one wrong character -- pdf-lib throws and the document does not render
 * at all.
 */

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of ascii(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
        out.push(line)
        line = word
      } else {
        line = trial
      }
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

/**
 * A cursor that knows when to break.
 *
 * pdf-lib draws at absolute coordinates and has no notion of flow, so a
 * document with variable-length scope lists needs this or it writes text off
 * the bottom edge -- which looks correct in code and loses a paragraph in the
 * file the client opens.
 */
class Doc {
  page: PDFPage
  y = PAGE_H - M

  // Assigned in the body rather than declared as constructor parameter
  // properties: esbuild compiles those, but Node's strip-only TypeScript does
  // not, and that would make this the one shared module in the project that
  // cannot be imported and tested without a build step.
  pdf: PDFDocument
  font: PDFFont
  bold: PDFFont
  private footerLine: string
  private n = 1

  constructor(pdf: PDFDocument, font: PDFFont, bold: PDFFont, footerLine: string) {
    this.pdf = pdf
    this.font = font
    this.bold = bold
    this.footerLine = footerLine
    this.page = pdf.addPage([PAGE_W, PAGE_H])
    this.footer()
  }

  private footer() {
    const t = ascii(this.footerLine)
    this.page.drawText(t, {
      x: (PAGE_W - this.font.widthOfTextAtSize(t, 7.5)) / 2,
      y: 34, size: 7.5, font: this.font, color: MUTED,
    })
  }

  newPage() {
    this.n += 1
    this.page = this.pdf.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - M
    this.footer()
  }

  need(h: number) {
    if (this.y - h < BOTTOM) this.newPage()
  }

  gap(h: number) { this.y -= h }

  right(text: string, y: number, size: number, font: PDFFont, color = INK, rightEdge = PAGE_W - M) {
    const t = ascii(text)
    this.page.drawText(t, { x: rightEdge - font.widthOfTextAtSize(t, size), y, size, font, color })
  }

  /** Small-caps green section label, the way the invoices mark their blocks. */
  label(text: string) {
    this.need(26)
    this.gap(6)
    this.page.drawText(ascii(text).toUpperCase(), {
      x: M, y: this.y - 8, size: 7.5, font: this.bold, color: LABEL,
    })
    this.y -= 17
  }

  body(text: string, opts: { size?: number; color?: typeof INK; indent?: number; font?: PDFFont } = {}) {
    const size = opts.size ?? 8.6
    const font = opts.font ?? this.font
    const indent = opts.indent ?? 0
    const lead = size * 1.5
    for (const line of wrap(text, font, size, W - indent)) {
      this.need(lead)
      this.page.drawText(line, { x: M + indent, y: this.y - size, size, font, color: opts.color ?? INK })
      this.y -= lead
    }
  }

  bullet(text: string) {
    const size = 8.4
    const indent = 13
    const lines = wrap(text, this.font, size, W - indent)
    this.need(lines.length * size * 1.45 + 2)
    lines.forEach((line, i) => {
      if (i === 0) this.page.drawText('-', { x: M + 3, y: this.y - size, size, font: this.font, color: MUTED })
      this.page.drawText(line, { x: M + indent, y: this.y - size, size, font: this.font, color: INK })
      this.y -= size * 1.45
    })
  }

  rule(color = HAIR, thickness = 1) {
    this.page.drawLine({
      start: { x: M, y: this.y }, end: { x: PAGE_W - M, y: this.y },
      thickness, color,
    })
  }
}

export interface ProposalPdfArgs {
  proposalNumber: string
  issuedDate: string
  expiresDate: string
  statusLine: string
  walkthroughDate?: string | null
  solicitationNumber?: string | null
  /** The client's purchase order, when one has been issued. */
  poNumber?: string | null
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
  paymentTerms: string[]
  deposit?: { required: boolean; pct: number; depositDue: number; balanceDue: number } | null
}

export async function generateProposalPdf(a: ProposalPdfArgs): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  pdf.setTitle(ascii(`${a.proposalNumber} - ${a.projectName}`))
  pdf.setAuthor(ascii(a.company.legalName))
  pdf.setSubject('Commercial cleaning services proposal')

  const d = new Doc(
    pdf, font, bold,
    `${a.company.legalName} - Licensed & Insured in the State of Utah - ${a.company.website}`,
  )

  /* ---------- masthead ---------- */
  const logo = await logoBytes()
  let headLeft = M
  if (logo) {
    try {
      const img = await pdf.embedPng(logo)
      const w = 34
      const h = (img.height / img.width) * w
      d.page.drawImage(img, { x: M, y: d.y - h + 4, width: w, height: h })
      headLeft = M + w + 10
    } catch { /* fall through to text-only */ }
  }

  d.page.drawText(ascii(a.company.legalName.toUpperCase()), {
    x: headLeft, y: d.y - 12, size: 13.5, font: bold, color: NAVY,
  })
  d.right('PROPOSAL', d.y - 15, 25, bold, NAVY)

  let ly = d.y - 25
  for (const line of [a.company.tagline, `${a.company.addressLine}, ${a.company.city}, ${a.company.state} ${a.company.zip}`, `${a.company.email} | ${a.company.phone}`]) {
    d.page.drawText(wrap(line, font, 7.8, 300)[0], { x: headLeft, y: ly, size: 7.8, font, color: MUTED })
    ly -= 10.5
  }

  /* right-hand meta stack, label then bold value, as on the invoices */
  let my = d.y - 38
  const meta: Array<[string, string, boolean]> = [
    ['Proposal No.', a.proposalNumber, true],
    ['Date Issued', a.issuedDate, false],
    ['Valid Through', a.expiresDate, true],
  ]
  if (a.solicitationNumber) meta.push(['Solicitation', a.solicitationNumber, true])
  // Bold: this is the number their accounts payable matches the invoice against.
  if (a.poNumber) meta.push(['PO Number', a.poNumber, true])
  for (const [k, v, strong] of meta) {
    const vw = (strong ? bold : font).widthOfTextAtSize(ascii(v), 8.4)
    d.right(v, my, 8.4, strong ? bold : font, strong ? NAVY : INK)
    d.page.drawText(ascii(k), {
      x: PAGE_W - M - vw - 6 - font.widthOfTextAtSize(ascii(k), 8.4),
      y: my, size: 8.4, font, color: MUTED,
    })
    my -= 12
  }
  d.right(a.statusLine.toUpperCase(), my, 8.4, bold, AMBER)

  d.y = Math.min(ly, my) - 16
  d.rule()
  d.y -= 20

  /* ---------- prepared for / job site ---------- */
  const half = W / 2
  const colTop = d.y
  d.page.drawText('PREPARED FOR', { x: M, y: colTop, size: 7.5, font: bold, color: LABEL })
  d.page.drawText('PROJECT / JOB SITE', { x: M + half, y: colTop, size: 7.5, font: bold, color: LABEL })

  const leftLines = [
    a.client?.company || a.client?.name || '',
    a.client?.company && a.client?.name ? `Attn: ${a.client.name}` : '',
    a.client?.propertyAddress || '',
    a.client?.email || '',
  ].filter(Boolean)
  const rightLines = [
    a.projectName,
    a.siteAddress,
    a.walkthroughDate ? `Site walk-through: ${a.walkthroughDate}` : '',
  ].filter(Boolean)

  let a1 = colTop - 15
  for (const l of leftLines) {
    for (const line of wrap(l, font, 8.6, half - 18)) {
      d.page.drawText(line, { x: M, y: a1, size: 8.6, font, color: INK })
      a1 -= 11.5
    }
  }
  let a2 = colTop - 15
  for (const l of rightLines) {
    for (const line of wrap(l, font, 8.6, half - 8)) {
      d.page.drawText(line, { x: M + half, y: a2, size: 8.6, font, color: INK })
      a2 -= 11.5
    }
  }
  d.y = Math.min(a1, a2) - 18

  /* ---------- what we propose ---------- */
  if (a.summary.length) {
    d.label('What we propose')
    for (const p of a.summary) { d.body(p); d.gap(3) }
    d.gap(6)
  }

  /* ---------- pricing table ---------- */
  const COL_QTY = PAGE_W - M - 210
  const COL_RATE = PAGE_W - M - 118

  const tableHead = () => {
    d.need(46)
    d.page.drawRectangle({ x: M, y: d.y - 20, width: W, height: 20, color: HEAD_BAR })
    d.page.drawText('Description', { x: M + 10, y: d.y - 13.5, size: 8, font: bold, color: rgb(1, 1, 1) })
    d.right('Qty', d.y - 13.5, 8, bold, rgb(1, 1, 1), COL_QTY + 46)
    d.right('Rate', d.y - 13.5, 8, bold, rgb(1, 1, 1), COL_RATE + 62)
    d.right('Amount', d.y - 13.5, 8, bold, rgb(1, 1, 1), PAGE_W - M - 10)
    d.y -= 20
  }

  const rows = (items: ProposalPdfArgs['lineItems'], startStriped = false) => {
    let striped = startStriped
    for (const li of items) {
      const amount = Number(li.quantity) * Number(li.unitPrice)
      const lines = wrap(li.description, font, 8.4, W - 240)
      const h = Math.max(lines.length * 11.5 + 9, 26)
      if (d.y - h < BOTTOM) { d.newPage(); tableHead(); }
      if (striped) {
        d.page.drawRectangle({ x: M, y: d.y - h, width: W, height: h, color: STRIPE })
      }
      let ty = d.y - 14
      lines.forEach(line => {
        d.page.drawText(line, { x: M + 10, y: ty, size: 8.4, font, color: INK })
        ty -= 11.5
      })
      const mid = d.y - 14
      d.right(`${li.quantity} ${ascii(li.unit || 'job')}`, mid, 8.4, font, INK, COL_QTY + 46)
      d.right(money(Number(li.unitPrice)), mid, 8.4, font, INK, COL_RATE + 62)
      d.right(money(amount), mid, 8.4, bold, NAVY, PAGE_W - M - 10)
      d.y -= h
      striped = !striped
    }
  }

  const base = a.lineItems.filter(li => !li.isOptional)
  const optional = a.lineItems.filter(li => li.isOptional)

  d.label('Pricing')
  tableHead()
  rows(base)
  d.gap(14)

  const totalRow = (label: string, value: number, strong = false) => {
    d.need(20)
    const size = strong ? 11.5 : 8.8
    const f = strong ? bold : font
    d.right(label, d.y - size, size, f, strong ? NAVY : MUTED, PAGE_W - M - 108)
    d.right(money(value), d.y - size, size, f, strong ? NAVY : INK)
    d.y -= size * 1.85
  }

  totalRow('Subtotal', a.subtotal)
  if (a.taxApplied) totalRow('Sales Tax (7.25%)', a.taxAmount)
  d.need(14)
  d.page.drawLine({
    start: { x: PAGE_W - M - 230, y: d.y + 3 }, end: { x: PAGE_W - M, y: d.y + 3 },
    thickness: 1.2, color: NAVY,
  })
  d.gap(4)
  totalRow(a.contract?.hasRecurring ? 'Total, Per Visit' : 'Total', a.total, true)

  // Deposit and balance, as the sample estimates present them. Drawn after
  // the total so the reader sees the whole number before it is split.
  if (a.deposit?.required) {
    d.gap(4)
    totalRow(`Deposit due now (${a.deposit.pct}%)`, a.deposit.depositDue)
    totalRow('Balance due at completion', a.deposit.balanceDue)
    d.gap(2)
    d.body('A deposit is required to schedule and hold the crew for this project. The balance is due on completion and walk-through sign-off.',
      { size: 8.2, color: MUTED })
  }

  if (a.contract?.hasRecurring) {
    d.gap(2)
    d.body(`Recurring services average ${money(a.contract.monthlyAverage)} per month. Annual contract value ${money(a.contract.annualRecurring)}.`
      + (a.contract.oneTimeTotal > 0 ? ` Total for the first year, including one-time work: ${money(a.contract.firstYearTotal)}.` : ''),
      { size: 8.4, color: MUTED })
  }

  if (optional.length) {
    d.gap(10)
    d.label('Optional - not included in the total above')
    d.body('Priced for your consideration. Declining them does not change the price above.', { size: 8.2, color: MUTED })
    d.gap(5)
    tableHead()
    rows(optional)
    d.gap(8)
    totalRow('If all options accepted, add', a.optionalTotal)
  }

  /* ---------- scope and the rest ---------- */
  if (a.scope.sections.length) {
    d.gap(8)
    d.label('Scope of work')
    for (const sec of a.scope.sections) {
      d.need(30)
      d.body(sec.label, { font: bold, size: 8.8, color: NAVY })
      d.gap(1)
      for (const item of sec.scope) d.bullet(item)
      d.gap(6)
    }
  }

  if (a.scope.exclusions.length) {
    d.label('Not included')
    d.body('Any of the following can be quoted separately on request.', { size: 8.2, color: MUTED })
    d.gap(4)
    for (const x of a.scope.exclusions) d.bullet(x)
    d.gap(4)
  }

  if (a.scope.assumptions.length || a.siteConditions) {
    d.label('What this price assumes')
    if (a.siteConditions) {
      d.body(`Observed at walk-through: ${a.siteConditions}`, { size: 8.4 })
      d.gap(5)
    }
    d.body('If any of the following is not true on the service date, we will document it and re-quote before proceeding.', { size: 8.2, color: MUTED })
    d.gap(4)
    for (const x of a.scope.assumptions) d.bullet(x)
    d.gap(4)
  }

  if (a.scope.compliance.length) {
    d.label('Insurance, compliance & our guarantee')
    for (const x of a.scope.compliance) d.bullet(x)
    d.gap(3)
    d.body('If any work does not meet the scope above, contact us within 24 hours and we will return and re-do it at no charge.',
      { size: 8.2, color: MUTED })
    d.gap(4)
  }

  d.label('Payment terms')
  for (const t of a.paymentTerms) d.body(t, { size: 8.4 })

  if (a.notes) {
    d.gap(4)
    d.label('Notes')
    d.body(a.notes, { size: 8.4 })
  }

  /* ---------- acceptance, kept whole ---------- */
  d.need(150)
  d.gap(8)
  d.label('Acceptance')
  d.body(
    `This proposal is valid through ${a.expiresDate} and is based on the scope, exclusions and assumptions stated above. `
    + 'Accepting it authorizes Renovo Surface Solutions LLC to prepare a work order for the scope described. '
    + 'A signed work order is required before any work begins - acceptance here is not itself a work order.',
    { size: 8.4 },
  )
  d.gap(24)

  const signRow = (l: string, r: string) => {
    d.need(44)
    const w = (W - 34) / 2
    d.page.drawLine({ start: { x: M, y: d.y }, end: { x: M + w, y: d.y }, thickness: 0.9, color: NAVY })
    d.page.drawLine({ start: { x: M + w + 34, y: d.y }, end: { x: PAGE_W - M, y: d.y }, thickness: 0.9, color: NAVY })
    d.y -= 10
    d.page.drawText(ascii(l), { x: M, y: d.y, size: 7.3, font, color: MUTED })
    d.page.drawText(ascii(r), { x: M + w + 34, y: d.y, size: 7.3, font, color: MUTED })
    d.y -= 28
  }
  signRow('Accepted by (signature)', 'Date')
  signRow('Print name & title', a.poNumber ? 'Date' : 'PO / Reference')

  return pdf.save()
}
