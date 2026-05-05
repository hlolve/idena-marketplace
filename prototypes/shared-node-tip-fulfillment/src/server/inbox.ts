import {hexToString, normalizeAddress} from '../shared/encoding'
import {parseDirectMessageEnvelope, type DirectMessageRecord} from '../shared/directMessages'
import {parseSendMessageEvent, SOCIAL_SEND_MESSAGE_METHOD} from '../shared/idenaSocial'
import {decryptLocalSecret, loadState} from './store'
import {RpcClient} from './rpc'
import {
  getContractBalanceUpdates,
  getEventByName,
  getTimestampSeconds,
  getTransactionEvents,
  getUpdateHash,
  isInterestingSocialUpdate,
} from './indexer'

async function getInboxRpc() {
  const state = await loadState()
  const readRpcUrl = state.config.readRpcUrl || state.config.rpcUrl
  const readRpcKey =
    await decryptLocalSecret(state.config.readRpcKeyEncrypted || state.config.rpcKeyEncrypted)
  return new RpcClient(readRpcUrl, readRpcKey)
}

async function readEnvelopeText(messageRef: string) {
  if (!messageRef.startsWith('ipfs://')) return messageRef

  const cid = messageRef.slice('ipfs://'.length)
  if (!cid) throw new Error('Missing IPFS CID')

  const rpc = await getInboxRpc()
  const result = await rpc.call<string>('ipfs_get', [cid])
  if (!result) throw new Error('Unable to read encrypted envelope from IPFS')
  return hexToString(result)
}

async function resolveEnvelope(message: Omit<DirectMessageRecord, 'envelope' | 'envelopeText' | 'invalidReason'>) {
  try {
    const envelopeText = await readEnvelopeText(message.messageRef)
    return {
      envelopeText,
      envelope: parseDirectMessageEnvelope(envelopeText, message.sender),
    }
  } catch (error) {
    return {
      invalidReason: error instanceof Error ? error.message : 'Unable to resolve encrypted envelope',
    }
  }
}

export async function scanInboxMessages(activeAddress: string, limit = 150): Promise<DirectMessageRecord[]> {
  const state = await loadState()
  const normalizedAddress = normalizeAddress(activeAddress)
  if (!normalizedAddress || !normalizedAddress.startsWith('0x')) {
    throw new Error('A candidate address is required')
  }

  const updates = await getContractBalanceUpdates(
    state.config.indexerUrl,
    state.config.socialContract,
    Math.max(1, Math.min(limit, 500)),
  )
  const records: DirectMessageRecord[] = []

  for (const update of updates.filter(isInterestingSocialUpdate)) {
    if (update.txReceipt?.method !== SOCIAL_SEND_MESSAGE_METHOD) continue

    const txHash = getUpdateHash(update)
    if (!txHash) continue

    const events = await getTransactionEvents(state.config.indexerUrl, txHash)
    const event = getEventByName(events, SOCIAL_SEND_MESSAGE_METHOD)
    if (!event?.data) continue

    const parsed = parseSendMessageEvent(
      {
        txHash,
        timestamp: getTimestampSeconds(update.timestamp),
        eventArgs: event.data,
      },
      normalizedAddress,
    )
    if (!parsed) continue

    const baseRecord: DirectMessageRecord = {
      ...parsed,
      encrypted: parsed.encrypted,
    }

    if (baseRecord.encrypted) {
      const resolved = await resolveEnvelope(baseRecord)
      records.push({...baseRecord, ...resolved})
    } else {
      records.push(baseRecord)
    }
  }

  return records.sort((left, right) => right.timestamp - left.timestamp)
}
