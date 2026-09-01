import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { ascii, wrapAscii, pdfMoney } from './pdfText.mts'

/**
 * A change order as a file.
 *
 * The proposal and the invoice both have one; the change order did not, which
 * is backwards. Of the three it is the document most likely to be wanted as a
 * file later: it is the signed amendment that explains why an invoice came to
 * more than the job the client agreed to, and the thing a dispute turns on.
 *
 * A signed one prints the signature, the name, the date and the IP it came
 * from. That is the whole reason to keep a copy -- a PDF of the terms with a
 * blank line where the signature should be proves nothing.
 */

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'
const PAGE_W = 612
const PAGE_H = 792
const M = 50
const W = PAGE_W - M * 2

const NAVY = rgb(0.051, 0.122, 0.22)
const GRAY = rgb(0.29, 0.35, 0.45)
const MUTED = rgb(0.54, 0.6, 0.68)
const GREEN = rgb(0.106, 0.478, 0.235)
const RED = rgb(0.753, 0.224, 0.169)
const AMBER = rgb(0.72, 0.47, 0.09)
const LINE = rgb(0.87, 0.9, 0.95)

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

export interface ChangeOrderPdfArgs {
  number: string
  workOrderId: number
  status: 'draft' | 'sent' | 'approved' | 'declined'
  issuedDate: string
  description: string
  reasonLabel?: string | null
  poNumber?: string | null
  scheduleImpactDays: number
  total: number
  lineItems: Array<{ description: string; quantity: string | number; unitPrice: string | number }>
  client: { name: string; company?: string | null; email?: string | null } | null
  projectName?: string | null
  siteAddress?: string | null
  terms: string
  /*
   * Set on a contract change order. It amends a standing rate rather than a
   * job total, so "Added to your contract: $585" would badly misdescribe it --
   * the client is agreeing to a different bill every month.
   */
  contractEffect?: {
    perVisit: number
    monthlyDelta: number
    currentMonthly: number
    newMonthly: number
    frequencyLabel: string
    contractDescription: string
  } | null
  signature?: {
    signerName: string
    signerTitle?: string | null
    signatureType: 'drawn' | 'typed'
    signatureData: string
    signedAt: string
    ipAddress?: string | null
  } | null
  declineReason?: string | null
}

export async function generateChangeOrderPdf(a: ChangeOrderPdfArgs): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  pdf.setTitle(ascii(`${a.number} - Change Order`))
  pdf.setAuthor('Renovo Surface Solutions LLC')
  pdf.setSubject(ascii(a.projectName || `Work Order #${a.workOrderId}`))

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - M

  /** Start a new page when the next block would not fit. */
  const need = (h: number) => {
    if (y - h < M + 40) {
      page = pdf.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - M
    }
  }
  const text = (s: string, opts: { x?: number; size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(ascii(s), { x: opts.x ?? M, y, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? NAVY })
  }
  const right = (s: string, size: number, f: PDFFont, color = NAVY) => {
    page.drawText(ascii(s), { x: PAGE_W - M - f.widthOfTextAtSize(ascii(s), size), y, size, font: f, color })
  }
  const para = (s: string, size = 10, f: PDFFont = font, color = GRAY, width = W) => {
    for (const line of wrapAscii(s, f, size, width)) {
      need(size + 4)
      text(line, { size, f, color })
      y -= size + 4
    }
  }
  const rule = () => {
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1, color: LINE })
  }
  const heading = (s: string) => {
    need(30)
    y -= 12
    text(s, { size: 9, f: bold, color: MUTED })
    y -= 14
  }

  /* ---------------- header ---------------- */
  const logo = await logoBytes()
  if (logo) {
    try {
      const img = await pdf.embedPng(logo)
      const h = 36
      page.drawImage(img, { x: M, y: y - h, width: (img.width / img.height) * h, height: h })
    } catch { /* the document is fine without it */ }
  }

  y -= 18
  right('CHANGE ORDER', 18, bold)
  y -= 16
  right(a.number, 11, font, GRAY)
  y -= 14
  const statusColor = a.status === 'approved' ? GREEN : a.status === 'declined' ? RED : AMBER
  right(a.status.toUpperCase(), 10, bold, statusColor)

  y -= 26
  rule()
  y -= 18

  /* ---------------- who and what ---------------- */
  const leftX = M
  const midX = M + W / 2
  const blockTop = y

  /*
   * Both columns wrap inside their own half.
   *
   * Drawn unwrapped, a long company name -- which is most of them, once you
   * add "Property Management LLC" -- ran straight through the meta column on
   * the right and printed on top of it.
   */
  const colW = W / 2 - 14

  page.drawText('FOR', { x: leftX, y, size: 8, font: bold, color: MUTED })
  let ly = y - 13
  const leftLine = (s: string, size: number, f: PDFFont, color: ReturnType<typeof rgb>) => {
    for (const line of wrapAscii(s, f, size, colW)) {
      page.drawText(ascii(line), { x: leftX, y: ly, size, font: f, color })
      ly -= size + 2.5
    }
  }
  if (a.client) {
    leftLine(a.client.name, 10, bold, NAVY)
    if (a.client.company) leftLine(a.client.company, 9.5, font, GRAY)
    if (a.siteAddress) leftLine(a.siteAddress, 9.5, font, GRAY)
  }

  let ry = blockTop
  const meta: Array<[string, string]> = [
    ['Amends', a.contractEffect ? a.contractEffect.contractDescription : `Work Order #${a.workOrderId}`],
    ['Issued', a.issuedDate],
  ]
  if (a.poNumber) meta.push(['PO Number', a.poNumber])
  if (a.projectName) meta.push(['Project', a.projectName])
  for (const [k, v] of meta) {
    page.drawText(ascii(k), { x: midX, y: ry, size: 8, font: bold, color: MUTED })
    for (const line of wrapAscii(v, font, 9.5, colW)) {
      ry -= 12
      page.drawText(ascii(line), { x: midX, y: ry, size: 9.5, font, color: GRAY })
    }
    ry -= 14
  }

  y = Math.min(ly, ry) - 8
  rule()
  y -= 8

  /* ---------------- what changed ---------------- */
  heading('WHAT CHANGED')
  para(a.description, 10, font, NAVY)
  if (a.reasonLabel) {
    y -= 4
    para(`Reason: ${a.reasonLabel}`, 9, italic, GRAY)
  }

  /* ---------------- lines ---------------- */
  y -= 10
  const colQty = M + W - 190
  const colPrice = M + W - 130
  const colTotal = M + W - 60

  need(40)
  page.drawText('DESCRIPTION', { x: M, y, size: 8, font: bold, color: MUTED })
  page.drawText('QTY', { x: colQty, y, size: 8, font: bold, color: MUTED })
  page.drawText(a.contractEffect ? 'PER VISIT' : 'PRICE', { x: colPrice, y, size: 8, font: bold, color: MUTED })
  page.drawText('TOTAL', { x: colTotal, y, size: 8, font: bold, color: MUTED })
  y -= 8
  rule()
  y -= 15

  for (const li of a.lineItems) {
    const qty = Number(li.quantity)
    const price = Number(li.unitPrice)
    const lines = wrapAscii(li.description, font, 10, colQty - M - 12)
    need(lines.length * 12 + 10)
    lines.forEach((line, i) => {
      page.drawText(ascii(line), { x: M, y: y - i * 12, size: 10, font, color: NAVY })
    })
    page.drawText(String(qty), { x: colQty, y, size: 10, font, color: GRAY })
    page.drawText(ascii(pdfMoney(price)), { x: colPrice, y, size: 10, font, color: GRAY })
    page.drawText(ascii(pdfMoney(qty * price)), { x: colTotal, y, size: 10, font, color: NAVY })
    y -= lines.length * 12 + 6
  }

  y -= 4
  rule()
  y -= 18

  const ce = a.contractEffect
  const isCredit = (ce ? ce.monthlyDelta : a.total) < 0
  const totalLabel = ce
    ? 'New monthly charge'
    : isCredit ? 'Credit to your contract' : 'Added to your contract'
  const totalValue = pdfMoney(ce ? ce.newMonthly : Math.abs(a.total))

  need(ce ? 52 : 24)
  if (ce) {
    // The arithmetic, spelled out. A monthly figure that moves with no
    // explanation is the thing that generates a phone call.
    right(
      `${pdfMoney(Math.abs(ce.perVisit))} ${ce.perVisit < 0 ? 'less' : 'more'} per visit at ${ce.frequencyLabel.toLowerCase()} service`,
      9.5, font, GRAY,
    )
    y -= 14
    right(`${pdfMoney(ce.currentMonthly)} per month becomes`, 9.5, font, GRAY)
    y -= 16
  }
  page.drawText(ascii(totalLabel), {
    x: PAGE_W - M - bold.widthOfTextAtSize(ascii(totalValue), 14) - 12 - bold.widthOfTextAtSize(ascii(totalLabel), 11),
    y, size: 11, font: bold, color: NAVY,
  })
  page.drawText(ascii(totalValue), {
    x: PAGE_W - M - bold.widthOfTextAtSize(ascii(totalValue), 14),
    y: y - 1, size: 14, font: bold, color: isCredit ? GREEN : NAVY,
  })
  y -= 22
  if (ce) {
    right('Ongoing, from the next invoice until the agreement changes again', 8.5, font, MUTED)
    y -= 18
  }

  if (a.scheduleImpactDays > 0) {
    const s = `Completion moves out by ${a.scheduleImpactDays} ${a.scheduleImpactDays === 1 ? 'day' : 'days'}`
    need(16)
    right(s, 9.5, font, GRAY)
    y -= 18
  }

  /* ---------------- authorization ---------------- */
  heading('AUTHORIZATION')
  para(a.terms, 9, font, GRAY)
  y -= 10

  /* ---------------- the signature, or a place for one ---------------- */
  if (a.status === 'declined') {
    need(50)
    rule()
    y -= 18
    text('DECLINED', { size: 11, f: bold, color: RED })
    y -= 16
    para(a.declineReason
      ? `The client declined this change order: "${a.declineReason}"`
      : 'The client declined this change order. The work described above was not authorized and must not be performed.',
      9.5, font, GRAY)
  } else if (a.signature) {
    need(120)
    rule()
    y -= 18
    text('ACCEPTED', { size: 9, f: bold, color: MUTED })
    y -= 8

    const markTop = y
    let markHeight = 34
    if (a.signature.signatureType === 'drawn' && a.signature.signatureData.startsWith('data:image/png;base64,')) {
      try {
        const b64 = a.signature.signatureData.split(',')[1]
        const img = await pdf.embedPng(Buffer.from(b64, 'base64'))
        const maxW = 200
        const maxH = 46
        const scale = Math.min(maxW / img.width, maxH / img.height)
        const w = img.width * scale
        const h = img.height * scale
        page.drawImage(img, { x: M, y: markTop - h, width: w, height: h })
        markHeight = h
      } catch {
        // A signature that will not embed still has a name and a date against
        // it; printing those beats failing the whole document.
        page.drawText(ascii(a.signature.signerName), { x: M, y: markTop - 20, size: 16, font: italic, color: NAVY })
      }
    } else {
      page.drawText(ascii(a.signature.signatureData), { x: M, y: markTop - 20, size: 16, font: italic, color: NAVY })
    }

    y = markTop - markHeight - 6
    page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.9, color: NAVY })
    y -= 12
    const who = a.signature.signerTitle
      ? `${a.signature.signerName}, ${a.signature.signerTitle}`
      : a.signature.signerName
    text(who, { size: 9.5, f: bold })
    y -= 12
    text(`Signed ${a.signature.signedAt}`, { size: 9, color: GRAY })
    y -= 11
    if (a.signature.ipAddress) {
      text(`Electronic signature recorded from ${a.signature.ipAddress}`, { size: 8, color: MUTED })
      y -= 11
    }
  } else {
    need(70)
    rule()
    y -= 26
    const half = (W - 34) / 2
    page.drawLine({ start: { x: M, y }, end: { x: M + half, y }, thickness: 0.9, color: NAVY })
    page.drawLine({ start: { x: M + half + 34, y }, end: { x: PAGE_W - M, y }, thickness: 0.9, color: NAVY })
    y -= 10
    page.drawText('Accepted by (signature)', { x: M, y, size: 7.3, font, color: MUTED })
    page.drawText(a.poNumber ? 'Date' : 'PO / Reference', { x: M + half + 34, y, size: 7.3, font, color: MUTED })
    y -= 24
  }

  /* ---------------- footer on every page ---------------- */
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    p.drawText(
      ascii(`Renovo Surface Solutions LLC  |  30 N Orange Street, Salt Lake City, UT 84116  |  801-369-2330`),
      { x: M, y: 30, size: 7.5, font, color: MUTED },
    )
    if (pages.length > 1) {
      const label = `Page ${i + 1} of ${pages.length}`
      p.drawText(label, { x: PAGE_W - M - font.widthOfTextAtSize(label, 7.5), y: 30, size: 7.5, font, color: MUTED })
    }
  })

  return pdf.save()
}
