import {bytesToHex, normalizeAddress, textToBytes} from '../shared/encoding'
import {decryptPrivateKeyBackup, privateKeyToAddress} from '../shared/keys'
import {encryptDirectMessage} from '../shared/directMessages'
import {
  buildSendMessageArgs,
  parseCurrentSendTipEvent,
  qualifiesPayment,
  SOCIAL_SEND_MESSAGE_METHOD,
  SOCIAL_SEND_TIP_METHOD,
  type PaymentEvent,
} from '../shared/idenaSocial'
import {
  decryptLocalSecret,
  loadState,
  markScan,
  saveState,
  touchPayment,
  type AppState,
} from './store'
import {type BalanceResult, type EpochResult, type IdentityResult, RpcClient} from './rpc'
import {
  getContractBalanceUpdates,
  getEventByName,
  getTimestampSeconds,
  getTransactionEvents,
  getUpdateHash,
  isInterestingSocialUpdate,
} from './indexer'

function nextNonce(balance: BalanceResult) {
  return Number(balance.nonce || 0) + 1
}

function paymentMessage(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, value),
    template,
  )
}

async function getProviderRpc(state: AppState) {
  return new RpcClient(
    state.config.rpcUrl,
    await decryptLocalSecret(state.config.rpcKeyEncrypted),
  )
}

async function reserveKey(state: AppState, payment: PaymentEvent) {
  const existing = state.payments[payment.txHash]
  if (existing?.keyId) return state.keys.find(key => key.id === existing.keyId)

  const key = state.keys.find(item => item.status === 'available')
  if (!key) throw new Error('No available API keys in the pool')

  key.status = 'reserved'
  key.assignedTo = payment.payer
  key.paymentTxHash = payment.txHash
  key.updatedAt = new Date().toISOString()
  return key
}

async function sendApiKeyDm(state: AppState, payment: PaymentEvent, apiKey: string) {
  const rpc = await getProviderRpc(state)
  const providerAddress =
    state.config.providerAddress ||
    await rpc.call<string>('dna_getCoinbaseAddr', [])
  const normalizedProviderAddress = normalizeAddress(providerAddress)

  const recipientIdentity = await rpc.call<IdentityResult>('dna_identity', [payment.payer])
  if (!recipientIdentity?.pubkey) {
    throw new Error('Recipient identity has no public key')
  }

  const exportedKey = await rpc.call<string>('dna_exportKey', [
    await decryptLocalSecret(state.config.nodePasswordEncrypted),
  ])
  const providerPrivateKey = await decryptPrivateKeyBackup(
    exportedKey,
    await decryptLocalSecret(state.config.nodePasswordEncrypted),
  )

  const derivedAddress = privateKeyToAddress(providerPrivateKey)
  if (derivedAddress !== normalizedProviderAddress) {
    providerPrivateKey.fill(0)
    throw new Error('Exported node key does not match provider address')
  }

  const plaintext = paymentMessage(state.config.messageTemplate, {
    sharedNodeUrl: state.config.sharedNodeUrl || state.config.rpcUrl,
    apiKey,
    payer: payment.payer,
    paymentTxHash: payment.txHash,
    amountDna: payment.amountDna,
    postId: payment.postId || '',
  })

  const envelope = await encryptDirectMessage({
    senderPrivateKey: providerPrivateKey,
    senderAddress: normalizedProviderAddress,
    recipientAddress: payment.payer,
    recipientPubkey: recipientIdentity.pubkey,
    plaintext,
  })
  providerPrivateKey.fill(0)

  const envelopeHex = bytesToHex(textToBytes(JSON.stringify(envelope)), true)
  const cid = await rpc.call<string>('ipfs_add', [envelopeHex, true])
  if (!cid) throw new Error('Unable to store encrypted message in IPFS')

  const balance = await rpc.call<BalanceResult>('dna_getBalance', [normalizedProviderAddress])
  const epoch = await rpc.call<EpochResult>('dna_epoch', [])
  await rpc.call('dna_storeToIpfs', [{cid, nonce: nextNonce(balance), epoch: epoch.epoch}])

  const messageRef = `ipfs://${cid}`
  const txHash = await rpc.call<string>('contract_call', [
    {
      from: normalizedProviderAddress,
      contract: state.config.socialContract,
      method: SOCIAL_SEND_MESSAGE_METHOD,
      amount: '0',
      args: buildSendMessageArgs(payment.payer, messageRef),
      maxFee: state.config.maxFeeDna,
    },
  ])

  return txHash || ''
}

async function processPayment(state: AppState, payment: PaymentEvent) {
  const existing = state.payments[payment.txHash]
  if (existing?.status === 'dm_sent') return

  const record = existing || {
    payment,
    status: 'qualified' as const,
    attempts: 0,
    updatedAt: new Date().toISOString(),
  }
  state.payments[payment.txHash] = record

  try {
    record.attempts += 1
    const key = await reserveKey(state, payment)
    if (!key) throw new Error('No available API key in the pool')
    record.keyId = key.id
    record.status = 'key_reserved'
    touchPayment(record)

    const apiKey = await decryptLocalSecret(key.keyEncrypted)
    const messageTxHash = await sendApiKeyDm(state, payment, apiKey)
    key.status = 'sent'
    key.updatedAt = new Date().toISOString()
    record.status = 'dm_sent'
    record.messageTxHash = messageTxHash
    record.error = undefined
    touchPayment(record)
  } catch (error) {
    record.status = 'failed'
    record.error = error instanceof Error ? error.message : 'Unknown fulfillment error'
    touchPayment(record)
  }
}

export async function scanAndFulfill() {
  const state = await loadState()
  if (!state.config.enabled) {
    markScan(state, 'Watcher is disabled')
    await saveState(state)
    return state.lastScan
  }
  if (!state.config.rentalPostId || !state.config.providerAddress) {
    markScan(state, 'Missing rental post ID or provider address')
    await saveState(state)
    return state.lastScan
  }

  const updates = await getContractBalanceUpdates(state.config.indexerUrl, state.config.socialContract, 75)
  let qualified = 0

  for (const update of updates.filter(isInterestingSocialUpdate)) {
    if (update.txReceipt?.method !== SOCIAL_SEND_TIP_METHOD) continue
    const txHash = getUpdateHash(update)
    if (!txHash || state.payments[txHash]?.status === 'dm_sent') continue

    const events = await getTransactionEvents(state.config.indexerUrl, txHash)
    const event = getEventByName(events, SOCIAL_SEND_TIP_METHOD)
    if (!event?.data) continue

    const payment = parseCurrentSendTipEvent({
      txHash,
      blockHeight: update.blockHeight || update.height,
      timestamp: getTimestampSeconds(update.timestamp),
      eventArgs: event.data,
    })

    if (
      qualifiesPayment(payment, {
        postId: state.config.rentalPostId,
        recipient: state.config.providerAddress,
        minAmountDna: state.config.minTipDna,
      })
    ) {
      qualified += 1
      await processPayment(state, payment)
    } else if (!state.payments[payment.txHash]) {
      state.payments[payment.txHash] = {
        payment,
        status: 'ignored',
        attempts: 0,
        updatedAt: new Date().toISOString(),
      }
    }
  }

  markScan(state, `Scanned ${updates.length} updates, found ${qualified} qualifying payment(s)`)
  await saveState(state)
  return state.lastScan
}

export async function retryPayment(txHash: string) {
  const state = await loadState()
  const record = state.payments[txHash]
  if (!record) throw new Error('Payment not found')
  await processPayment(state, record.payment)
  await saveState(state)
}
