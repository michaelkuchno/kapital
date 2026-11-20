import { round2, BELKA } from './money'

/** A share position (GPW). Cost includes brokerage fees (they are tax-deductible costs, art. 22 ust. 1a PIT). */
export interface Position {
  name: string
  isin?: string
  quantity: number
  /** total purchase cost incl. fees, zł */
  cost: number
  /** last price per share, zł */
  price: number
}

export interface PositionValuation {
  value: number
  gain: number
  /** gain as a fraction of cost */
  gainPct: number
  /** Belka tax if sold now (only when there is a gain and no other losses this year) */
  taxIfSold: number
  netIfSold: number
  /** price needed to get back to the purchase cost */
  breakEvenPrice: number
  /** return needed from today to break even (e.g. −50 % needs +100 %) */
  neededToBreakEven: number
}

export function valuePosition(p: Position, sellFeePct = 0): PositionValuation {
  if (p.quantity < 0 || p.cost < 0 || p.price < 0) throw new Error('invalid position')
  const value = round2(p.quantity * p.price)
  const fee = round2(value * sellFeePct)
  const gain = round2(value - fee - p.cost)
  const tax = gain > 0 ? round2(gain * BELKA) : 0
  return {
    value,
    gain,
    gainPct: p.cost ? gain / p.cost : 0,
    taxIfSold: tax,
    netIfSold: round2(value - fee - tax),
    breakEvenPrice: p.quantity ? round2(p.cost / p.quantity) : 0,
    neededToBreakEven: value > 0 ? p.cost / value - 1 : 0,
  }
}

/**
 * Tax year for share sales (PIT-38): gains and losses from selling securities in the same year are netted;
 * tax = 19 % of the positive result. A loss can also reduce income from this source in the next 5 years
 * (up to 50 % of the loss per year, or once up to 5 mln zł – art. 9 ust. 3 PIT). Interest from deposits and
 * treasury bonds is a different source (flat tax withheld) and can NOT be offset by share losses.
 */
export function yearTax(realized: readonly number[], carriedLoss = 0): { result: number; lossUsed: number; tax: number } {
  const result = round2(realized.reduce((s, x) => s + x, 0))
  if (result <= 0) return { result, lossUsed: 0, tax: 0 }
  const lossUsed = Math.min(result, Math.max(0, carriedLoss))
  // PIT-38: the tax base and the tax are rounded to full złoty (Ordynacja podatkowa art. 63 § 1)
  return { result, lossUsed: round2(lossUsed), tax: Math.round(Math.round(result - lossUsed) * BELKA) }
}

/** What selling a losing position does to this year's tax when there are realized gains elsewhere. */
export function taxSavedByRealizingLoss(realizedGainsThisYear: number, loss: number): number {
  if (loss >= 0 || realizedGainsThisYear <= 0) return 0
  const offset = Math.min(realizedGainsThisYear, -loss)
  return round2(offset * BELKA)
}
