/**
 * Escapes a value for CSV and guards against formula injection: a cell that
 * opens with =, +, -, or @ gets interpreted as a formula by Excel/Sheets when
 * the file is opened, so those are prefixed with a leading apostrophe.
 */
export function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(',')
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','))
  return [header, ...lines].join('\r\n') + '\r\n'
}
