import { randomBytes } from 'node:crypto'
import { BillingError } from '../src/domain/errors.js'
import type { PaymentProvider, ProviderPayment } from '../src/providers/types.js'
import { signCheckout, verifyCheckoutSignature, verifyWebhookSignature } from '../src/providers/razorpay/verify.js'

export class FakeRazorpay implements PaymentProvider {
  readonly name = 'razorpay' as const
  keyId: string | null = 'rzp_test_fakekey000'
  webhookConfigured = true
  readonly secret = 'test_key_secret'
  readonly webhookSecret = 'test_webhook_secret'
  readonly created: Array<{ amount: number; currency: string }> = []
  readonly payments = new Map<string, ProviderPayment>()

  async createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) {
    this.created.push({ amount: input.amount, currency: input.currency })
    return { id: `order_${randomBytes(6).toString('hex')}` }
  }

  verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }): boolean {
    return verifyCheckoutSignature(input, this.secret)
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return verifyWebhookSignature(rawBody, signature, this.webhookSecret)
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new BillingError('provider_error', 'Unknown payment', 502)
    return { ...payment }
  }

  async capturePayment(paymentId: string, amount: number, currency: string): Promise<ProviderPayment> {
    const payment = await this.fetchPayment(paymentId)
    if (payment.amount !== amount || payment.currency !== currency) {
      throw new BillingError('amount_mismatch', 'Capture amount does not match', 409)
    }
    const captured: ProviderPayment = { ...payment, status: 'captured' }
    this.payments.set(paymentId, captured)
    return captured
  }

  sign(orderId: string, paymentId: string): string {
    return signCheckout(orderId, paymentId, this.secret)
  }
}
