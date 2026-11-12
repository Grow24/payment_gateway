import type { Request, Response } from 'express'
import { BillingError } from '../domain/errors.js'
import {
  CHECKOUT_SIGNATURE,
  PROVIDER_ORDER_ID,
  PROVIDER_PAYMENT_ID,
  WEBHOOK_EVENT_ID,
} from '../domain/ids.js'
import { isBillingCycle, professionalPlan, quotePrice, TEST_AMOUNT_PAISE } from '../domain/plans.js'
import { formatInrFromPaise } from '../domain/money.js'
import type { BillingService } from '../billing/service.js'
import type { BillingStore } from '../billing/store.js'
import { verifyLicence, type LicenceKeys } from '../billing/licence.js'
import type { KeyMode } from '../config.js'
import type { PaymentProvider } from '../providers/types.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AppDeps = {
  billing: BillingService
  store: BillingStore
  provider: PaymentProvider
  licenceKeys: LicenceKeys
  keyMode: KeyMode
}

export function health(_req: Request, res: Response, deps: AppDeps): void {
  res.json({
    ok: true,
    service: 'pbmp-billing',
    provider: 'razorpay',
    keyMode: deps.keyMode,
    webhookConfigured: deps.provider.webhookConfigured,
    time: new Date().toISOString(),
    warning:
      deps.keyMode === 'live'
        ? 'Live Razorpay keys are configured. A successful checkout can move real money.'
        : null,
  })
}

export function plans(_req: Request, res: Response): void {
  res.json({
    plans: [professionalPlan],
    testAmount: {
      amount: TEST_AMOUNT_PAISE,
      currency: 'INR',
      display: formatInrFromPaise(TEST_AMOUNT_PAISE),
    },
    taxNote: '+ applicable tax',
    checkout: {
      provider: 'razorpay',
      mode: 'standard_checkout',
      recurring: false,
      note: 'This milestone creates one Razorpay order and activates an entitlement after capture. Razorpay Subscriptions are a later step.',
    },
  })
}

export async function createOrder(req: Request, res: Response, deps: AppDeps): Promise<void> {
  const body = asRecord(req.body)
  const cycle = body.cycle
  if (!isBillingCycle(cycle)) {
    throw new BillingError('invalid_request', 'Choose monthly or annual.', 400)
  }
  const organization = cleanText(body.organization, 2, 80, 'Organisation')
  const customerName = cleanText(body.customerName, 2, 80, 'Name')
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : ''
  if (!emailPattern.test(customerEmail) || customerEmail.length > 120) {
    throw new BillingError('invalid_request', 'Enter a valid email address.', 400)
  }
  const useTestAmount = body.useTestAmount === undefined ? true : body.useTestAmount === true

  const { order, keyId } = await deps.billing.createCheckout({
    cycle,
    useTestAmount,
    organization,
    customerName,
    customerEmail,
  })
  if (!order.providerOrderId) {
    throw new BillingError('provider_error', 'Razorpay order id is missing', 502)
  }

  const quote = quotePrice(order.cycle, order.testAmount)
  res.status(201).json({
    localOrderId: order.id,
    provider: 'razorpay',
    keyId,
    orderId: order.providerOrderId,
    amount: order.amount,
    currency: order.currency,
    display: quote.display,
    periodLabel: quote.periodLabel,
    taxNote: quote.taxNote,
    planName: order.planName,
    description: `${order.planName} · ${order.cycle}`,
    cycle: order.cycle,
    testAmount: order.testAmount,
    organization: order.organization,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
  })
}

export async function verifyPayment(req: Request, res: Response, deps: AppDeps): Promise<void> {
  const body = asRecord(req.body)
  const orderId = expectPattern(body.razorpay_order_id, PROVIDER_ORDER_ID, 'Razorpay order id')
  const paymentId = expectPattern(body.razorpay_payment_id, PROVIDER_PAYMENT_ID, 'Razorpay payment id')
  const signature = expectPattern(body.razorpay_signature, CHECKOUT_SIGNATURE, 'Razorpay signature')
  const result = await deps.billing.confirmCheckout({ orderId, paymentId, signature })
  res.json(confirmationBody(result))
}

export async function razorpayWebhook(req: Request, res: Response, deps: AppDeps): Promise<void> {
  if (!deps.provider.webhookConfigured) {
    throw new BillingError(
      'webhook_not_configured',
      'Set RAZORPAY_WEBHOOK_SECRET before accepting Razorpay webhooks.',
      503,
    )
  }
  const signature = headerValue(req.header('x-razorpay-signature'))
  const eventId = headerValue(req.header('x-razorpay-event-id'))
  if (!Buffer.isBuffer(req.body)) {
    throw new BillingError('invalid_request', 'Webhook body must be the raw JSON payload.', 400)
  }
  if (!eventId || !WEBHOOK_EVENT_ID.test(eventId)) {
    throw new BillingError('invalid_request', 'Webhook event id is missing.', 400)
  }
  if (!deps.provider.verifyWebhookSignature(req.body, signature)) {
    throw new BillingError('invalid_webhook_signature', 'Webhook signature did not match.', 400)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(req.body.toString('utf8')) as unknown
  } catch {
    throw new BillingError('invalid_request', 'Webhook body is not JSON.', 400)
  }

  const event = readWebhook(parsed)
  const result = await deps.billing.acceptWebhook({
    eventId,
    eventName: event.eventName,
    providerOrderId: event.providerOrderId,
    providerPaymentId: event.providerPaymentId,
    failed: event.failed,
    failureReason: event.failureReason,
  })
  res.json({ ok: true, duplicate: result.duplicate, settled: result.settled })
}

export function devState(_req: Request, res: Response, deps: AppDeps): void {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_STATE !== 'true') {
    throw new BillingError('not_available', 'The local ledger view is disabled on the deployed service.', 404)
  }
  if (deps.keyMode === 'live') {
    throw new BillingError('not_available', 'The local ledger view is disabled while live Razorpay keys are configured.', 404)
  }
  const state = deps.store.view()
  const recent = Object.values(state.orders)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
    .map((order) => ({
      localOrderId: order.id,
      providerOrderId: order.providerOrderId,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      organization: order.organization,
      entitlement: Boolean(state.entitlements[order.id]),
    }))
  res.json({
    orders: Object.keys(state.orders).length,
    payments: Object.keys(state.payments).length,
    entitlements: Object.keys(state.entitlements).length,
    receipts: Object.keys(state.receipts).length,
    webhookEvents: Object.values(state.webhookEvents),
    recent,
  })
}

export function publicLicenceKey(_req: Request, res: Response, deps: AppDeps): void {
  res.json({
    algorithm: 'Ed25519',
    publicKeyPem: deps.licenceKeys.publicKeyPem,
    note: 'A desktop build may embed this public key. The private key stays on the billing server.',
  })
}

export function verifyLicenceToken(req: Request, res: Response, deps: AppDeps): void {
  const body = asRecord(req.body)
  const token = typeof body.licence === 'string' ? body.licence : ''
  const claims = verifyLicence(token, deps.licenceKeys.publicKey)
  if (!claims) {
    throw new BillingError('invalid_licence', 'Licence signature is not valid.', 400)
  }
  res.json({ valid: true, claims })
}

function confirmationBody(result: Awaited<ReturnType<BillingService['confirmCheckout']>>) {
  return {
    ok: true,
    duplicate: result.duplicate,
    status: result.order.status,
    paymentStatus: result.payment.status,
    order: {
      id: result.order.id,
      providerOrderId: result.order.providerOrderId,
      amount: result.order.amount,
      currency: result.order.currency,
      status: result.order.status,
      planName: result.order.planName,
      cycle: result.order.cycle,
      organization: result.order.organization,
    },
    payment: {
      id: result.payment.id,
      status: result.payment.status,
      method: result.payment.method,
      amount: result.payment.amount,
      currency: result.payment.currency,
    },
    entitlement: result.entitlement,
    receipt: result.receipt,
  }
}

function readWebhook(value: unknown): {
  eventName: string
  providerOrderId: string | null
  providerPaymentId: string | null
  failed: boolean
  failureReason: string | null
} {
  const body = asRecord(value)
  const eventName = typeof body.event === 'string' ? body.event : ''
  const payload = asRecord(body.payload)
  const paymentWrapper = asRecord(payload.payment)
  const payment = asRecord(paymentWrapper.entity)
  const orderId = typeof payment.order_id === 'string' ? payment.order_id : null
  const paymentId = typeof payment.id === 'string' ? payment.id : null
  const safeOrderId = orderId && PROVIDER_ORDER_ID.test(orderId) ? orderId : null
  const safePaymentId = paymentId && PROVIDER_PAYMENT_ID.test(paymentId) ? paymentId : null
  const failed = eventName === 'payment.failed'
  const errorDescription = asRecord(payment.error).description
  return {
    eventName: eventName || 'unknown',
    providerOrderId: safeOrderId,
    providerPaymentId: safePaymentId,
    failed,
    failureReason: typeof errorDescription === 'string' ? errorDescription : null,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function cleanText(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string') {
    throw new BillingError('invalid_request', `${label} is required.`, 400)
  }
  const cleaned = value.trim().replace(/\s+/g, ' ')
  if (cleaned.length < min || cleaned.length > max) {
    throw new BillingError('invalid_request', `${label} must be ${min}–${max} characters.`, 400)
  }
  return cleaned
}

function expectPattern(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new BillingError('invalid_request', `${label} is not valid.`, 400)
  }
  return value
}

function headerValue(value: string | undefined): string {
  return (value ?? '').trim()
}
