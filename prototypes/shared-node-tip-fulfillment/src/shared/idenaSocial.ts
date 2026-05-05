import {compareDna, hexToString, littleEndianHexToBigInt, normalizeAddress, stringToHex, toDna} from './encoding'

export const SOCIAL_CONTRACT_CURRENT = '0x18b0a55eb99AcA113f50eEBbdeAf6f96E789277f'
export const SOCIAL_SEND_TIP_METHOD = 'sendTip'
export const SOCIAL_SEND_MESSAGE_METHOD = 'sendMessage'

export type PaymentEvent = {
  source: 'idena.social.sendTip' | 'wallet.transfer'
  txHash: string
  blockHeight?: number
  payer: string
  recipient: string
  amountDna: string
  postId?: string
  timestamp: number
}

export type SendTipTransaction = {
  txHash: string
  timestamp: number
  blockHeight?: number
  eventArgs: string[]
}

export type SendMessageTransaction = {
  txHash: string
  timestamp: number
  eventArgs: string[]
}

export function parseCurrentSendTipEvent(tx: SendTipTransaction): PaymentEvent {
  const [payer, recipient, postIdHex, tipAmountHex] = tx.eventArgs
  if (!payer || !recipient || !postIdHex || !tipAmountHex) {
    throw new Error('Invalid sendTip event arguments')
  }

  return {
    source: 'idena.social.sendTip',
    txHash: tx.txHash,
    blockHeight: tx.blockHeight,
    payer: normalizeAddress(payer),
    recipient: normalizeAddress(recipient),
    postId: littleEndianHexToBigInt(postIdHex).toString(10),
    amountDna: toDna(BigInt(tipAmountHex)),
    timestamp: tx.timestamp,
  }
}

export function qualifiesPayment(payment: PaymentEvent, options: {
  postId: string
  recipient: string
  minAmountDna: string
}) {
  return (
    payment.source === 'idena.social.sendTip' &&
    payment.postId === options.postId &&
    normalizeAddress(payment.recipient) === normalizeAddress(options.recipient) &&
    compareDna(payment.amountDna, options.minAmountDna) >= 0
  )
}

export function buildSendMessageArgs(recipient: string, messageRef: string) {
  return [
    {
      format: 'string',
      index: 0,
      value: JSON.stringify({
        recipient: normalizeAddress(recipient),
        message: messageRef,
        encrypted: true,
        channelId: '',
        replyToMessageTxId: '',
      }),
    },
  ]
}

export function parseSendMessageEvent(tx: SendMessageTransaction, activeAddress: string) {
  const [sender, recipientHex, channelIdHex, messageRefHex, encryptedHex, replyToMessageTxIdHex] = tx.eventArgs
  const recipient = normalizeAddress(hexToString(recipientHex))
  const normalizedSender = normalizeAddress(sender)
  const normalizedActive = normalizeAddress(activeAddress)
  if (recipient !== normalizedActive && normalizedSender !== normalizedActive) return null

  return {
    txHash: tx.txHash,
    timestamp: tx.timestamp,
    sender: normalizedSender,
    recipient,
    channelId: hexToString(channelIdHex || '0x'),
    messageRef: hexToString(messageRefHex || '0x'),
    encrypted: hexToString(encryptedHex || stringToHex('false')) === 'true',
    replyToMessageTxId: hexToString(replyToMessageTxIdHex || '0x'),
  }
}
