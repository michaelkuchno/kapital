/** Money helpers. All amounts are PLN numbers; rounding to grosze happens only where the law/issuer rounds. */
export const BELKA = 0.19

/** Round to grosze (2 decimals), half away from zero, robust against binary float noise (1.005 → 1.01, 1234567.125 → 1234567.13). */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return x
  const s = x < 0 ? -1 : 1
  // toFixed(6) removes representation noise (1.005*100 = 100.49999999999999) before rounding half up
  return (s * Math.round(Number((Math.abs(x) * 100).toFixed(6)))) / 100
}

/**
 * Belka tax: 19 % flat tax on capital income (art. 30a ustawy o PIT). Tax withheld by a payer (banks, the Treasury)
 * is rounded to full grosze (Ordynacja podatkowa art. 63 § 1a).
 */
export function belkaTax(gain: number): number {
  return gain > 0 ? round2(gain * BELKA) : 0
}

/** Net of Belka tax (only positive gains are taxed). */
export function afterTax(gain: number): number {
  return round2(gain - belkaTax(gain))
}

export function sum(xs: readonly number[]): number {
  let s = 0
  for (const x of xs) s += x
  return s
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** Share of a part in a whole (0 when the whole is 0). */
export function share(part: number, whole: number): number {
  return whole ? part / whole : 0
}
