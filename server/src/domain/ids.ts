import { randomBytes } from 'node:crypto'

export function newId(prefix: 'ord' | 'rcpt' | 'ent'): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export const PROVIDER_ORDER_ID = /^order_[A-Za-z0-9]{8,}$/
export const PROVIDER_PAYMENT_ID = /^pay_[A-Za-z0-9]{8,}$/
export const WEBHOOK_EVENT_ID = /^[A-Za-z0-9_-]{6,80}$/
export const CHECKOUT_SIGNATURE = /^[a-f0-9]{64}$/i
