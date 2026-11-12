import { formatInrFromPaise } from './money.js'

export const PROFESSIONAL_PLAN_ID = 'pbmp-professional'
export const TEST_AMOUNT_PAISE = 9_900
export const CURRENCY = 'INR'

export type BillingCycle = 'monthly' | 'annual'

export type PlanPrice = {
  amount: number
  currency: typeof CURRENCY
  display: string
  periodLabel: string
}

export type Plan = {
  id: typeof PROFESSIONAL_PLAN_ID
  name: string
  illustrative: true
  cycles: Record<BillingCycle, PlanPrice>
}

const monthlyAmount = 99_900
const annualAmount = 999_000

export const professionalPlan: Plan = {
  id: PROFESSIONAL_PLAN_ID,
  name: 'PBMP Professional',
  illustrative: true,
  cycles: {
    monthly: {
      amount: monthlyAmount,
      currency: CURRENCY,
      display: formatInrFromPaise(monthlyAmount),
      periodLabel: '/month',
    },
    annual: {
      amount: annualAmount,
      currency: CURRENCY,
      display: formatInrFromPaise(annualAmount),
      periodLabel: '/year',
    },
  },
}

export function isBillingCycle(value: unknown): value is BillingCycle {
  return value === 'monthly' || value === 'annual'
}

export type PriceQuote = PlanPrice & {
  planId: typeof PROFESSIONAL_PLAN_ID
  planName: string
  cycle: BillingCycle
  testAmount: boolean
  taxNote: string
}

export function quotePrice(cycle: BillingCycle, useTestAmount: boolean): PriceQuote {
  const planPrice = professionalPlan.cycles[cycle]
  const amount = useTestAmount ? TEST_AMOUNT_PAISE : planPrice.amount
  return {
    planId: professionalPlan.id,
    planName: professionalPlan.name,
    cycle,
    amount,
    currency: CURRENCY,
    display: formatInrFromPaise(amount),
    periodLabel: planPrice.periodLabel,
    testAmount: useTestAmount,
    taxNote: '+ applicable tax',
  }
}
