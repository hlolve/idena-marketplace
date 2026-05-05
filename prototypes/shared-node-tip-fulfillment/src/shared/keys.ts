import {secp256k1} from '@noble/curves/secp256k1.js'
import {keccak_256, sha3_256} from '@noble/hashes/sha3.js'
import {bytesToHex, hexToBytes, normalizeAddress, textToBytes} from './encoding'

const exportKeyNonceSize = 12

function getCryptoApi() {
  const api = globalThis.crypto
  if (!api?.subtle) throw new Error('Web Crypto API unavailable')
  return api
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return Uint8Array.from(bytes).buffer as ArrayBuffer
}

export function privateKeyToPublicKey(privateKey: Uint8Array) {
  return secp256k1.getPublicKey(privateKey, false)
}

export function publicKeyToAddress(publicKey: Uint8Array) {
  const hash = keccak_256(publicKey.slice(1))
  return normalizeAddress(bytesToHex(hash.slice(-20), true))
}

export function privateKeyToAddress(privateKey: Uint8Array) {
  return publicKeyToAddress(privateKeyToPublicKey(privateKey))
}

export async function decryptPrivateKeyBackup(encryptedKeyHex: string, password: string) {
  if (!/^(0x)?[0-9a-fA-F]+$/.test(encryptedKeyHex.trim())) {
    throw new Error('Paste the encrypted idena-web key backup as hex, not the raw private key or placeholder text')
  }

  const encryptedBytes = hexToBytes(encryptedKeyHex)
  if (encryptedBytes.length <= exportKeyNonceSize + 16) {
    throw new Error('Encrypted key backup is too short')
  }

  const nonce = encryptedBytes.slice(0, exportKeyNonceSize)
  const ciphertext = encryptedBytes.slice(exportKeyNonceSize)
  const passwordHash = sha3_256(textToBytes(password))
  const key = await getCryptoApi().subtle.importKey(
    'raw',
    toBufferSource(passwordHash),
    'AES-GCM',
    false,
    ['decrypt'],
  )
  try {
    const decrypted = await getCryptoApi().subtle.decrypt(
      {name: 'AES-GCM', iv: toBufferSource(nonce)},
      key,
      toBufferSource(ciphertext),
    )
    return new Uint8Array(decrypted)
  } catch {
    throw new Error('Unable to decrypt key backup. Check that the encrypted idena-web key and password match')
  }
}
