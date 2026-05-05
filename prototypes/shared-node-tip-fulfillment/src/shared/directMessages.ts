import {secp256k1} from '@noble/curves/secp256k1.js'
import {bytesToHex, base64UrlDecode, base64UrlEncode, bytesToText, hexToBytes, normalizeAddress, textToBytes} from './encoding'
import {privateKeyToAddress, privateKeyToPublicKey, publicKeyToAddress} from './keys'

export const dmAlgorithm = 'secp256k1-ecdh/aes-256-gcm'

const dmInfo = textToBytes('idena.social/dm/v1')

export type DirectMessageEnvelopeV1 = {
  v: 1
  alg: typeof dmAlgorithm
  sender: string
  recipient: string
  senderPubkey: string
  salt: string
  iv: string
  ciphertext: string
}

export type DirectMessageRecord = {
  txHash: string
  timestamp: number
  sender: string
  recipient: string
  channelId: string
  messageRef: string
  encrypted: boolean
  replyToMessageTxId: string
  envelope?: DirectMessageEnvelopeV1
  envelopeText?: string
  invalidReason?: string
}

function getCryptoApi() {
  const api = globalThis.crypto
  if (!api?.subtle) throw new Error('Web Crypto API unavailable')
  return api
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return Uint8Array.from(bytes).buffer as ArrayBuffer
}

function getSharedSecretBytes(privateKey: Uint8Array, publicKey: Uint8Array) {
  return secp256k1.getSharedSecret(privateKey, publicKey, false).slice(1)
}

async function deriveDmAesKey(sharedSecret: Uint8Array, salt: Uint8Array, keyUsages: KeyUsage[]) {
  const inputKey = await getCryptoApi().subtle.importKey(
    'raw',
    toBufferSource(sharedSecret),
    'HKDF',
    false,
    ['deriveKey'],
  )

  return getCryptoApi().subtle.deriveKey(
    {name: 'HKDF', hash: 'SHA-256', salt: toBufferSource(salt), info: toBufferSource(dmInfo)},
    inputKey,
    {name: 'AES-GCM', length: 256},
    false,
    keyUsages,
  )
}

export async function encryptDirectMessage(input: {
  senderPrivateKey: Uint8Array
  senderAddress: string
  recipientAddress: string
  recipientPubkey: string
  plaintext: string
}) {
  const salt = getCryptoApi().getRandomValues(new Uint8Array(32))
  const iv = getCryptoApi().getRandomValues(new Uint8Array(12))
  const recipientPubkey = hexToBytes(input.recipientPubkey)
  const senderPubkey = privateKeyToPublicKey(input.senderPrivateKey)
  const sharedSecret = getSharedSecretBytes(input.senderPrivateKey, recipientPubkey)
  const aesKey = await deriveDmAesKey(sharedSecret, salt, ['encrypt'])
  const ciphertext = await getCryptoApi().subtle.encrypt(
    {name: 'AES-GCM', iv: toBufferSource(iv)},
    aesKey,
    toBufferSource(textToBytes(input.plaintext)),
  )

  return {
    v: 1,
    alg: dmAlgorithm,
    sender: normalizeAddress(input.senderAddress),
    recipient: normalizeAddress(input.recipientAddress),
    senderPubkey: base64UrlEncode(senderPubkey),
    salt: base64UrlEncode(salt),
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  } satisfies DirectMessageEnvelopeV1
}

export function parseDirectMessageEnvelope(envelopeText: string, expectedSender?: string) {
  const parsed = JSON.parse(envelopeText) as DirectMessageEnvelopeV1
  if (
    parsed?.v !== 1 ||
    parsed.alg !== dmAlgorithm ||
    typeof parsed.sender !== 'string' ||
    typeof parsed.recipient !== 'string' ||
    typeof parsed.senderPubkey !== 'string' ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.ciphertext !== 'string'
  ) {
    throw new Error('Invalid encrypted envelope')
  }

  const senderPubkey = base64UrlDecode(parsed.senderPubkey)
  const normalizedSender = normalizeAddress(parsed.sender)
  if (expectedSender && normalizedSender !== normalizeAddress(expectedSender)) {
    throw new Error('Envelope sender does not match transaction sender')
  }
  if (publicKeyToAddress(senderPubkey) !== normalizedSender) {
    throw new Error('Envelope sender public key is invalid')
  }

  return {
    ...parsed,
    sender: normalizedSender,
    recipient: normalizeAddress(parsed.recipient),
  }
}

export async function decryptDirectMessage(input: {
  activePrivateKey: Uint8Array
  activeAddress?: string
  envelope: DirectMessageEnvelopeV1
  recipientPubkey?: string
}) {
  const activeAddress = normalizeAddress(input.activeAddress || privateKeyToAddress(input.activePrivateKey))
  const isOutgoing = normalizeAddress(input.envelope.sender) === activeAddress
  const isIncoming = normalizeAddress(input.envelope.recipient) === activeAddress
  if (!isOutgoing && !isIncoming) {
    throw new Error('Envelope is not addressed to this identity')
  }

  const peerPubkey = isOutgoing
    ? input.recipientPubkey
    : bytesToHex(base64UrlDecode(input.envelope.senderPubkey))

  if (!peerPubkey) throw new Error('Missing counterparty public key')

  const sharedSecret = getSharedSecretBytes(input.activePrivateKey, hexToBytes(peerPubkey))
  const aesKey = await deriveDmAesKey(sharedSecret, base64UrlDecode(input.envelope.salt), ['decrypt'])
  const decrypted = await getCryptoApi().subtle.decrypt(
    {name: 'AES-GCM', iv: toBufferSource(base64UrlDecode(input.envelope.iv))},
    aesKey,
    toBufferSource(base64UrlDecode(input.envelope.ciphertext)),
  )
  return bytesToText(new Uint8Array(decrypted))
}
