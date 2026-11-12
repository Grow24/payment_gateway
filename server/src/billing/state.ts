import type { BillingCycle } from '../domain/plans.js'

export type OrderStatus = 'created' | 'pending_payment' | 'paid' | 'payment_failed' | 'order_failed'

export type OrderRecord = {
  id: string
  planId: string
  planName: string
  cycle: BillingCycle
  amount: number
  currency: string
  display: string
  periodLabel: string
  taxNote: string
  testAmount: boolean
  organization: string
  customerName: string
  customerEmail: string
  status: OrderStatus
  provider: 'razorpay'
  providerOrderId: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

export type PaymentRecord = {
  id: string
  localOrderId: string
  providerOrderId: string
  amount: number
  currency: string
  status: 'captured' | 'failed' | 'authorized'
  method: string | null
  source: 'checkout' | 'webhook'
  createdAt: string
}

export type EntitlementRecord = {
  id: string
  localOrderId: string
  organization: string
  customerEmail: string
  planId: string
  planName: string
  cycle: BillingCycle
  status: 'active'
  amount: number
  currency: string
  activatedAt: string
  accessUntil: string
  offlineUntil: string
  providerPaymentId: string
  licenceToken: string
}

export type ReceiptRecord = {
  id: string
  localOrderId: string
  providerPaymentId: string
  organization: string
  customerName: string
  customerEmail: string
  planName: string
  cycle: BillingCycle
  amount: number
  currency: string
  display: string
  issuedAt: string
  kind: 'payment_receipt'
  taxInvoice: false
}

export type WebhookEventRecord = {
  id: string
  event: string
  receivedAt: string
  duplicates: number
}

export type BillingState = {
  orders: Record<string, OrderRecord>
  ordersByProvider: Record<string, string>
  payments: Record<string, PaymentRecord>
  entitlements: Record<string, EntitlementRecord>
  receipts: Record<string, ReceiptRecord>
  webhookEvents: Record<string, WebhookEventRecord>
}

export function emptyState(): BillingState {
  return {
    orders: {},
    ordersByProvider: {},
    payments: {},
    entitlements: {},
    receipts: {},
    webhookEvents: {},
  }
}
