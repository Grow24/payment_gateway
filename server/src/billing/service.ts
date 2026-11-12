import { BillingError, isBillingError } from '../domain/errors.js'
import { newId } from '../domain/ids.js'
import { addUtcDays, addUtcMonths } from '../domain/money.js'
import { quotePrice, type BillingCycle } from '../domain/plans.js'
import type { PaymentProvider, ProviderPayment } from '../providers/types.js'
import { signLicence, type LicenceKeys } from './licence.js'
import type { BillingStore } from './store.js'
import type {
  EntitlementRecord,
  OrderRecord,
  PaymentRecord,
  ReceiptRecord,
} from './state.js'

export type CheckoutRequest = {
  cycle: BillingCycle
  useTestAmount: boolean
  organization: string
  customerName: string
  customerEmail: string
}

export type Confirmation = {
  duplicate: boolean
  order: OrderRecord
  payment: PaymentRecord
  entitlement: EntitlementRecord
  receipt: ReceiptRecord
}

export class BillingService {
  constructor(
    private readonly store: BillingStore,
    private readonly provider: PaymentProvider,
    private readonly licenceKeys: LicenceKeys,
    private readonly offlineDays: number,
  ) {}

  async createCheckout(input: CheckoutRequest): Promise<{ order: OrderRecord; keyId: string }> {
    const quote = quotePrice(input.cycle, input.useTestAmount)
    const now = new Date().toISOString()
    const order: OrderRecord = {
      id: newId('ord'),
      planId: quote.planId,
      planName: quote.planName,
      cycle: quote.cycle,
      amount: quote.amount,
      currency: quote.currency,
      display: quote.display,
      periodLabel: quote.periodLabel,
      taxNote: quote.taxNote,
      testAmount: quote.testAmount,
      organization: input.organization,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      status: 'created',
      provider: 'razorpay',
      providerOrderId: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    }

    await this.store.transaction((state) => {
      state.orders[order.id] = order
    })

    try {
      const providerOrder = await this.provider.createOrder({
        amount: order.amount,
        currency: order.currency,
        receipt: order.id.slice(0, 40),
        notes: {
          local_order_id: order.id,
          plan_id: order.planId,
          cycle: order.cycle,
          organization: order.organization.slice(0, 200),
          test_amount: String(order.testAmount),
        },
      })
      const pending = await this.store.transaction((state) => {
        const saved = state.orders[order.id]
        if (!saved) throw new BillingError('unknown_order', 'Order disappeared before Razorpay returned', 500)
        saved.providerOrderId = providerOrder.id
        saved.status = 'pending_payment'
        saved.updatedAt = new Date().toISOString()
        state.ordersByProvider[providerOrder.id] = saved.id
        return structuredClone(saved)
      })
      if (!this.provider.keyId) {
        throw new BillingError('razorpay_not_configured', 'Razorpay Key ID is missing', 503)
      }
      return { order: pending, keyId: this.provider.keyId }
    } catch (error) {
      await this.store.transaction((state) => {
        const saved = state.orders[order.id]
        if (!saved || saved.status === 'pending_payment') return
        saved.status = 'order_failed'
        saved.failureReason = error instanceof Error ? error.message : 'Order creation failed'
        saved.updatedAt = new Date().toISOString()
      })
      throw error
    }
  }

  async confirmCheckout(input: { orderId: string; paymentId: string; signature: string }): Promise<Confirmation> {
    const valid = this.provider.verifyCheckoutSignature(input)
    if (!valid) {
      throw new BillingError(
        'invalid_signature',
        'Payment signature did not match. No entitlement was granted.',
        400,
      )
    }
    return this.settleCapturedPayment({
      providerOrderId: input.orderId,
      providerPaymentId: input.paymentId,
      source: 'checkout',
    })
  }

  async settleCapturedPayment(input: {
    providerOrderId: string
    providerPaymentId: string
    source: 'checkout' | 'webhook'
  }): Promise<Confirmation> {
    const existing = await this.alreadySettled(input.providerOrderId, input.providerPaymentId)
    if (existing) return { ...existing, duplicate: true }

    let payment = await this.provider.fetchPayment(input.providerPaymentId)
    if (payment.orderId !== input.providerOrderId) {
      throw new BillingError('unknown_order', 'Payment does not belong to this Razorpay order', 409)
    }

    const order = await this.requireOrder(input.providerOrderId)
    if (payment.amount !== order.amount || payment.currency !== order.currency) {
      throw new BillingError(
        'amount_mismatch',
        'Razorpay payment amount does not match the PBMP order. No entitlement was granted.',
        409,
      )
    }

    if (payment.status === 'authorized') {
      payment = await this.provider.capturePayment(payment.id, order.amount, order.currency)
    }

    if (payment.status !== 'captured') {
      await this.markFailed(order.providerOrderId, payment, `Payment status is ${payment.status}`, input.source)
      throw new BillingError(
        'not_captured',
        `Payment is ${payment.status}. No entitlement was granted.`,
        409,
      )
    }

    return this.commitCapture(order.providerOrderId!, payment, input.source)
  }

  async markFailed(
    providerOrderId: string | null,
    payment: ProviderPayment | null,
    reason: string,
    source: 'checkout' | 'webhook',
  ): Promise<void> {
    await this.store.transaction((state) => {
      const localId = providerOrderId ? state.ordersByProvider[providerOrderId] : undefined
      const order = localId ? state.orders[localId] : undefined
      if (!order || order.status === 'paid') return
      order.status = 'payment_failed'
      order.failureReason = reason
      order.updatedAt = new Date().toISOString()
      if (payment && order.providerOrderId && state.payments[payment.id]?.status !== 'captured') {
        state.payments[payment.id] = {
          id: payment.id,
          localOrderId: order.id,
          providerOrderId: order.providerOrderId,
          amount: payment.amount,
          currency: payment.currency,
          status: 'failed',
          method: payment.method,
          source,
          createdAt: new Date().toISOString(),
        }
      }
    })
  }

  async acceptWebhook(input: {
    eventId: string
    eventName: string
    providerOrderId: string | null
    providerPaymentId: string | null
    failed: boolean
    failureReason: string | null
  }): Promise<{ duplicate: boolean; settled: boolean }> {
    const seen = await this.store.transaction((state) => state.webhookEvents[input.eventId] ?? null)
    if (seen) {
      await this.store.transaction((state) => {
        const event = state.webhookEvents[input.eventId]
        if (event) event.duplicates += 1
      })
      return { duplicate: true, settled: false }
    }

    let settled = false
    if (!input.failed && input.providerOrderId && input.providerPaymentId) {
      try {
        await this.settleCapturedPayment({
          providerOrderId: input.providerOrderId,
          providerPaymentId: input.providerPaymentId,
          source: 'webhook',
        })
        settled = true
      } catch (error) {
        const definitive = isBillingError(error) && (error.code === 'amount_mismatch' || error.code === 'not_captured')
        if (!definitive) throw error
      }
    } else if (input.failed) {
      const payment = input.providerPaymentId
        ? await this.provider.fetchPayment(input.providerPaymentId).catch(() => null)
        : null
      await this.markFailed(input.providerOrderId, payment, input.failureReason ?? 'Payment failed', 'webhook')
    }

    await this.store.transaction((state) => {
      if (!state.webhookEvents[input.eventId]) {
        state.webhookEvents[input.eventId] = {
          id: input.eventId,
          event: input.eventName,
          receivedAt: new Date().toISOString(),
          duplicates: 0,
        }
      }
    })
    return { duplicate: false, settled }
  }

  private async alreadySettled(providerOrderId: string, providerPaymentId: string): Promise<Omit<Confirmation, 'duplicate'> | null> {
    return this.store.transaction((state) => {
      const payment = state.payments[providerPaymentId]
      const localId = state.ordersByProvider[providerOrderId]
      if (!payment || payment.status !== 'captured' || !localId) return null
      const order = state.orders[localId]
      const entitlement = state.entitlements[localId]
      const receipt = Object.values(state.receipts).find((item) => item.localOrderId === localId)
      if (!order || !entitlement || !receipt) return null
      return {
        order: structuredClone(order),
        payment: structuredClone(payment),
        entitlement: structuredClone(entitlement),
        receipt: structuredClone(receipt),
      }
    })
  }

  private async requireOrder(providerOrderId: string): Promise<OrderRecord> {
    return this.store.transaction((state) => {
      const localId = state.ordersByProvider[providerOrderId]
      const order = localId ? state.orders[localId] : undefined
      if (!order?.providerOrderId) {
        throw new BillingError('unknown_order', 'No PBMP order matches this Razorpay order', 404)
      }
      return structuredClone(order)
    })
  }

  private async commitCapture(
    providerOrderId: string,
    payment: ProviderPayment,
    source: 'checkout' | 'webhook',
  ): Promise<Confirmation> {
    const keys = this.licenceKeys
    const offlineDays = this.offlineDays
    return this.store.transaction((state) => {
      const localId = state.ordersByProvider[providerOrderId]
      const order = localId ? state.orders[localId] : undefined
      if (!order) throw new BillingError('unknown_order', 'No PBMP order matches this Razorpay order', 404)
      if (payment.amount !== order.amount || payment.currency !== order.currency || payment.orderId !== order.providerOrderId) {
        throw new BillingError('amount_mismatch', 'Captured payment does not match the PBMP order', 409)
      }

      const now = new Date().toISOString()
      const duplicate = Boolean(state.entitlements[order.id])
      const record: PaymentRecord = state.payments[payment.id]?.status === 'captured'
        ? state.payments[payment.id]
        : {
            id: payment.id,
            localOrderId: order.id,
            providerOrderId,
            amount: payment.amount,
            currency: payment.currency,
            status: 'captured',
            method: payment.method,
            source,
            createdAt: now,
          }
      state.payments[payment.id] = record
      order.status = 'paid'
      order.failureReason = null
      order.updatedAt = now

      let entitlement = state.entitlements[order.id]
      if (!entitlement) {
        const activatedAt = now
        const accessUntil = order.cycle === 'annual' ? addUtcMonths(activatedAt, 12) : addUtcMonths(activatedAt, 1)
        const offlineUntil = addUtcDays(activatedAt, offlineDays)
        entitlement = {
          id: newId('ent'),
          localOrderId: order.id,
          organization: order.organization,
          customerEmail: order.customerEmail,
          planId: order.planId,
          planName: order.planName,
          cycle: order.cycle,
          status: 'active',
          amount: order.amount,
          currency: order.currency,
          activatedAt,
          accessUntil,
          offlineUntil,
          providerPaymentId: payment.id,
          licenceToken: '',
        }
        entitlement.licenceToken = signLicence(
          {
            v: 1,
            entitlementId: entitlement.id,
            organization: entitlement.organization,
            planId: entitlement.planId,
            cycle: entitlement.cycle,
            status: 'active',
            activatedAt,
            accessUntil,
            offlineUntil,
            orderId: order.id,
            paymentId: payment.id,
            amount: order.amount,
            currency: order.currency,
          },
          keys,
        )
        state.entitlements[order.id] = entitlement
      }

      let receipt = Object.values(state.receipts).find((item) => item.localOrderId === order.id)
      if (!receipt) {
        receipt = {
          id: newId('rcpt'),
          localOrderId: order.id,
          providerPaymentId: payment.id,
          organization: order.organization,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          planName: order.planName,
          cycle: order.cycle,
          amount: order.amount,
          currency: order.currency,
          display: order.display,
          issuedAt: now,
          kind: 'payment_receipt',
          taxInvoice: false,
        }
        state.receipts[receipt.id] = receipt
      }

      return {
        duplicate,
        order: structuredClone(order),
        payment: structuredClone(record),
        entitlement: structuredClone(entitlement),
        receipt: structuredClone(receipt),
      }
    })
  }
}
