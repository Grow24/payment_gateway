import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export type KeyMode = 'test' | 'live' | 'missing'

export type AppConfig = {
  port: number
  frontendOrigin: string
  keyId: string
  keySecret: string
  webhookSecret: string
  keyMode: KeyMode
  dataDir: string
  storePath: string
  licenceKeyPath: string
  offlineDays: number
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const keyId = (env.RAZORPAY_KEY_ID ?? '').trim()
  const keySecret = (env.RAZORPAY_KEY_SECRET ?? '').trim()
  const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET ?? '').trim()
  const port = Number(env.PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  const offlineDays = Number(env.OFFLINE_ENTITLEMENT_DAYS ?? 14)
  if (!Number.isInteger(offlineDays) || offlineDays < 1 || offlineDays > 90) {
    throw new Error('OFFLINE_ENTITLEMENT_DAYS must be an integer from 1 to 90')
  }

  const configuredDir = (env.BILLING_DATA_DIR ?? './data').trim() || './data'
  const dataDir = isAbsolute(configuredDir) ? configuredDir : resolve(serverRoot, configuredDir)

  return {
    port,
    frontendOrigin: (env.FRONTEND_ORIGIN ?? 'http://127.0.0.1:5173').trim(),
    keyId,
    keySecret,
    webhookSecret,
    keyMode: keyModeOf(keyId, keySecret),
    dataDir,
    storePath: join(dataDir, 'billing-store.json'),
    licenceKeyPath: join(dataDir, 'licence-keys.json'),
    offlineDays,
  }
}

export function keyModeOf(keyId: string, keySecret: string): KeyMode {
  if (!keyId || !keySecret) return 'missing'
  if (keyId.startsWith('rzp_test_')) return 'test'
  if (keyId.startsWith('rzp_live_')) return 'live'
  return 'missing'
}
