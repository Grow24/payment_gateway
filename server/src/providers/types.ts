export type ProviderPaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded'

export type CreateProviderOrder = {
  amount: number
  currency: string
  receipt: string
  notes: Record<string, string>
}

export type ProviderOrder = {
  id: string
}

export type ProviderPayment = {
  id: string
  orderId: string
  amount: number
  currency: string
  status: ProviderPaymentStatus
  method: string | null
}

/**
 * Billing talks only to this interface. Razorpay is the first implementation.
 * A later gateway implements the same methods and does not own plans,
 * subscriptions, the ledger, or entitlements.
 */
export interface PaymentProvider {
  readonly name: 'razorpay'
  readonly keyId: string | null
  readonly webhookConfigured: boolean
  createOrder(input: CreateProviderOrder): Promise<ProviderOrder>
  verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }): boolean
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean
  fetchPayment(paymentId: string): Promise<ProviderPayment>
  capturePayment(paymentId: string, amount: number, currency: string): Promise<ProviderPayment>
}
