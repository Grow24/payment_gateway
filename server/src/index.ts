import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createApp } from './app.js'
import { BillingService } from './billing/service.js'
import { loadOrCreateLicenceKeys } from './billing/licence.js'
import { BillingStore } from './billing/store.js'
import { readConfig } from './config.js'
import { RazorpayProvider } from './providers/razorpay/provider.js'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: resolve(serverRoot, '.env') })

const config = readConfig()
const store = new BillingStore(config.storePath)
await store.load()
const licenceKeys = await loadOrCreateLicenceKeys(config.licenceKeyPath)
const provider = new RazorpayProvider({
  keyId: config.keyId,
  keySecret: config.keySecret,
  webhookSecret: config.webhookSecret,
})
const billing = new BillingService(store, provider, licenceKeys, config.offlineDays)
const staticRoot = resolve(serverRoot, '../web/dist')
const app = createApp({
  billing,
  store,
  provider,
  licenceKeys,
  keyMode: config.keyMode,
  frontendOrigin: config.frontendOrigin,
  staticRoot: existsSync(staticRoot) ? staticRoot : null,
})

app.listen(config.port, '0.0.0.0', () => {
  console.log(`PBMP billing listening on port ${config.port}`)
  console.log(`Razorpay key mode: ${config.keyMode}`)
  console.log(`Webhook secret configured: ${provider.webhookConfigured}`)
})
