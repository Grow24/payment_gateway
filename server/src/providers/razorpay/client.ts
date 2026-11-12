import { createRequire } from 'node:module'
import { BillingError } from '../../domain/errors.js'
import type { ProviderPayment, ProviderPaymentStatus } from '../types.js'

const require = createRequire(import.meta.url)

type RazorpayOrder = {
  id?: string
  amount?: number | string
  currency?: string
}

type RazorpayPayment = {
  id?: string
  order_id?: string
  amount?: number | string
  currency?: string
  status?: string
  method?: string
  card?: unknown
  vpa?: unknown
  bank?: unknown
  acquirer_data?: unknown
}

type RazorpayClient = {
  orders: {
    create(body: Record<string, unknown>): Promise<RazorpayOrder>
  }
  payments: {
    fetch(id: string): Promise<RazorpayPayment>
    capture(id: string, amount: number, currency: string): Promise<RazorpayPayment>
  }
}

type RazorpayConstructor = new (options: { key_id: string; key_secret: string }) => RazorpayClient

const RazorpaySdk = require('razorpay') as RazorpayConstructor

const statuses = new Set<ProviderPaymentStatus>(['created', 'authorized', 'captured', 'failed', 'refunded'])

export class RazorpayClientError extends BillingError {
  constructor(message: string) {
    super('provider_error', message, 502)
  }
}

export function createRazorpayClient(keyId: string, keySecret: string): RazorpayClient {
  return new RazorpaySdk({ key_id: keyId, key_secret: keySecret })
}

export async function createRazorpayOrder(
  client: RazorpayClient,
  input: { amount: number; currency: string; receipt: string; notes: Record<string, string> },
): Promise<{ id: string }> {
  try {
    const order = await client.orders.create({
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    })
    if (!order.id) throw new RazorpayClientError('Razorpay did not return an order id')
    return { id: order.id }
  } catch (error) {
    if (error instanceof RazorpayClientError) throw error
    throw new RazorpayClientError(readProviderMessage(error))
  }
}

export async function fetchRazorpayPayment(client: RazorpayClient, paymentId: string): Promise<ProviderPayment> {
  try {
    return mapPayment(await client.payments.fetch(paymentId))
  } catch (error) {
    if (error instanceof RazorpayClientError) throw error
    throw new RazorpayClientError(readProviderMessage(error))
  }
}

export async function captureRazorpayPayment(
  client: RazorpayClient,
  paymentId: string,
  amount: number,
  currency: string,
): Promise<ProviderPayment> {
  try {
    return mapPayment(await client.payments.capture(paymentId, amount, currency))
  } catch (error) {
    if (error instanceof RazorpayClientError) throw error
    throw new RazorpayClientError(readProviderMessage(error))
  }
}

function mapPayment(payment: RazorpayPayment): ProviderPayment {
  const status = payment.status ?? ''
  if (!payment.id || !payment.order_id || !statuses.has(status as ProviderPaymentStatus)) {
    throw new RazorpayClientError('Razorpay returned an unexpected payment payload')
  }
  const amount = Number(payment.amount)
  if (!Number.isInteger(amount) || amount < 100) {
    throw new RazorpayClientError('Razorpay returned an unexpected payment amount')
  }
  // Card numbers, VPAs and bank account fields are never copied into PBMP.
  return {
    id: payment.id,
    orderId: payment.order_id,
    amount,
    currency: payment.currency ?? '',
    status: status as ProviderPaymentStatus,
    method: typeof payment.method === 'string' ? payment.method : null,
  }
}

function readProviderMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const description = (error as { error?: { description?: unknown } }).error?.description
    if (typeof description === 'string' && description.trim()) return description
  }
  if (error instanceof Error && error.message) return error.message
  return 'Razorpay request failed'
}
