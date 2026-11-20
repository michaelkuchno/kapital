import { valueBond, BOND_SPECS, type BondTerms } from './bonds'
import { addMonths, addYears, type ISODate } from './dates'
import { round2, BELKA } from './money'

/**
 * What an amount becomes after `years`, after fees and Belka tax, for each retail bond and for a deposit.
 * Bonds shorter than the horizon are held to maturity and the net proceeds are reinvested in the same bond on the
 * same terms (a simplification – future offers can differ); a bond still running at the horizon is redeemed early.
 * Paid-out coupons (COI, ROR, DOR) are kept as cash (not reinvested).
 */
export interface CompareResult {
  label: string
  net: number
  /** in today's money */
  real: number
  /** yearly net return, fraction */
  annual: number
}

export function compareBond(terms: BondTerms, amount: number, years: number, start: ISODate, cpi: number, ref: number): CompareResult {
  const end = addYears(start, years)
  let t = start
  let count = Math.floor(amount / 100)
  let cash = round2(amount - count * 100)
  const spec = BOND_SPECS[terms.code]
  let guard = 0
  while (t < end && count > 0 && guard++ < 1000) {
    const maturity = addMonths(t, spec.months)
    if (maturity <= end) {
      const v = valueBond(terms, t, count, maturity, [], [], { cpi, ref })
      const proceeds = v.maturityNet
      count = Math.floor(proceeds / 100)
      cash = round2(cash + proceeds - count * 100)
      t = maturity
    } else {
      const v = valueBond(terms, t, count, end, [], [], { cpi, ref })
      cash = round2(cash + v.netIfRedeemed + round2(v.paidOutGross * (1 - BELKA)))
      count = 0
      t = end
    }
  }
  const net = round2(cash + count * 100)
  return result(`${terms.code}`, amount, net, years, cpi)
}

/** Deposit renewed every year at the same rate, Belka on each year's interest. */
export function compareDeposit(amount: number, rate: number, years: number, cpi: number): CompareResult {
  let v = amount
  for (let y = 0; y < years; y++) v = round2(v + round2(round2((v * rate) / 100) * (1 - BELKA)))
  return result('deposit', amount, v, years, cpi)
}

function result(label: string, amount: number, net: number, years: number, cpi: number): CompareResult {
  return { label, net, real: round2(net / Math.pow(1 + cpi / 100, years)), annual: amount > 0 && years > 0 ? Math.pow(net / amount, 1 / years) - 1 : 0 }
}
