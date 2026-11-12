import { createHmac, timingSafeEqual } from 'node:crypto'

function signaturesMatch(expected: string, provided: string): boolean {
  const left = Buffer.from(expected.toLowerCase())
  const right = Buffer.from(provided.trim().toLowerCase())
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function signCheckout(orderId: string, paymentId: string, keySecret: string): string {
  return createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex')
}

export function verifyCheckoutSignature(
  input: { orderId: string; paymentId: string; signature: string },
  keySecret: string,
): boolean {
  if (!keySecret) return false
  const expected = signCheckout(input.orderId, input.paymentId, keySecret)
  return signaturesMatch(expected, input.signature)
}

export function signWebhook(rawBody: Buffer, webhookSecret: string): string {
  return createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
  if (!webhookSecret || !signature) return false
  const expected = signWebhook(rawBody, webhookSecret)
  return signaturesMatch(expected, signature)
}
