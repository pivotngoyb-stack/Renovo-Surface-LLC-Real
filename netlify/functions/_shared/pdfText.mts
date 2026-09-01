import type { PDFFont } from 'pdf-lib'

/**
 * Fold text into what the standard PDF fonts can actually draw.
 *
 * Helvetica and its siblings are WinAnsi-encoded, and pdf-lib throws rather
 * than substituting when asked to draw a character outside that set. The
 * characters that reach these documents are the ones a word processor inserts
 * without being asked -- curly quotes, en and em dashes, ellipses, non-breaking
 * spaces -- so anything pasted from Word or an email would take the whole
 * document down rather than render slightly wrong.
 *
 * Shared rather than copied: the proposal had its own version, and a change
 * order carries free text typed on a phone at a job site, which is if anything
 * more likely to contain something exotic.
 */
export function ascii(text: unknown): string {
  return String(text ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-')
    .replace(/ /g, ' ')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '')
}

/** Break text to a width, honouring the newlines already in it. */
export function wrapAscii(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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
  return out
}

/**
 * Money for a document a client reads.
 *
 * The sign goes outside the symbol -- -$310.00, not $-310.00 -- because a
 * change order can be a credit and that is the figure most likely to be
 * misread.
 */
export function pdfMoney(n: number): string {
  const v = Number(n) || 0
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
