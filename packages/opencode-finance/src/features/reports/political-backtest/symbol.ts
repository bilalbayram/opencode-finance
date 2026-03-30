const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/

export function toUpperSymbol(value: string): string | null {
  const symbol = value.trim().toUpperCase()
  if (!symbol) return null
  return symbol
}

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_RE.test(symbol)
}
