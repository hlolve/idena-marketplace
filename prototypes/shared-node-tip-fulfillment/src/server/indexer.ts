import {SOCIAL_SEND_MESSAGE_METHOD, SOCIAL_SEND_TIP_METHOD} from '../shared/idenaSocial'

export type IndexerBalanceUpdate = {
  hash?: string
  txHash?: string
  timestamp?: string | number
  blockHeight?: number
  height?: number
  type?: string
  from?: string
  address?: string
  txReceipt?: {
    method?: string
    success?: boolean
  }
}

export type IndexerEvent = {
  eventName?: string
  data?: string[]
}

function getBase(indexerUrl: string) {
  return indexerUrl.replace(/\/+$/, '')
}

async function getJson<T>(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Indexer HTTP ${response.status}`)
  return (await response.json()) as T
}

export function getTimestampSeconds(value: string | number | undefined): number {
  if (!value) return Math.floor(Date.now() / 1000)
  if (typeof value === 'number') return value > 1000000000000 ? Math.floor(value / 1000) : value
  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
  const numeric = Number(value)
  return Number.isFinite(numeric) ? getTimestampSeconds(numeric) : Math.floor(Date.now() / 1000)
}

export async function getContractBalanceUpdates(indexerUrl: string, contractAddress: string, limit = 50) {
  const params = new URLSearchParams({limit: String(limit)})
  const url = `${getBase(indexerUrl)}/api/Contract/${contractAddress}/BalanceUpdates?${params}`
  const body = await getJson<{result?: IndexerBalanceUpdate[]}>(url)
  return body.result || []
}

export async function getTransactionEvents(indexerUrl: string, txHash: string) {
  const params = new URLSearchParams({limit: '10'})
  const url = `${getBase(indexerUrl)}/api/Transaction/${txHash}/Events?${params}`
  const body = await getJson<{result?: IndexerEvent[]}>(url)
  return body.result || []
}

export function isInterestingSocialUpdate(update: IndexerBalanceUpdate) {
  if (update.type && update.type !== 'CallContract') return false
  if (update.txReceipt?.success === false) return false
  return [SOCIAL_SEND_TIP_METHOD, SOCIAL_SEND_MESSAGE_METHOD].includes(update.txReceipt?.method || '')
}

export function getUpdateHash(update: IndexerBalanceUpdate) {
  return update.hash || update.txHash || ''
}

export function getEventByName(events: IndexerEvent[], eventName: string) {
  return events.find(event => event.eventName === eventName && Array.isArray(event.data))
}
