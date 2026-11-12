import { generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type LicenceClaims = {
  v: 1
  entitlementId: string
  organization: string
  planId: string
  cycle: 'monthly' | 'annual'
  status: 'active'
  activatedAt: string
  accessUntil: string
  offlineUntil: string
  orderId: string
  paymentId: string
  amount: number
  currency: string
}

type StoredKeys = {
  publicKeyPem: string
  privateKeyPem: string
}

export type LicenceKeys = {
  publicKeyPem: string
  privateKey: KeyObject
  publicKey: KeyObject
}

export async function loadOrCreateLicenceKeys(filePath: string): Promise<LicenceKeys> {
  await mkdir(dirname(filePath), { recursive: true })
  try {
    const raw = await readFile(filePath, 'utf8')
    return keysFromStored(JSON.parse(raw) as StoredKeys)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const stored: StoredKeys = {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
  await writeFile(filePath, JSON.stringify(stored), { mode: 0o600 })
  return keysFromStored(stored)
}

function keysFromStored(stored: StoredKeys): LicenceKeys {
  if (!stored.publicKeyPem?.includes('PUBLIC KEY') || !stored.privateKeyPem?.includes('PRIVATE KEY')) {
    throw new Error('Licence key file is invalid')
  }
  return {
    publicKeyPem: stored.publicKeyPem,
    publicKey: createPublicKey(stored.publicKeyPem),
    privateKey: createPrivateKey(stored.privateKeyPem),
  }
}

export function canonicalLicence(claims: LicenceClaims): string {
  return JSON.stringify({
    v: claims.v,
    entitlementId: claims.entitlementId,
    organization: claims.organization,
    planId: claims.planId,
    cycle: claims.cycle,
    status: claims.status,
    activatedAt: claims.activatedAt,
    accessUntil: claims.accessUntil,
    offlineUntil: claims.offlineUntil,
    orderId: claims.orderId,
    paymentId: claims.paymentId,
    amount: claims.amount,
    currency: claims.currency,
  })
}

export function signLicence(claims: LicenceClaims, keys: LicenceKeys): string {
  const payload = Buffer.from(canonicalLicence(claims))
  const signature = sign(null, payload, keys.privateKey)
  return `v1.${payload.toString('base64url')}.${signature.toString('base64url')}`
}

export function verifyLicence(token: string, publicKey: KeyObject): LicenceClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const payloadPart = parts[1] ?? ''
  const signaturePart = parts[2] ?? ''
  try {
    const payload = Buffer.from(payloadPart, 'base64url')
    const signature = Buffer.from(signaturePart, 'base64url')
    const valid = verify(null, payload, publicKey, signature)
    if (!valid) return null
    const claims = JSON.parse(payload.toString('utf8')) as LicenceClaims
    if (claims.v !== 1 || claims.status !== 'active') return null
    if (canonicalLicence(claims) !== payload.toString('utf8')) return null
    return claims
  } catch {
    return null
  }
}
