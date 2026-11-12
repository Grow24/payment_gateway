import type { ApiError, CheckoutOrder, Confirmation, DevState, Health, PlansResponse } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('Billing server is not responding on port 3001.')
  }

  const text = await response.text()
  const body = text ? (JSON.parse(text) as T & ApiError) : ({} as T & ApiError)
  if (!response.ok) {
    const error = new Error(body.message || `Request failed (${response.status})`) as Error & { code?: string }
    error.code = body.code
    throw error
  }
  return body
}

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health')
}

export function getPlans(): Promise<PlansResponse> {
  return request<PlansResponse>('/api/plans')
}

export function createOrder(input: {
  cycle: 'monthly' | 'annual'
  useTestAmount: boolean
  organization: string
  customerName: string
  customerEmail: string
}): Promise<CheckoutOrder> {
  return request<CheckoutOrder>('/api/orders', { method: 'POST', body: JSON.stringify(input) })
}

export function verifyPayment(input: {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}): Promise<Confirmation> {
  return request<Confirmation>('/api/payments/verify', { method: 'POST', body: JSON.stringify(input) })
}

export function verifyLicence(licence: string): Promise<{ valid: boolean }> {
  return request('/api/licence/verify', { method: 'POST', body: JSON.stringify({ licence }) })
}

export function getDevState(): Promise<DevState> {
  return request<DevState>('/api/dev/state')
}
