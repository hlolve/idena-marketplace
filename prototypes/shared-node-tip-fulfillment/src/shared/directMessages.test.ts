import {describe, expect, it} from 'vitest'
import {sha3_256} from '@noble/hashes/sha3.js'
import {bytesToHex, textToBytes} from './encoding'
import {decryptPrivateKeyBackup, privateKeyToAddress, privateKeyToPublicKey} from './keys'
import {decryptDirectMessage, encryptDirectMessage, parseDirectMessageEnvelope} from './directMessages'

function privateKey(value: number) {
  const key = new Uint8Array(32)
  key[31] = value
  return key
}

function concatBytes(...parts: Uint8Array[]) {
  const total = parts.reduce((length, part) => length + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

async function encryptIdenaWebKey(keyBytes: Uint8Array, password: string) {
  const nonce = Uint8Array.from([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144])
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(sha3_256(textToBytes(password))).buffer as ArrayBuffer,
    'AES-GCM',
    false,
    ['encrypt'],
  )
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    {name: 'AES-GCM', iv: Uint8Array.from(nonce).buffer as ArrayBuffer},
    cryptoKey,
    Uint8Array.from(keyBytes).buffer as ArrayBuffer,
  ))
  return bytesToHex(concatBytes(nonce, encrypted))
}

describe('direct message crypto', () => {
  it('decrypts a PR #3 envelope with a local idena-web private key', async () => {
    const senderPrivateKey = privateKey(1)
    const receiverPrivateKey = privateKey(2)
    const encryptedReceiverKey = await encryptIdenaWebKey(receiverPrivateKey, 'pass')
    const unlockedReceiverKey = await decryptPrivateKeyBackup(encryptedReceiverKey, 'pass')

    const envelope = await encryptDirectMessage({
      senderPrivateKey,
      senderAddress: privateKeyToAddress(senderPrivateKey),
      recipientAddress: privateKeyToAddress(receiverPrivateKey),
      recipientPubkey: bytesToHex(privateKeyToPublicKey(receiverPrivateKey)),
      plaintext: 'Shared node URL: https://shared-node.example\nNode API key: example-api-key',
    })

    const parsed = parseDirectMessageEnvelope(JSON.stringify(envelope), privateKeyToAddress(senderPrivateKey))
    await expect(decryptDirectMessage({
      activePrivateKey: unlockedReceiverKey,
      envelope: parsed,
    })).resolves.toContain('example-api-key')
  })

  it('rejects an unrelated identity', async () => {
    const senderPrivateKey = privateKey(1)
    const receiverPrivateKey = privateKey(2)
    const wrongPrivateKey = privateKey(3)
    const envelope = await encryptDirectMessage({
      senderPrivateKey,
      senderAddress: privateKeyToAddress(senderPrivateKey),
      recipientAddress: privateKeyToAddress(receiverPrivateKey),
      recipientPubkey: bytesToHex(privateKeyToPublicKey(receiverPrivateKey)),
      plaintext: 'secret',
    })

    await expect(decryptDirectMessage({
      activePrivateKey: wrongPrivateKey,
      envelope,
    })).rejects.toThrow(/not addressed|decrypt/i)
  })
})
