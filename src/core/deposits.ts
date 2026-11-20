import { addMonths, daysBetween, type ISODate } from './dates'
import { round2, belkaTax } from './money'

/**
 * Bank deposit (lokata). Polish banks compute interest as capital × rate × days / 365 and withhold 19 % Belka tax
 * from the interest when it is paid (end of term, or each capitalization period).
 */
export interface Deposit {
  amount: number
  /** nominal annual rate in percent (e.g. promotional) */
  rate: number
  start: ISODate
  months: number
  /** interest paid/capitalized every `capMonths` months (default: once, at the end of the term) */
  capMonths?: number
  /** rate after the promotion (if the deposit renews) */
  renewRate?: number
  bank?: string
}

export interface DepositValuation {
  end: ISODate
  daysLeft: number
  /** interest accrued so far (before tax), credited + running period */
  accruedGross: number
  /** what you would get when breaking the deposit today (Polish banks usually pay no interest then) */
  breakValue: number
  /** value today if held to the end, interest already earned counted net */
  valueNet: number
  /** at the end of the term */
  interestGross: number
  interestNet: number
  endValueNet: number
  matured: boolean
}

export function valueDeposit(d: Deposit, asOf: ISODate): DepositValuation {
  if (d.amount < 0 || d.months <= 0) throw new Error('invalid deposit')
  const end = addMonths(d.start, d.months)
  const cap = d.capMonths && d.capMonths > 0 && d.capMonths < d.months ? d.capMonths : d.months
  let capital = d.amount
  let credited = 0
  let accrued = 0
  let interestGross = 0
  let interestNet = 0
  for (let s = 0; s < d.months; s += cap) {
    const ps = addMonths(d.start, s)
    const pe = addMonths(d.start, Math.min(d.months, s + cap))
    const gross = round2((capital * d.rate * daysBetween(ps, pe)) / 36500)
    const net = round2(gross - belkaTax(gross))
    interestGross += gross
    interestNet += net
    if (asOf >= pe) credited += gross
    else if (asOf > ps) accrued = round2((capital * d.rate * daysBetween(ps, asOf)) / 36500)
    capital = round2(capital + net)
  }
  const matured = asOf >= end
  const creditedNet = round2(credited - belkaTax(credited))
  return {
    end,
    daysLeft: Math.max(0, daysBetween(asOf, end)),
    accruedGross: round2(credited + accrued),
    breakValue: round2(d.amount + creditedNet),
    valueNet: round2(d.amount + creditedNet + accrued - belkaTax(accrued)),
    interestGross: round2(interestGross),
    interestNet: round2(interestNet),
    endValueNet: round2(d.amount + interestNet),
    matured,
  }
}

/** Interest for a given amount, rate and number of days, after tax (simple deposit). */
export function depositNetInterest(amount: number, rate: number, days: number): number {
  const gross = round2((amount * rate * days) / 36500)
  return round2(gross - belkaTax(gross))
}
