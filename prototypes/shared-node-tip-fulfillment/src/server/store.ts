import fs from 'node:fs/promises'
import path from 'node:path'
import {randomBytes, createCipheriv, createDecipheriv} from 'node:crypto'
import type {PaymentEvent} from '../shared/idenaSocial'

export type ProviderConfig = {
  enabled: boolean
  indexerUrl: string
  socialContract: string
  rentalPostId: string
  minTipDna: string
  providerAddress: string
  sharedNodeUrl: string
  rpcUrl: string
  readRpcUrl: string
  messageTemplate: string
  maxFeeDna: string
  scanIntervalSeconds: number
  rpcKeyEncrypted?: string
  nodePasswordEncrypted?: string
  readRpcKeyEncrypted?: string
}

export type KeyPoolEntry = {
  id: string
  label: string
  keyEncrypted: string
  status: 'available' | 'reserved' | 'sent'
  assignedTo?: string
  paymentTxHash?: string
  createdAt: string
  updatedAt: string
}

export type PaymentRecord = {
  payment: PaymentEvent
  status: 'qualified' | 'key_reserved' | 'dm_sent' | 'failed' | 'ignored'
  keyId?: string
  messageTxHash?: string
  attempts: number
  error?: string
  updatedAt: string
}

export type AppState = {
  config: ProviderConfig
  keys: KeyPoolEntry[]
  payments: Record<string, PaymentRecord>
  lastScan?: {
    at: string
    result: string
  }
}

const defaultConfig: ProviderConfig = {
  enabled: false,
  indexerUrl: 'https://api.idena.io',
  socialContract: '0x18b0a55eb99AcA113f50eEBbdeAf6f96E789277f',
  rentalPostId: '',
  minTipDna: '1',
  providerAddress: '',
  sharedNodeUrl: '',
  rpcUrl: 'http://127.0.0.1:9009',
  readRpcUrl: 'https://restricted.idena.io',
  messageTemplate:
    'Shared node URL: {{sharedNodeUrl}}\nNode API key: {{apiKey}}\n\nPayment: {{paymentTxHash}}',
  maxFeeDna: '0.05',
  scanIntervalSeconds: 30,
}

function nowIso() {
  return new Date().toISOString()
}

function getDataDir() {
  return path.resolve(process.env.DATA_DIR || './data')
}

async function ensureDataDir() {
  await fs.mkdir(getDataDir(), {recursive: true})
}

async function getVaultSecret() {
  await ensureDataDir()
  const secretPath = path.join(getDataDir(), '.vault-secret')
  try {
    const existing = await fs.readFile(secretPath, 'utf8')
    return Buffer.from(existing.trim(), 'hex')
  } catch {
    const secret = randomBytes(32)
    await fs.writeFile(secretPath, secret.toString('hex'), {mode: 0o600})
    return secret
  }
}

export async function encryptLocalSecret(value: string) {
  const key = await getVaultSecret()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

export async function decryptLocalSecret(value?: string) {
  if (!value) return ''
  const key = await getVaultSecret()
  const payload = Buffer.from(value, 'base64url')
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const ciphertext = payload.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

async function statePath() {
  await ensureDataDir()
  return path.join(getDataDir(), 'state.json')
}

export async function loadState(): Promise<AppState> {
  try {
    const raw = await fs.readFile(await statePath(), 'utf8')
    const parsed = JSON.parse(raw) as AppState
    return {
      config: {...defaultConfig, ...(parsed.config || {})},
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      payments: parsed.payments || {},
      lastScan: parsed.lastScan,
    }
  } catch {
    return {
      config: {...defaultConfig},
      keys: [],
      payments: {},
    }
  }
}

export async function saveState(state: AppState) {
  const file = await statePath()
  const tmpFile = `${file}.tmp`
  await fs.writeFile(tmpFile, `${JSON.stringify(state, null, 2)}\n`)
  await fs.rename(tmpFile, file)
}

export async function updateState<T>(mutator: (state: AppState) => T | Promise<T>) {
  const state = await loadState()
  const result = await mutator(state)
  await saveState(state)
  return result
}

export async function publicState() {
  const state = await loadState()
  return {
    config: {
      ...state.config,
      rpcKeyConfigured: Boolean(state.config.rpcKeyEncrypted),
      nodePasswordConfigured: Boolean(state.config.nodePasswordEncrypted),
      readRpcKeyConfigured: Boolean(state.config.readRpcKeyEncrypted),
      rpcKeyEncrypted: undefined,
      nodePasswordEncrypted: undefined,
      readRpcKeyEncrypted: undefined,
    },
    keys: state.keys.map(key => ({
      id: key.id,
      label: key.label,
      status: key.status,
      assignedTo: key.assignedTo,
      paymentTxHash: key.paymentTxHash,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
    })),
    payments: Object.values(state.payments).sort((left, right) => right.payment.timestamp - left.payment.timestamp),
    lastScan: state.lastScan,
  }
}

export function createKeyEntry(label: string, keyEncrypted: string): KeyPoolEntry {
  const stamp = nowIso()
  return {
    id: randomBytes(8).toString('hex'),
    label,
    keyEncrypted,
    status: 'available',
    createdAt: stamp,
    updatedAt: stamp,
  }
}

export function markScan(state: AppState, result: string) {
  state.lastScan = {at: nowIso(), result}
}

export function touchPayment(payment: PaymentRecord) {
  payment.updatedAt = nowIso()
}
