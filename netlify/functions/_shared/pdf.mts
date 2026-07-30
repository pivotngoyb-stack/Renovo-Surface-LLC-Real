import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'

const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const NAVY = rgb(0.051, 0.122, 0.22)
const GRAY = rgb(0.29, 0.35, 0.45)
const LIGHT_GRAY = rgb(0.54, 0.6, 0.68)
const GREEN = rgb(0.106, 0.478, 0.235)
const LINE = rgb(0.87, 0.9, 0.95)

let cachedLogoBytes: ArrayBuffer | null = null
async function fetchLogoBytes(): Promise<ArrayBuffer | null> {
  if (cachedLogoBytes) return cachedLogoBytes
  try {
    const res = await fetch(`${SITE_URL}/images/logo.png`)
    if (!res.ok) return null
    cachedLogoBytes = await res.arrayBuffer()
    return cachedLogoBytes
  } catch {
    return null
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = trial
    }
  }
  if (current) lines.push(current)
  return lines
}

interface LineItem {
  description: string
  quantity: string | number
  unitPrice: string | number
}

interface GenerateInvoicePdfArgs {
  invoiceNumber: string
  status: string
  client: { name: string; email: string; company?: string | null; propertyAddress?: string | null } | null
  lineItems: LineItem[]
  subtotal: number
  taxApplied: boolean
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  dueDate?: string | null
  notes?: string | null
}

export async function generateInvoicePdf(args: GenerateInvoicePdfArgs): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  function newPageIfNeeded(minY: number) {
    if (y < minY) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
    }
  }

  const logoBytes = await fetchLogoBytes()
  if (logoBytes) {
    try {
      const logoImg = await pdfDoc.embedPng(logoBytes)
      const logoHeight = 36
      const logoWidth = (logoImg.width / logoImg.height) * logoHeight
      page.drawImage(logoImg, { x: MARGIN, y: y - logoHeight, width: logoWidth, height: logoHeight })
    } catch {
      // If the logo isn't a valid PNG or fetch failed, just skip it -- the PDF still works without it.
    }
  }

  page.drawText('INVOICE', { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize('INVOICE', 20), y: y - 18, size: 20, font: bold, color: NAVY })
  page.drawText(args.invoiceNumber, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(args.invoiceNumber, 11), y: y - 34, size: 11, font, color: GRAY })
  const statusLabel = args.status.replace('_', ' ').toUpperCase()
  page.drawText(statusLabel, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(statusLabel, 10), y: y - 48, size: 10, font: bold, color: args.status === 'paid' ? GREEN : GRAY })

  y -= 70

  page.drawText('Bill To', { x: MARGIN, y, size: 9, font: bold, color: LIGHT_GRAY })
  y -= 14
  if (args.client) {
    page.drawText(args.client.name, { x: MARGIN, y, size: 11, font: bold, color: NAVY })
    y -= 14
    page.drawText(args.client.email, { x: MARGIN, y, size: 10, font, color: GRAY })
    y -= 13
    if (args.client.company) {
      page.drawText(args.client.company, { x: MARGIN, y, size: 10, font, color: GRAY })
      y -= 13
    }
    if (args.client.propertyAddress) {
      page.drawText(args.client.propertyAddress, { x: MARGIN, y, size: 10, font, color: GRAY })
      y -= 13
    }
  }
  if (args.dueDate) {
    page.drawText(`Due: ${args.dueDate}`, { x: MARGIN, y, size: 10, font, color: GRAY })
    y -= 13
  }

  y -= 16

  // Line items table
  const colDesc = MARGIN
  const colQty = MARGIN + CONTENT_WIDTH - 190
  const colPrice = MARGIN + CONTENT_WIDTH - 130
  const colTotal = MARGIN + CONTENT_WIDTH - 60

  function drawTableHeader() {
    page.drawText('Description', { x: colDesc, y, size: 9, font: bold, color: LIGHT_GRAY })
    page.drawText('Qty', { x: colQty, y, size: 9, font: bold, color: LIGHT_GRAY })
    page.drawText('Price', { x: colPrice, y, size: 9, font: bold, color: LIGHT_GRAY })
    page.drawText('Total', { x: colTotal, y, size: 9, font: bold, color: LIGHT_GRAY })
    y -= 8
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1, color: LINE })
    y -= 16
  }

  drawTableHeader()

  for (const li of args.lineItems) {
    const qty = Number(li.quantity)
    const unitPrice = Number(li.unitPrice)
    const lineTotal = qty * unitPrice
    const descLines = wrapText(li.description, font, 10, colQty - colDesc - 10)

    newPageIfNeeded(MARGIN + 120)
    const rowStartY = y
    descLines.forEach((line, i) => {
      page.drawText(line, { x: colDesc, y: y - i * 12, size: 10, font, color: NAVY })
    })
    page.drawText(String(qty), { x: colQty, y: rowStartY, size: 10, font, color: GRAY })
    page.drawText(`$${unitPrice.toFixed(2)}`, { x: colPrice, y: rowStartY, size: 10, font, color: GRAY })
    page.drawText(`$${lineTotal.toFixed(2)}`, { x: colTotal, y: rowStartY, size: 10, font, color: NAVY })
    y -= Math.max(descLines.length * 12, 12) + 8
  }

  y -= 8
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1, color: LINE })
  y -= 20

  newPageIfNeeded(MARGIN + 100)

  function drawTotalLine(label: string, value: string, opts: { boldLine?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const f = opts.boldLine ? bold : font
    const size = opts.boldLine ? 12 : 10
    const color = opts.color || (opts.boldLine ? NAVY : GRAY)
    page.drawText(label, { x: colPrice - 40, y, size, font: f, color })
    page.drawText(value, { x: colTotal, y, size, font: f, color })
    y -= opts.boldLine ? 18 : 14
  }

  drawTotalLine('Subtotal', `$${args.subtotal.toFixed(2)}`)
  if (args.taxApplied && args.taxAmount > 0) {
    drawTotalLine('Utah Sales Tax (7.25%)', `$${args.taxAmount.toFixed(2)}`)
  }
  if (args.amountPaid > 0) {
    drawTotalLine('Amount Paid', `-$${args.amountPaid.toFixed(2)}`, { color: GREEN })
    drawTotalLine('Balance Due', `$${args.balanceDue.toFixed(2)}`, { boldLine: true })
  } else {
    drawTotalLine('Total Due', `$${args.total.toFixed(2)}`, { boldLine: true })
  }

  y -= 20
  newPageIfNeeded(MARGIN + 140)

  page.drawText('Payment Terms', { x: MARGIN, y, size: 10, font: bold, color: NAVY })
  y -= 14
  const terms = [
    'Payment is due upon receipt of this invoice. For recurring contracts, payment is due within 15 days of invoice date.',
    'Late payments are subject to a 1.5% monthly interest charge on the outstanding balance.',
    'Accepted payment methods: Cash, Check (payable to Renovo Surface Solutions LLC), Zelle: 801-369-2330, Credit Card (3% processing fee applies).',
  ]
  for (const paragraph of terms) {
    for (const line of wrapText(paragraph, font, 8.5, CONTENT_WIDTH)) {
      newPageIfNeeded(MARGIN + 30)
      page.drawText(line, { x: MARGIN, y, size: 8.5, font, color: LIGHT_GRAY })
      y -= 11
    }
    y -= 3
  }

  y -= 10
  newPageIfNeeded(MARGIN + 20)
  page.drawText('Renovo Surface Solutions LLC  ·  30 N Orange Street, Salt Lake City, UT 84116  ·  801-369-2330', {
    x: MARGIN,
    y,
    size: 8,
    font,
    color: LIGHT_GRAY,
  })

  return pdfDoc.save()
}
