export type RazorpaySuccess = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

type RazorpayFailed = {
  error?: { description?: string }
}

type RazorpayCheckout = {
  open: () => void
  on: (event: 'payment.failed', handler: (response: RazorpayFailed) => void) => void
}

type RazorpayOptions = {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  handler: (response: RazorpaySuccess) => void
  prefill?: { name?: string; email?: string }
  theme?: { color?: string }
  modal?: { ondismiss?: () => void }
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayCheckout
  }
}

export class CheckoutClosed extends Error {
  constructor() {
    super('Payment window closed before completion. No entitlement was granted.')
    this.name = 'CheckoutClosed'
  }
}

export class PaymentFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentFailed'
  }
}

export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check the network connection.'))
    document.body.appendChild(script)
  })
}

export function openCheckout(input: {
  keyId: string
  order: { orderId: string; amount: number; currency: string; planName: string; description: string; customerName: string; customerEmail: string }
}): Promise<RazorpaySuccess> {
  return new Promise((resolve, reject) => {
    const Razorpay = window.Razorpay
    if (!Razorpay) {
      reject(new Error('Razorpay Checkout is unavailable.'))
      return
    }
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    const checkout = new Razorpay({
      key: input.keyId,
      amount: input.order.amount,
      currency: input.order.currency,
      name: 'PBMP',
      description: input.order.description,
      order_id: input.order.orderId,
      prefill: { name: input.order.customerName, email: input.order.customerEmail },
      theme: { color: '#0e6b52' },
      handler: (response) => finish(() => resolve(response)),
      modal: {
        ondismiss: () => finish(() => reject(new CheckoutClosed())),
      },
    })
    checkout.on('payment.failed', (response) => {
      finish(() => reject(new PaymentFailed(response.error?.description || 'Payment failed. No entitlement was granted.')))
    })
    checkout.open()
  })
}
