import { BillingError } from '../../domain/errors.js'
import type { PaymentProvider, ProviderPayment } from '../types.js'
import {
  captureRazorpayPayment,
  createRazorpayClient,
  createRazorpayOrder,
  fetchRazorpayPayment,
} from './client.js'
import { verifyCheckoutSignature, verifyWebhookSignature } from './verify.js'

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const
  readonly keyId: string | null
  readonly webhookConfigured: boolean
  private readonly keySecret: string
  private readonly webhookSecret: string

  constructor(options: { keyId: string; keySecret: string; webhookSecret: string }) {
    this.keyId = options.keyId || null
    this.keySecret = options.keySecret
    this.webhookSecret = options.webhookSecret
    this.webhookConfigured = options.webhookSecret.length > 0
  }

  private client() {
    if (!this.keyId || !this.keySecret) {
      throw new BillingError(
        'razorpay_not_configured',
        'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env. Use Test Mode keys from the Razorpay Dashboard.',
        503,
      )
    }
    return createRazorpayClient(this.keyId, this.keySecret)
  }

  createOrder(input: Parameters<PaymentProvider['createOrder']>[0]) {
    return createRazorpayOrder(this.client(), input)
  }

  verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }): boolean {
    return verifyCheckoutSignature(input, this.keySecret)
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return verifyWebhookSignature(rawBody, signature, this.webhookSecret)
  }

  fetchPayment(paymentId: string): Promise<ProviderPayment> {
    return fetchRazorpayPayment(this.client(), paymentId)
  }

  capturePayment(paymentId: string, amount: number, currency: string): Promise<ProviderPayment> {
    return captureRazorpayPayment(this.client(), paymentId, amount, currency)
  }
}
