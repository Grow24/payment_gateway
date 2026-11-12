import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, after } from 'node:test'
import { createApp } from '../src/app.js'
import { BillingService } from '../src/billing/service.js'
import { BillingStore } from '../src/billing/store.js'
import { loadOrCreateLicenceKeys } from '../src/billing/licence.js'
import { signWebhook } from '../src/providers/razorpay/verify.js'
import { FakeRazorpay } from './fake-razorpay.js'
import { listen } from './listen.js'

const dir = await mkdtemp(join(tmpdir(), 'pbmp-http-'))
const keys = await loadOrCreateLicenceKeys(join(dir, 'licence-keys.json'))
const provider = new FakeRazorpay()
const store = new BillingStore(null)
const billing = new BillingService(store, provider, keys, 14)
const app = createApp({
  billing,
  store,
  provider,
  licenceKeys: keys,
  keyMode: 'test',
  frontendOrigin: 'http://127.0.0.1:5173',
})
const server = await listen(app)

after(async () => {
  await server.close()
})

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

describe('billing HTTP', { concurrency: false }, () => {
  it('T01 health returns 200', async () => {
    const response = await fetch(`${server.base}/api/health`)
    const body = (await response.json()) as { ok: boolean; keyMode: string }
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.keyMode, 'test')
  })

  it('T02 creates an order for 9,900 paise even if the client sends another amount', async () => {
    const { status, body } = await post('/api/orders', {
      cycle: 'monthly',
      useTestAmount: true,
      organization: 'Northwind',
      customerName: 'Asha Rao',
      customerEmail: 'asha@northwind.test',
      amount: 100,
    })
    assert.equal(status, 201)
    assert.equal(body.amount, 9900)
    assert.match(String(body.orderId), /^order_/)
    assert.equal(provider.created.at(-1)?.amount, 9900)
  })

  it('T08 rejects a tampered signature and grants nothing', async () => {
    const before = Object.keys(store.view().entitlements).length
    const { status, body } = await post('/api/payments/verify', {
      razorpay_order_id: 'order_tampered001',
      razorpay_payment_id: 'pay_tampered001',
      razorpay_signature: 'a'.repeat(64),
    })
    assert.equal(status, 400)
    assert.equal(body.code, 'invalid_signature')
    assert.equal(Object.keys(store.view().entitlements).length, before)
  })

  it('T09 accepts a signed webhook and T10 ignores a duplicate delivery', async () => {
    const created = await post('/api/orders', {
      cycle: 'monthly',
      useTestAmount: true,
      organization: 'Webhook Co',
      customerName: 'R. Sen',
      customerEmail: 'r@webhook.test',
    })
    const orderId = String(created.body.orderId)
    const paymentId = 'pay_webhook0001'
    provider.payments.set(paymentId, {
      id: paymentId,
      orderId,
      amount: 9900,
      currency: 'INR',
      status: 'captured',
      method: 'card',
    })
    const payload = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: 9900, status: 'captured' } } },
      }),
    )
    const signature = signWebhook(payload, provider.webhookSecret)
    const headers = {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': 'evt_webhook_001',
    }

    const first = await fetch(`${server.base}/api/webhooks/razorpay`, { method: 'POST', headers, body: payload })
    const firstBody = (await first.json()) as { duplicate: boolean; settled: boolean }
    const second = await fetch(`${server.base}/api/webhooks/razorpay`, { method: 'POST', headers, body: payload })
    const secondBody = (await second.json()) as { duplicate: boolean }
    const state = (await (await fetch(`${server.base}/api/dev/state`)).json()) as {
      entitlements: number
      webhookEvents: Array<{ id: string; duplicates: number }>
    }

    assert.equal(first.status, 200)
    assert.equal(firstBody.duplicate, false)
    assert.equal(firstBody.settled, true)
    assert.equal(second.status, 200)
    assert.equal(secondBody.duplicate, true)
    assert.equal(state.entitlements, 1)
    assert.equal(state.webhookEvents.find((event) => event.id === 'evt_webhook_001')?.duplicates, 1)
  })

  it('rejects an unsigned webhook', async () => {
    const payload = Buffer.from('{"event":"payment.captured"}')
    const response = await fetch(`${server.base}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'a'.repeat(64),
        'x-razorpay-event-id': 'evt_unsigned_1',
      },
      body: payload,
    })
    assert.equal(response.status, 400)
    const body = (await response.json()) as { code: string }
    assert.equal(body.code, 'invalid_webhook_signature')
  })

  it('verifies the public licence after payment', async () => {
    const created = await post('/api/orders', {
      cycle: 'monthly',
      useTestAmount: true,
      organization: 'Licence Co',
      customerName: 'Mina Das',
      customerEmail: 'mina@licence.test',
    })
    const orderId = String(created.body.orderId)
    const paymentId = 'pay_licence0001'
    provider.payments.set(paymentId, {
      id: paymentId,
      orderId,
      amount: 9900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
    })
    const verified = await post('/api/payments/verify', {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: provider.sign(orderId, paymentId),
    })
    assert.equal(verified.status, 200)
    const entitlement = verified.body.entitlement as { licenceToken: string }
    const check = await post('/api/licence/verify', { licence: entitlement.licenceToken })
    assert.equal(check.status, 200)
    assert.equal(check.body.valid, true)
  })
})
