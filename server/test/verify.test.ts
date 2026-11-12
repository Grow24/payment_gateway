import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { loadOrCreateLicenceKeys, signLicence, verifyLicence, type LicenceClaims } from '../src/billing/licence.js'
import { signCheckout, signWebhook, verifyCheckoutSignature, verifyWebhookSignature } from '../src/providers/razorpay/verify.js'

describe('Razorpay signatures', () => {
  it('matches an independent HMAC of order_id|payment_id', () => {
    const secret = 'test_secret'
    const orderId = 'order_ABC12345678'
    const paymentId = 'pay_ABC12345678'
    const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')

    assert.equal(signCheckout(orderId, paymentId, secret), expected)
    assert.equal(verifyCheckoutSignature({ orderId, paymentId, signature: expected }, secret), true)
  })

  it('rejects a tampered checkout signature, a short signature, and a missing secret', () => {
    const secret = 'test_secret'
    const orderId = 'order_ABC12345678'
    const paymentId = 'pay_ABC12345678'
    const expected = signCheckout(orderId, paymentId, secret)
    const tampered = `${expected.slice(0, -1)}${expected.endsWith('a') ? 'b' : 'a'}`

    assert.equal(verifyCheckoutSignature({ orderId, paymentId, signature: tampered }, secret), false)
    assert.equal(verifyCheckoutSignature({ orderId, paymentId, signature: 'abc' }, secret), false)
    assert.equal(verifyCheckoutSignature({ orderId, paymentId, signature: expected }, ''), false)
  })

  it('verifies the raw webhook body and rejects a changed byte', () => {
    const secret = 'whsec_test'
    const body = Buffer.from('{"event":"payment.captured"}')
    const signature = signWebhook(body, secret)
    const independent = createHmac('sha256', secret).update(body).digest('hex')

    assert.equal(signature, independent)
    assert.equal(verifyWebhookSignature(body, signature, secret), true)
    const changed = Buffer.from(body)
    changed[0] = changed[0] === 123 ? 125 : 123
    assert.equal(verifyWebhookSignature(changed, signature, secret), false)
    assert.equal(verifyWebhookSignature(body, signature, ''), false)
  })
})

describe('signed entitlements', () => {
  it('verifies a licence and rejects a tampered payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pbmp-licence-'))
    const keys = await loadOrCreateLicenceKeys(join(dir, 'licence-keys.json'))
    const claims: LicenceClaims = {
      v: 1,
      entitlementId: 'ent_1234567890abcdef',
      organization: 'Northwind',
      planId: 'pbmp-professional',
      cycle: 'monthly',
      status: 'active',
      activatedAt: '2026-11-07T00:00:00.000Z',
      accessUntil: '2026-12-07T00:00:00.000Z',
      offlineUntil: '2026-11-21T00:00:00.000Z',
      orderId: 'ord_1234567890abcdef',
      paymentId: 'pay_ABC12345678',
      amount: 9900,
      currency: 'INR',
    }
    const token = signLicence(claims, keys)
    assert.deepEqual(verifyLicence(token, keys.publicKey), claims)

    const [, payload, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LicenceClaims
    decoded.organization = 'Someone else'
    const tampered = `v1.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`
    assert.equal(verifyLicence(tampered, keys.publicKey), null)
  })
})
