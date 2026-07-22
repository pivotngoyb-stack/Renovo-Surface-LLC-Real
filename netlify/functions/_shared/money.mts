interface LineItem {
  quantity: string | number
  unitPrice: string | number
}

export function computeTotal(lineItems: LineItem[]): number {
  return lineItems.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
}

export function formatMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function invoiceNumber(id: number): string {
  return `INV-${1000 + id}`
}
