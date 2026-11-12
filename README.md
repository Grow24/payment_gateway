# PBMP Razorpay integration

PBMP ka billing service yahin hai. Razorpay sirf payment process karta hai. Plan ki keemat, order, receipt, entitlement aur signed licence PBMP ke server par rehte hain.

React checkout card details kabhi nahi dekhta. Key Secret sirf `server/.env` mein rehta hai.

## Structure

```text
server/src/domain/       plans, prices, paise
server/src/billing/      orders, ledger, receipts, entitlements, signed licence
server/src/providers/    Razorpay adapter (doosra gateway yahin lagta hai)
server/src/http/         API
web/                     React + Vite checkout aur T01–T10 screen
```

Flow:

1. Browser `POST /api/orders` karta hai. Amount server decide karta hai.
2. Server Razorpay Orders API se order banata hai.
3. Browser Razorpay Standard Checkout kholta hai.
4. Server signature, amount, currency aur captured status check karta hai.
5. Tab PBMP payment record karta hai, ek receipt banata hai, aur ek hi baar signed entitlement deta hai.

Webhook `POST /api/webhooks/razorpay` raw body ki signature check karta hai. Same event id dubara aaye to entitlement dubara activate nahi hoti.

## Pehli baar chalana

Do terminals, project ke root se.

Terminal 1 — billing server:

```bash
cd server
cp .env.example .env
npm install
npm test
npm start
```

`.env` mein Razorpay Dashboard → **Test Mode** → API Keys se `RAZORPAY_KEY_ID` (`rzp_test_...`) aur `RAZORPAY_KEY_SECRET` daalo. Secret React app mein mat daalna.

Health check:

```bash
curl http://127.0.0.1:3001/api/health
```

`keyMode` `test` hona chahiye.

Terminal 2 — checkout:

```bash
cd web
npm install
npm run dev
```

Chrome mein [http://127.0.0.1:5173](http://127.0.0.1:5173) kholo.

## ₹99 test payment

1. Organisation, name aur email bharo. **Use the ₹99 Test Mode amount** on rehna chahiye.
2. **Continue to secure payment** dabao.
3. Razorpay Test Mode card:

| Field | Value |
|---|---|
| Network | Visa |
| Number | `4100 2800 0000 1007` |
| Expiry | koi bhi future date |
| CVV | koi bhi 3 digits |
| Authentication | Razorpay ka mock success complete karo |

UPI test field aaye to `success@razorpay` success ke liye aur `failure@razorpay` failure ke liye. Yeh live payment nahi hai.

4. Screen par T02 se T07 pass hone chahiye, status `paid`, aur licence signature valid.
5. Razorpay Dashboard → Test Mode → Transactions → Payments mein wahi `pay_...` id **Captured** dikhni chahiye.
6. **Send tampered signature** dabao. T08 pass hona chahiye: entitlement nahi milti.

T09 aur T10 server tests mein cover hain. Razorpay ka asli webhook localhost par nahi aata. Uske liye public HTTPS URL chahiye, aur Dashboard → Test Mode → Webhooks mein yeh URL:

`https://<public-host>/api/webhooks/razorpay`

Secret wahi ho jo `RAZORPAY_WEBHOOK_SECRET` mein hai. Events: `payment.captured` aur `payment.failed`.

## Is build mein kya hai, aur kya baad mein hai

Is milestone mein ek one-time captured payment hai. Automatic renewal abhi active nahi hai. Agle step mein Razorpay Subscriptions API, mandate lifecycle, GST invoice, aur live-mode settlement aayega.

Receipt GST invoice nahi hai. Desktop app ke liye entitlement Ed25519 se signed hai. Public key `GET /api/licence/public-key` par hai. Private key `server/data/` mein rehti hai aur desktop package mein nahi jaani chahiye.

Live keys (`rzp_live_...`) se asli paisa move ho sakta hai. Pehle Test Mode ka ₹99 payment T01–T08 tak pass karo.
