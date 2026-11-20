import type { PlannedExpense } from '@core/planner'

/** What the user answers in the planner wizard (stored per person, on the device). */
export interface PlannerState {
  currency: 'PLN' | 'CHF'
  monthlyIncome: number
  monthlyExpenses: number
  earners: number
  adults: number
  children: { birth: string }[]
  job: 'stable' | 'variable' | 'none'
  residence: 'PL' | 'CH' | 'other'
  cash: number
  cashCurrency: 'PLN' | 'CHF'
  debtMonthly: number
  expensiveDebt: number
  planned: PlannedExpense[]
  answers: [number, number, number, number, number]
  horizonYears: number
  childGoal: number
  includeExisting: boolean
}

export const DEFAULT_PLANNER = (country: 'PL' | 'CH'): PlannerState => ({
  currency: country === 'CH' ? 'CHF' : 'PLN',
  monthlyIncome: 0,
  monthlyExpenses: 0,
  earners: 1,
  adults: 2,
  children: [],
  job: 'stable',
  residence: country,
  cash: 0,
  cashCurrency: country === 'CH' ? 'CHF' : 'PLN',
  debtMonthly: 0,
  expensiveDebt: 0,
  planned: [],
  answers: [3, 3, 3, 3, 3],
  horizonYears: 10,
  childGoal: 0,
  includeExisting: true,
})
