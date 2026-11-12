import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { BillingService } from '../src/billing/service.js'
import { BillingStore } from '../src/billing/store.js'
import { loadOrCreateLicenceKeys, verifyLicence } from '../src/billing/licence.js'
import { TEST_AMOUNT_PAISE } from '../src/domain/plans.js'
import { BillingError } from '../src/domain/errors.js'
import { FakeRazorpay } from './fake-razorpay.js'

const customer = {
  cycle: 'monthly' as const,
  useTestAmount: true,
  organization: 'Northwind Studios',
  customerName: 'Asha Rao',
  customerEmail: 'asha@northwind.test',
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pbmp-billing-'))
  const keys = await loadOrCreateLicenceKeys(join(dir, 'licence-keys.json'))
  const provider = new FakeRazorpay()
  const store = new BillingStore(join(dir, 'ledger.json'))
  const billing = new BillingService(store, provider, keys, 14)
  return { dir, keys, provider, store, billing }
}

describe('PBMP billing', () => {
  it('prices the ₹99 test order on the server and ignores any client amount', async () => {
    const { billing, provider } = await setup()
    const { order } = await billing.createCheckout(customer)
    assert.equal(order.amount, TEST_AMOUNT_PAISE)
    assert.equal(order.currency, 'INR')
    assert.equal(order.testAmount, true)
    assert.equal(provider.created[0]?.amount, 9900)
    assert.equal(order.status, 'pending_payment')
    assert.match(order.providerOrderId ?? '', /^order_/)
  })

  it('uses the illustrative plan price only when the test amount is turned off', async () => {
    const { billing, provider } = await setup()
    const { order } = await billing.createCheckout({ ...customer, useTestAmount: false, cycle: 'annual' })
    assert.equal(order.amount, 999_000)
    assert.equal(provider.created[0]?.amount, 999_000)
  })

  it('grants one signed entitlement after a captured payment and ignores a second confirmation', async () => {
    const { billing, provider, store, keys } = await setup()
    const { order } = await billing.createCheckout(customer)
    const paymentId = 'pay_captured1234'
    provider.payments.set(paymentId, {
      id: paymentId,
      orderId: order.providerOrderId!,
      amount: 9900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
    })
    const signature = provider.sign(order.providerOrderId!, paymentId)
    const first = await billing.confirmCheckout({
      orderId: order.providerOrderId!,
      paymentId,
      signature,
    })
    const second = await billing.confirmCheckout({
      orderId: order.providerOrderId!,
      paymentId,
      signature,
    })

    assert.equal(first.duplicate, false)
    assert.equal(first.order.status, 'paid')
    assert.equal(first.payment.status, 'captured')
    assert.equal(first.entitlement.status, 'active')
    assert.equal(first.receipt.taxInvoice, false)
    assert.equal(second.duplicate, true)
    assert.equal(second.entitlement.id, first.entitlement.id)
    assert.equal(Object.keys(store.view().entitlements).length, 1)
    assert.ok(verifyLicence(first.entitlement.licenceToken, keys.publicKey))
  })

  it('captures an authorized payment before granting access', async () => {
    const { billing, provider } = await setup()
    const { order } = await billing.createCheckout(customer)
    const paymentId = 'pay_authorized12'
    provider.payments.set(paymentId, {
      id: paymentId,
      orderId: order.providerOrderId!,
      amount: 9900,
      currency: 'INR',
      status: 'authorized',
      method: 'card',
    })
    const result = await billing.confirmCheckout({
      orderId: order.providerOrderId!,
      paymentId,
      signature: provider.sign(order.providerOrderId!, paymentId),
    })
    assert.equal(result.payment.status, 'captured')
    assert.equal(provider.payments.get(paymentId)?.status, 'captured')
  })

  it('does not grant an entitlement for a bad signature, a mismatched amount, or a failed payment', async () => {
    const { billing, provider, store } = await setup()
    const { order } = await billing.createCheckout(customer)

    await assert.rejects(
      billing.confirmCheckout({
        orderId: order.providerOrderId!,
        paymentId: 'pay_tampered0001',
        signature: 'a'.repeat(64),
      }),
      (error: unknown) => error instanceof BillingError && error.code === 'invalid_signature',
    )

    const mismatchId = 'pay_mismatch0001'
    provider.payments.set(mismatchId, {
      id: mismatchId,
      orderId: order.providerOrderId!,
      amount: 100,
      currency: 'INR',
      status: 'captured',
      method: 'card',
    })
    await assert.rejects(
      billing.confirmCheckout({
        orderId: order.providerOrderId!,
        paymentId: mismatchId,
        signature: provider.sign(order.providerOrderId!, mismatchId),
      }),
      (error: unknown) => error instanceof BillingError && error.code === 'amount_mismatch',
    )

    const failedId = 'pay_failed000001'
    provider.payments.set(failedId, {
      id: failedId,
      orderId: order.providerOrderId!,
      amount: 9900,
      currency: 'INR',
      status: 'failed',
      method: 'upi',
    })
    await assert.rejects(
      billing.confirmCheckout({
        orderId: order.providerOrderId!,
        paymentId: failedId,
        signature: provider.sign(order.providerOrderId!, failedId),
      }),
      (error: unknown) => error instanceof BillingError && error.code === 'not_captured',
    )

    assert.equal(Object.keys(store.view().entitlements).length, 0)
    assert.equal(store.view().orders[order.id]?.status, 'payment_failed')
  })

  it('reloads the ledger from disk', async () => {
    const { dir, billing, provider, keys } = await setup()
    const { order } = await billing.createCheckout(customer)
    const reloaded = new BillingStore(join(dir, 'ledger.json'))
    await reloaded.load()
    const again = new BillingService(reloaded, provider, keys, 14)
    const saved = reloaded.view().orders[order.id]
    assert.equal(saved?.providerOrderId, order.providerOrderId)
    assert.equal(saved?.amount, 9900)
    await assert.rejects(
      again.confirmCheckout({
        orderId: order.providerOrderId!,
        paymentId: 'pay_missing00001',
        signature: 'b'.repeat(64),
      }),
      (error: unknown) => error instanceof BillingError && error.code === 'invalid_signature',
    )
  })
})
