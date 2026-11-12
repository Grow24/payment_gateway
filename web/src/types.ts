export type BillingCycle = 'monthly' | 'annual'
export type KeyMode = 'test' | 'live' | 'missing'

export type Health = {
  ok: boolean
  service: string
  provider: string
  keyMode: KeyMode
  webhookConfigured: boolean
  time: string
  warning: string | null
}

export type PlanPrice = {
  amount: number
  currency: string
  display: string
  periodLabel: string
}

export type PlansResponse = {
  plans: Array<{
    id: string
    name: string
    illustrative: boolean
    cycles: Record<BillingCycle, PlanPrice>
  }>
  testAmount: { amount: number; currency: string; display: string }
  taxNote: string
  checkout: { provider: string; mode: string; recurring: boolean; note: string }
}

export type CheckoutOrder = {
  localOrderId: string
  provider: 'razorpay'
  keyId: string
  orderId: string
  amount: number
  currency: string
  display: string
  periodLabel: string
  taxNote: string
  planName: string
  description: string
  cycle: BillingCycle
  testAmount: boolean
  organization: string
  customerName: string
  customerEmail: string
}

export type Confirmation = {
  ok: boolean
  duplicate: boolean
  status: string
  paymentStatus: string
  order: {
    id: string
    providerOrderId: string
    amount: number
    currency: string
    status: string
    planName: string
    cycle: BillingCycle
    organization: string
  }
  payment: {
    id: string
    status: string
    method: string | null
    amount: number
    currency: string
  }
  entitlement: {
    id: string
    status: string
    accessUntil: string
    offlineUntil: string
    licenceToken: string
    planName: string
    organization: string
  }
  receipt: {
    id: string
    display: string
    issuedAt: string
    kind: string
    taxInvoice: false
  }
}

export type DevState = {
  orders: number
  payments: number
  entitlements: number
  receipts: number
  webhookEvents: Array<{ id: string; event: string; receivedAt: string; duplicates: number }>
  recent: Array<{
    localOrderId: string
    providerOrderId: string | null
    status: string
    amount: number
    currency: string
    organization: string
    entitlement: boolean
  }>
}

export type ApiError = {
  message: string
  code?: string
}
