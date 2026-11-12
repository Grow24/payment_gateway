import { useEffect, useState, type FormEvent } from 'react'
import { createOrder, getDevState, getHealth, getPlans, verifyLicence, verifyPayment } from './api'
import { CheckoutClosed, PaymentFailed, loadRazorpay, openCheckout } from './razorpay'
import type { BillingCycle, CheckoutOrder, Confirmation, DevState, Health, PlansResponse } from './types'

type Phase = 'ready' | 'creating' | 'checkout' | 'verifying' | 'paid' | 'error'
type Tamper = 'pass' | 'fail' | null

const testCard = [
  ['Card network', 'Visa'],
  ['Card number', '4100 2800 0000 1007'],
  ['Expiry', 'Any future date'],
  ['CVV', 'Any three digits'],
  ['Authentication', 'Complete the mock success step'],
]

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [devState, setDevState] = useState<DevState | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [useTestAmount, setUseTestAmount] = useState(true)
  const [organization, setOrganization] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [phase, setPhase] = useState<Phase>('ready')
  const [order, setOrder] = useState<CheckoutOrder | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [licenceValid, setLicenceValid] = useState<boolean | null>(null)
  const [checkoutOpened, setCheckoutOpened] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tamper, setTamper] = useState<Tamper>(null)
  const [tamperMessage, setTamperMessage] = useState<string | null>(null)

  async function refreshState() {
    try {
      setDevState(await getDevState())
    } catch {
      setDevState(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [nextHealth, nextPlans] = await Promise.all([getHealth(), getPlans()])
        if (cancelled) return
        setHealth(nextHealth)
        setPlans(nextPlans)
        if (nextHealth.keyMode !== 'live') {
          try {
            setDevState(await getDevState())
          } catch {
            setDevState(null)
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setBootError(loadError instanceof Error ? loadError.message : 'Could not reach the billing server.')
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const plan = plans?.plans[0]
  const cyclePrice = plan?.cycles[cycle]
  const price = useTestAmount ? plans?.testAmount.display : cyclePrice?.display
  const busy = phase === 'creating' || phase === 'checkout' || phase === 'verifying'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setConfirmation(null)
    setLicenceValid(null)
    setCheckoutOpened(false)
    setPhase('creating')
    try {
      const nextOrder = await createOrder({
        cycle,
        useTestAmount,
        organization,
        customerName,
        customerEmail,
      })
      setOrder(nextOrder)
      setPhase('checkout')
      await loadRazorpay()
      setCheckoutOpened(true)
      const payment = await openCheckout({
        keyId: nextOrder.keyId,
        order: nextOrder,
      })
      setPhase('verifying')
      const nextConfirmation = await verifyPayment(payment)
      const licence = await verifyLicence(nextConfirmation.entitlement.licenceToken)
      setConfirmation(nextConfirmation)
      setLicenceValid(licence.valid)
      setPhase('paid')
    } catch (submitError) {
      setPhase('error')
      setError(messageFrom(submitError))
    } finally {
      await refreshState()
    }
  }

  async function onTamper() {
    setTamper(null)
    setTamperMessage(null)
    try {
      await verifyPayment({
        razorpay_order_id: 'order_tampered001',
        razorpay_payment_id: 'pay_tampered001',
        razorpay_signature: 'a'.repeat(64),
      })
      setTamper('fail')
      setTamperMessage('The server accepted a bad signature.')
    } catch (tamperError) {
      const code = (tamperError as { code?: string }).code
      if (code === 'invalid_signature') {
        setTamper('pass')
        setTamperMessage('Rejected. No entitlement was granted.')
      } else {
        setTamper('fail')
        setTamperMessage(messageFrom(tamperError))
      }
    } finally {
      await refreshState()
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="mark">PBMP</p>
          <p className="top-note">Billing service · Razorpay Standard Checkout</p>
        </div>
        <StatusPill health={health} bootError={bootError} />
      </header>

      {bootError ? <p className="banner warn">{bootError} Start the billing server, then refresh this page.</p> : null}
      {health?.keyMode === 'missing' ? (
        <p className="banner">
          Razorpay Test Mode keys are not in <code>server/.env</code> yet. Copy <code>server/.env.example</code>, paste the Key ID
          and Key Secret from Razorpay Dashboard → Test Mode → API Keys, then restart the server.
        </p>
      ) : null}
      {health?.warning ? <p className="banner warn">{health.warning}</p> : null}

      <main className="layout">
        <form className="slip" onSubmit={onSubmit}>
          <p className="eyebrow">PBMP Checkout</p>
          <h1>Secure subscription payment</h1>
          <p className="plan-name">{plan?.name ?? 'PBMP Professional'}</p>

          <div className="cycle" role="radiogroup" aria-label="Billing period">
            {(['monthly', 'annual'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={cycle === value}
                className={cycle === value ? 'selected' : ''}
                onClick={() => setCycle(value)}
              >
                {value === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>

          <p className="price">
            <span>{price ?? '—'}</span>
            <small>
              {cyclePrice?.periodLabel ?? ''} {plans?.taxNote ?? '+ applicable tax'}
            </small>
          </p>
          <p className="price-note">
            {useTestAmount
              ? `Test Mode milestone. The illustrative ${cycle} price is ${cyclePrice?.display ?? 'the plan price'}${cyclePrice?.periodLabel ?? ''}.`
              : 'Illustrative price, not a proposed PBMP tariff. Test Mode keys still move no real money.'}
          </p>

          <button
            type="button"
            className={useTestAmount ? 'switch on' : 'switch'}
            aria-pressed={useTestAmount}
            onClick={() => setUseTestAmount((value) => !value)}
          >
            <span />
            Use the ₹99 Test Mode amount
          </button>

          <label>
            Organisation
            <input value={organization} onChange={(event) => setOrganization(event.target.value)} required minLength={2} maxLength={80} />
          </label>
          <label>
            Name
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required minLength={2} maxLength={80} />
          </label>
          <label>
            Email
            <input
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              required
              maxLength={120}
            />
          </label>

          <div className="methods">
            <p>Razorpay will offer these methods</p>
            <ul>
              <li>
                <strong>UPI</strong>
                <span>GPay, PhonePe, Paytm. Intent on mobile, QR on desktop. Customers are not asked to type a UPI ID.</span>
              </li>
              <li>
                <strong>Credit / debit card</strong>
                <span>Entered on Razorpay’s page. PBMP does not see or store the card.</span>
              </li>
              <li>
                <strong>Net banking</strong>
                <span>Opened from the Razorpay checkout.</span>
              </li>
            </ul>
          </div>

          <div className="renewal">
            <p>Monthly auto-renewal</p>
            <p>Authorize once, then renew automatically where supported. Cancel future renewals from your billing settings.</p>
            <p className="build-note">{plans?.checkout.note}</p>
          </div>

          {phase === 'paid' && confirmation ? (
            <Success confirmation={confirmation} licenceValid={licenceValid} />
          ) : (
            <button className="pay" type="submit" disabled={busy || Boolean(bootError)}>
              {phase === 'creating'
                ? 'Creating order…'
                : phase === 'checkout'
                  ? 'Waiting for Razorpay…'
                  : phase === 'verifying'
                    ? 'Verifying payment…'
                    : 'Continue to secure payment'}
            </button>
          )}

          {error ? <p className="form-error">{error}</p> : null}
          <p className="footnote">Illustrative checkout. The payment itself is completed inside Razorpay.</p>
        </form>

        <aside className="checks">
          <div className="checks-head">
            <h2>Payment checks</h2>
            <p>A popup alone is not enough. Razorpay and PBMP both have to agree.</p>
          </div>
          <ol>
            <Check
              id="T01"
              name="Backend health"
              expected="HTTP 200"
              state={bootError ? 'fail' : health?.ok ? 'pass' : 'waiting'}
              detail={health ? `${health.provider} · ${health.keyMode}` : bootError ?? 'Waiting for /api/health'}
            />
            <Check
              id="T02"
              name="Order creation"
              expected="order_… generated"
              state={order?.orderId ? 'pass' : phase === 'error' && !order ? 'fail' : 'waiting'}
              detail={
                order
                  ? `${order.orderId} · ${order.display}`
                  : phase === 'error' && error
                    ? error
                    : 'The server chooses the amount in paise.'
              }
            />
            <Check
              id="T03"
              name="Checkout"
              expected="Razorpay opens"
              state={checkoutOpened ? 'pass' : 'waiting'}
              detail={checkoutOpened ? 'Standard Checkout opened.' : 'Opens after the order exists.'}
            />
            <Check
              id="T04"
              name="Test transaction"
              expected="pay_… generated"
              state={confirmation?.payment.id ? 'pass' : 'waiting'}
              detail={confirmation?.payment.id ?? 'Shown after Razorpay returns a payment id.'}
            />
            <Check
              id="T05"
              name="Signature verification"
              expected="Valid"
              state={confirmation?.ok ? 'pass' : 'waiting'}
              detail={confirmation?.ok ? 'Server HMAC matched.' : 'Checked only on the server.'}
            />
            <Check
              id="T06"
              name="Payment capture"
              expected="captured"
              state={confirmation?.paymentStatus === 'captured' ? 'pass' : 'waiting'}
              detail={confirmation?.paymentStatus ?? 'PBMP fetches the payment from Razorpay.'}
            />
            <Check
              id="T07"
              name="PBMP backend state"
              expected="paid"
              state={confirmation?.status === 'paid' && licenceValid ? 'pass' : 'waiting'}
              detail={
                confirmation
                  ? `${confirmation.status}${licenceValid ? ' · licence signature valid' : ''}`
                  : 'Entitlement is issued once, with a signed licence.'
              }
            />
            <Check
              id="T08"
              name="Failed or tampered payment"
              expected="No entitlement granted"
              state={tamper === 'pass' ? 'pass' : tamper === 'fail' ? 'fail' : 'waiting'}
              detail={tamperMessage ?? 'Send a bad signature without leaving this page.'}
            />
            <Check
              id="T09"
              name="Webhook delivery"
              expected="Signed event accepted"
              state={devState && devState.webhookEvents.length > 0 ? 'pass' : 'info'}
              detail={
                devState && devState.webhookEvents.length > 0
                  ? `${devState.webhookEvents.length} signed event(s) recorded.`
                  : 'Covered by server tests. A live delivery needs a public HTTPS URL; localhost cannot receive it.'
              }
            />
            <Check
              id="T10"
              name="Duplicate webhook"
              expected="No duplicate activation"
              state={devState?.webhookEvents.some((event) => event.duplicates > 0) ? 'pass' : 'info'}
              detail={
                devState?.webhookEvents.some((event) => event.duplicates > 0)
                  ? 'A repeated event id did not create another entitlement.'
                  : 'Covered by server tests. The same event id is ignored after the first acceptance.'
              }
            />
          </ol>

          <button type="button" className="secondary" onClick={() => void onTamper()}>
            Send tampered signature
          </button>

          <details>
            <summary>Razorpay sandbox card</summary>
            <dl>
              {testCard.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p>UPI test values, when that field appears, are success@razorpay and failure@razorpay. These are not live payment instructions.</p>
          </details>

          {devState ? (
            <p className="ledger">
              Ledger on this machine: {devState.orders} orders · {devState.payments} payments · {devState.entitlements}{' '}
              entitlements · {devState.receipts} receipts
            </p>
          ) : null}
        </aside>
      </main>
    </div>
  )
}

function Success({ confirmation, licenceValid }: { confirmation: Confirmation; licenceValid: boolean | null }) {
  return (
    <div className="success" aria-live="polite">
      <p className="eyebrow">Payment confirmed</p>
      <h2>{confirmation.order.organization} can use {confirmation.entitlement.planName}</h2>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{confirmation.status}</dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>{confirmation.payment.id}</dd>
        </div>
        <div>
          <dt>Receipt</dt>
          <dd>
            {confirmation.receipt.id} · {confirmation.receipt.display}
          </dd>
        </div>
        <div>
          <dt>Access until</dt>
          <dd>{formatWhen(confirmation.entitlement.accessUntil)}</dd>
        </div>
        <div>
          <dt>Offline until</dt>
          <dd>{formatWhen(confirmation.entitlement.offlineUntil)}</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>{licenceValid ? 'Signature valid' : 'Not confirmed'}</dd>
        </div>
      </dl>
      <p className="build-note">This receipt is not a GST invoice. Compare the payment id in Razorpay Dashboard → Test Mode → Transactions → Payments. It should say Captured.</p>
    </div>
  )
}

function StatusPill({ health, bootError }: { health: Health | null; bootError: string | null }) {
  if (bootError) return <span className="pill bad">Server offline</span>
  if (!health) return <span className="pill">Checking</span>
  if (health.keyMode === 'live') return <span className="pill bad">Live mode</span>
  if (health.keyMode === 'test') return <span className="pill good">Test mode</span>
  return <span className="pill">Keys missing</span>
}

function Check({
  id,
  name,
  expected,
  state,
  detail,
}: {
  id: string
  name: string
  expected: string
  state: 'waiting' | 'pass' | 'fail' | 'info'
  detail: string
}) {
  return (
    <li className={`check ${state}`}>
      <div>
        <span className="check-id">{id}</span>
        <strong>{name}</strong>
        <em>{expected}</em>
      </div>
      <p>{detail}</p>
    </li>
  )
}

function messageFrom(error: unknown): string {
  if (error instanceof CheckoutClosed || error instanceof PaymentFailed) return error.message
  if (error instanceof Error) return error.message
  return 'Payment could not be completed.'
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
