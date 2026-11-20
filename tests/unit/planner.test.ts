import { describe, expect, it } from 'vitest'
import { buildPlan, riskScore, reserveMonths, benefitReceived, ageYears, expectedReal, momentumTilt, SPLITS, type PlanInput } from '@core/planner'

const offer = [
  { code: 'OTS' as const, series: 'OTS0227', firstRate: 2, margin: 0 },
  { code: 'TOS' as const, series: 'TOS1129', firstRate: 4.4, margin: 0 },
  { code: 'COI' as const, series: 'COI1130', firstRate: 4.75, margin: 1.5 },
  { code: 'EDO' as const, series: 'EDO1136', firstRate: 5.35, margin: 2 },
  { code: 'ROS' as const, series: 'ROS1132', firstRate: 5, margin: 2 },
  { code: 'ROD' as const, series: 'ROD1138', firstRate: 5.6, margin: 2.5 },
]
/** a fictitious family: one earner, partner at home, one small child, living in Switzerland, expenses in CHF */
const base: PlanInput = {
  asOf: '2026-11-20',
  currency: 'CHF',
  chfRate: 4.8,
  monthlyIncome: 9000,
  monthlyExpenses: 6000,
  earners: 1,
  adults: 2,
  children: [{ birth: '2023-03-15' }],
  job: 'stable',
  residence: 'CH',
  cash: 100_000,
  cashCurrency: 'PLN',
  debtMonthly: 0,
  expensiveDebt: 0,
  planned: [],
  answers: [3, 3, 3, 3, 3],
  horizonYears: 15,
  family800: false,
  usesIke: false,
  usesIkze: false,
  existing: { safe: 0, balanced: 0, growth: 0, largestStockShare: 0 },
  market: { offer, cpi: 3.5, refRate: 3.75, wigSignal: 'buy', worldSignal: 'buy', plMood: 'neutral', worldMood: 'neutral', momentum: { world: 0.1, poland: 0.1 } },
}
const sumItems = (p: ReturnType<typeof buildPlan>) => p.items.reduce((a, i) => a + i.amount, 0)

describe('risk profile', () => {
  it('average of the answers, limited by the horizon', () => {
    expect(riskScore([5, 5, 5, 5, 5], 20)).toBe(5)
    expect(riskScore([5, 5, 5, 5, 5], 6)).toBe(4)
    expect(riskScore([5, 5, 5, 5, 5], 4)).toBe(2)
    expect(riskScore([5, 5, 5, 5, 5], 2)).toBe(1)
    expect(riskScore([1, 2, 3, 4, 5], 20)).toBe(3)
    expect(riskScore([1, 1, 1, 1, 2], 20)).toBe(1)
    expect(riskScore([NaN, 9, 0, 4, 4], 20)).toBe(4) // invalid answers ignored
    expect(riskScore([], 20)).toBe(3)
  })
  it('splits add up to 100 % and get riskier step by step', () => {
    for (const r of [1, 2, 3, 4, 5] as const) expect(SPLITS[r].safe + SPLITS[r].balanced + SPLITS[r].growth).toBeCloseTo(1, 12)
    for (const r of [2, 3, 4, 5] as const) expect(SPLITS[r].growth).toBeGreaterThan(SPLITS[(r - 1) as 1].growth)
    for (const r of [2, 3, 4, 5] as const) expect(expectedReal(SPLITS[r])).toBeGreaterThan(expectedReal(SPLITS[(r - 1) as 1]))
  })
})

describe('emergency fund size', () => {
  it('6 months base, +3 for one earner with a family, +3 irregular income, 12 without income', () => {
    expect(reserveMonths({ earners: 2, adults: 2, children: [], job: 'stable' })).toBe(6)
    expect(reserveMonths({ earners: 1, adults: 2, children: [{ birth: '2023-03-15' }], job: 'stable' })).toBe(9)
    expect(reserveMonths({ earners: 1, adults: 1, children: [], job: 'variable' })).toBe(9)
    expect(reserveMonths({ earners: 1, adults: 2, children: [], job: 'variable' })).toBe(12)
    expect(reserveMonths({ earners: 0, adults: 2, children: [], job: 'stable' })).toBe(12)
    expect(reserveMonths({ earners: 2, adults: 2, children: [], job: 'none' })).toBe(12)
  })
})

describe('800+ received (limit for family bonds)', () => {
  it('500 zł until 12/2023, 800 zł from 1/2024, from the month of birth', () => {
    // March 2023 – December 2023 = 10 × 500; January 2024 – November 2026 = 35 × 800
    expect(benefitReceived('2023-03-15', '2026-11-20')).toBe(10 * 500 + 35 * 800)
    expect(benefitReceived('2025-06-01', '2025-06-30')).toBe(800)
    expect(benefitReceived('2000-01-01', '2026-11-20')).toBe(0) // grown up before the benefit existed
  })
  it('age', () => {
    expect(ageYears('2023-03-15', '2026-03-15')).toBeCloseTo(3, 2)
  })
})

describe('the plan', () => {
  const p = buildPlan(base)
  it('converts CHF to PLN, computes the monthly surplus and savings rate', () => {
    expect(p.monthlyIncomePln).toBe(43_200)
    expect(p.monthlyExpensesPln).toBe(28_800)
    expect(p.surplusPln).toBe(14_400)
    expect(p.savingsRate).toBeCloseTo(1 / 3, 10)
  })
  it('emergency fund first: 9 months for one earner with a child, kept in CHF', () => {
    expect(p.reserve).toMatchObject({ months: 9, target: 259_200, have: 0, gap: 259_200, currency: 'CHF' })
    const r = p.items.find((i) => i.id === 'reserve')!
    expect(r.amount).toBe(100_000) // all cash goes to the reserve while it is not full
    expect(r.why).toBe('plan.why.reserveChf')
    expect(p.investable).toBe(0)
    expect(p.monthly.toReserve).toBe(14_400)
    expect(p.monthly.monthsToFillReserve).toBe(Math.ceil(159_200 / 14_400))
  })
  it('never plans more money than there is', () => {
    expect(sumItems(p)).toBeLessThanOrEqual(100_000 + 1e-6)
    const rich = buildPlan({ ...base, cash: 2_000_000 })
    expect(sumItems(rich)).toBeCloseTo(2_000_000, 2)
    expect(rich.totals.safe + rich.totals.balanced + rich.totals.growth).toBeCloseTo(2_000_000, 2)
  })
  it('with enough cash (Poland): reserve, then the long-term split of the risk profile', () => {
    const rich = buildPlan({ ...base, residence: 'PL', cash: 1_000_000 })
    const long = 1_000_000 - 259_200
    expect(rich.investable).toBeCloseTo(long, 2)
    expect(rich.totals.growth).toBeCloseTo(long * SPLITS[3].growth, 0)
    expect(rich.items.map((i) => i.id)).toEqual(expect.arrayContaining(['reserve', 'safe-tos', 'edo', 'etf-world', 'etf-poland', 'gold']))
    const g = rich.items.filter((i) => i.bucket === 'growth')
    expect(g.find((i) => i.id === 'gold')!.amount).toBeCloseTo(rich.totals.growth * 0.1, 0)
    expect(g.find((i) => i.id === 'etf-world')!.amount).toBeGreaterThan(g.find((i) => i.id === 'etf-poland')!.amount)
  })
  it('existing investments count: new money fills what is missing in each bucket', () => {
    const p2 = buildPlan({ ...base, cash: 500_000, existing: { safe: 300_000, balanced: 1_000_000, growth: 0, largestStockShare: 0 } })
    // lots of inflation bonds already → the new money goes mostly to growth
    expect(p2.totals.growth).toBeGreaterThan(p2.totals.balanced)
    expect(p2.items.find((i) => i.id === 'reserve')).toBeUndefined() // the reserve is already covered
  })
  it('expensive debt is repaid before anything else', () => {
    const d = buildPlan({ ...base, cash: 50_000, expensiveDebt: 20_000 })
    expect(d.items[0]).toMatchObject({ id: 'repay-debt', amount: 20_000 })
    expect(d.warnings.map((w) => w.key)).toContain('plan.warn.debt')
    expect(sumItems(d)).toBeLessThanOrEqual(50_000)
  })
  it('known expenses within 3 years are kept safe and matched to their date', () => {
    const rich = buildPlan({ ...base, residence: 'PL', cash: 800_000, planned: [{ name: 'auto', amount: 10_000, inMonths: 10 }, { name: 'remont', amount: 5_000, inMonths: 30 }, { name: 'dom', amount: 100_000, inMonths: 60 }] })
    expect(rich.items.find((i) => i.id === 'planned-auto')).toMatchObject({ amount: 48_000, why: 'plan.why.planned.deposit' })
    expect(rich.items.find((i) => i.id === 'planned-remont')).toMatchObject({ amount: 24_000, why: 'plan.why.planned.tos' })
    expect(rich.items.find((i) => i.id === 'planned-dom')).toBeUndefined() // > 3 years → long-term money
    expect(rich.plannedSafe).toBe(72_000)
    const soon = buildPlan({ ...base, residence: 'PL', currency: 'PLN', cash: 800_000, planned: [{ name: 'x', amount: 1000, inMonths: 2 }, { name: 'y', amount: 1000, inMonths: 20 }] })
    expect(soon.items.find((i) => i.id === 'planned-x')?.why).toBe('plan.why.planned.savings')
    expect(soon.items.find((i) => i.id === 'planned-y')?.why).toBe('plan.why.planned.ots-roll')
  })
  it('Polish residents with 800+: family bonds first, up to the benefits received, then EDO; IKE/IKZE in the checklist', () => {
    const pl = buildPlan({ ...base, residence: 'PL', currency: 'PLN', monthlyIncome: 15_000, monthlyExpenses: 8_000, family800: true, cash: 600_000 })
    const rod = pl.items.find((i) => i.id === 'rod')!
    expect(pl.rodLimit).toBe(33_000)
    expect(rod.amount).toBe(33_000)
    expect(rod.amount % 100).toBe(0)
    expect(pl.items.find((i) => i.id === 'edo')!.params?.ike).toBe(1)
    expect(pl.checklist.map((c) => c.id)).toEqual(expect.arrayContaining(['c-ikze', 'c-bonds']))
    expect(pl.checklist.find((c) => c.id === 'c-broker')?.key).toBe('plan.do.brokerIke')
    expect(pl.warnings.map((w) => w.key)).not.toContain('plan.warn.residence')
  })
  it('Switzerland: CHF reserve and savings, CHF bonds, pillar 3a first, world + Swiss equities, no Polish products', () => {
    const ch = buildPlan({ ...base, cash: 1_000_000, planned: [{ name: 'auto', amount: 10_000, inMonths: 10 }] })
    const ids = ch.items.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['reserve', 'planned-auto', 'safe-chf', 'chf-bonds', 'pillar3a', 'etf-world', 'etf-swiss', 'gold']))
    for (const pl of ['safe-tos', 'edo', 'rod', 'coi', 'etf-poland']) expect(ids).not.toContain(pl)
    expect(ch.items.find((i) => i.id === 'planned-auto')?.why).toBe('plan.why.planned.chf')
    // pillar 3a: at most the yearly limit for one earner (7 258 CHF × 4.8) and at most half of the growth part
    const p3a = ch.items.find((i) => i.id === 'pillar3a')!.amount
    expect(p3a).toBeCloseTo(Math.min(7258 * 4.8, ch.totals.growth * 0.5), 2)
    expect(ch.checklist.map((c) => c.id)).toEqual(expect.arrayContaining(['c-3a', 'c-broker']))
    expect(ch.checklist.find((c) => c.id === 'c-broker')?.key).toBe('plan.do.brokerCh')
    expect(ch.checklist.map((c) => c.id)).not.toContain('c-ikze')
    const g = ch.items.filter((i) => i.bucket === 'growth').reduce((a, i) => a + i.amount, 0)
    expect(g).toBeCloseTo(ch.totals.growth, 2)
    // two earners → twice the 3a limit
    const two = buildPlan({ ...base, cash: 5_000_000, earners: 2 })
    expect(two.items.find((i) => i.id === 'pillar3a')!.amount).toBeCloseTo(2 * 7258 * 4.8, 2)
  })
  it('no family bonds abroad or for a short horizon; COI for 4–9 years', () => {
    expect(buildPlan({ ...base, family800: true, cash: 600_000 }).items.find((i) => i.id === 'rod')).toBeUndefined()
    const mid = buildPlan({ ...base, residence: 'PL', family800: true, cash: 600_000, horizonYears: 6, answers: [4, 4, 4, 4, 4] })
    expect(mid.items.find((i) => i.id === 'rod')).toBeUndefined()
    expect(mid.items.find((i) => i.id === 'coi')).toBeDefined()
  })
  it('very cautious profile: no equities at all', () => {
    const c = buildPlan({ ...base, cash: 1_000_000, answers: [1, 1, 1, 1, 1] })
    expect(c.totals.growth).toBe(0)
    expect(c.items.filter((i) => i.bucket === 'growth')).toEqual([])
    expect(c.entry).toMatchObject({ mode: 'lump', reason: 'plan.entry.none' })
  })
  it('entry pace: staged in a downtrend, in euphoria or for cautious investors; at once otherwise', () => {
    const bold = { ...base, residence: 'PL' as const, cash: 1_000_000, answers: [5, 5, 5, 5, 5] as PlanInput['answers'] }
    expect(buildPlan(bold).entry).toMatchObject({ mode: 'lump', reason: 'plan.entry.lump' })
    expect(buildPlan({ ...bold, market: { ...base.market, wigSignal: 'sell' } }).entry).toMatchObject({ mode: 'staged', months: 6, reason: 'plan.entry.downtrend' })
    expect(buildPlan({ ...bold, market: { ...base.market, worldMood: 'extreme-greed' } }).entry.reason).toBe('plan.entry.euphoria')
    expect(buildPlan({ ...base, cash: 1_000_000 }).entry.reason).toBe('plan.entry.comfort')
    const staged = buildPlan({ ...bold, market: { ...base.market, wigSignal: 'sell' } })
    const tranches = staged.checklist.filter((c) => c.id.startsWith('c-tranche'))
    expect(tranches).toHaveLength(6)
    expect(tranches.reduce((a, c) => a + Number(c.params!.amount), 0)).toBeCloseTo(staged.totals.growth, 0)
  })
  it('momentum tilt between Poland and the world is small and bounded', () => {
    expect(momentumTilt({ world: 0.1, poland: 0.1 })).toBe(0)
    expect(momentumTilt({ world: 0, poland: 0.4 })).toBe(0.05)
    expect(momentumTilt({ world: 0.4, poland: -0.2 })).toBe(-0.05)
    expect(momentumTilt({ world: 0.1 })).toBe(0)
  })
  it('warnings: one earner, exchange-rate risk, residence, concentration, deficit, low savings', () => {
    const keys = p.warnings.map((w) => w.key)
    expect(keys).toEqual(expect.arrayContaining(['plan.warn.oneEarner', 'plan.warn.fx']))
    expect(keys).not.toContain('plan.warn.residence') // Switzerland is supported
    expect(buildPlan({ ...base, residence: 'other' }).warnings.map((w) => w.key)).toContain('plan.warn.residence')
    expect(buildPlan({ ...base, existing: { ...base.existing, plnShare: 0.8 } }).warnings.find((w) => w.key === 'plan.warn.fxAssets')?.params?.share).toBe(80)
    expect(buildPlan({ ...base, existing: { ...base.existing, largestStockShare: 0.3 } }).warnings.map((w) => w.key)).toContain('plan.warn.concentration')
    const deficit = buildPlan({ ...base, monthlyExpenses: 10_000 })
    expect(deficit.warnings.find((w) => w.key === 'plan.warn.deficit')?.params?.amount).toBe(4_800)
    expect(deficit.monthly.toReserve).toBe(0)
    expect(buildPlan({ ...base, monthlyExpenses: 8_500 }).warnings.map((w) => w.key)).toContain('plan.warn.lowSavings')
  })
  it('child goal at 18 in today’s money', () => {
    const c = buildPlan({ ...base, childGoal: 100_000 })
    expect(c.child!.years).toBeCloseTo(18 - ageYears('2023-03-15', '2026-11-20'), 2)
    expect(c.child!.monthly).toBeGreaterThan(0)
    expect(c.child!.monthly).toBeLessThan(100_000 / (c.child!.years * 12))
    expect(buildPlan(base).child).toBeUndefined()
  })
  it('checklist is in date order and ends with a review in 6 months', () => {
    const rich = buildPlan({ ...base, residence: 'PL', cash: 1_000_000 })
    const d = rich.checklist.map((c) => c.when)
    expect([...d].sort()).toEqual(d)
    expect(rich.checklist.find((c) => c.id === 'c-review')!.when).toBe('2027-05-20')
    expect(rich.checklist.find((c) => c.id === 'c-bonds')!.when).toBe('2026-11-30')
  })
  it('stress test: a crash costs about 45 % of the equity part; projections: the plan beats a deposit in the median', () => {
    const rich = buildPlan({ ...base, residence: 'PL', cash: 1_000_000, answers: [4, 4, 4, 4, 4] })
    expect(rich.stress.crashLoss).toBeCloseTo(rich.totals.growth * 0.9 * 0.45 - rich.totals.growth * 0.1 * 0.05, 0)
    expect(rich.stress.crashPct).toBeGreaterThan(0.1)
    expect(rich.stress.crashPct).toBeLessThan(0.45)
    const last = rich.projection.plan.at(-1)!
    const cash = rich.projection.cash.at(-1)!
    expect(last.p50).toBeGreaterThan(cash.p50)
    expect(rich.projection.probLoseReal).toBeLessThan(rich.projection.probLoseRealCash)
    // the deposit-only path is narrower (less risk) – the plan's range is wider
    expect(last.p90 - last.p10).toBeGreaterThan(cash.p90 - cash.p10)
  })
  it('scores are 0–100 and a riskier plan scores higher on growth, lower on safety', () => {
    const lo = buildPlan({ ...base, cash: 1_000_000, answers: [1, 1, 1, 1, 1] })
    const hi = buildPlan({ ...base, cash: 1_000_000, answers: [5, 5, 5, 5, 5] })
    for (const v of [...Object.values(lo.scores), ...Object.values(hi.scores)]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
    expect(hi.scores.growth).toBeGreaterThan(lo.scores.growth)
    expect(hi.scores.safety).toBeLessThan(lo.scores.safety)
    expect(hi.riskLabel).toBe('aggressive')
    expect(lo.riskLabel).toBe('very-cautious')
  })
  it('robust input handling: zero income, zero cash, missing CHF rate', () => {
    const z = buildPlan({ ...base, monthlyIncome: 0, cash: 0, chfRate: 0 })
    expect(z.items).toEqual([])
    expect(z.savingsRate).toBe(0)
    expect(Number.isFinite(z.stress.crashPct)).toBe(true)
  })
})
