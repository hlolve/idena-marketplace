export function normalizeHex(value: string) {
  return value.startsWith('0x') ? value.slice(2) : value
}

export function normalizeAddress(address: string) {
  return address.toLowerCase()
}

export function bytesToHex(bytes: Uint8Array, prefix = false) {
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return prefix ? `0x${hex}` : hex
}

export function hexToBytes(hex: string) {
  const normalized = normalizeHex(hex)
  if (!normalized || normalized.length % 2 !== 0) return new Uint8Array(0)

  const bytes = new Uint8Array(normalized.length / 2)
  for (let idx = 0; idx < normalized.length; idx += 2) {
    bytes[idx / 2] = Number.parseInt(normalized.slice(idx, idx + 2), 16)
  }
  return bytes
}

export function textToBytes(text: string) {
  return new TextEncoder().encode(text)
}

export function bytesToText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

export function stringToHex(text: string, prefix = true) {
  return bytesToHex(textToBytes(text), prefix)
}

export function hexToString(hex: string) {
  return bytesToText(hexToBytes(hex))
}

export function base64UrlEncode(bytes: Uint8Array) {
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary =
    typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx += 1) {
    bytes[idx] = binary.charCodeAt(idx)
  }
  return bytes
}

export function littleEndianHexToBigInt(hex: string) {
  const bytes = hexToBytes(hex)
  let value = 0n
  for (let idx = bytes.length - 1; idx >= 0; idx -= 1) {
    value = (value << 8n) + BigInt(bytes[idx])
  }
  return value
}

export function hexToDecimalNumberString(hex: string) {
  return littleEndianHexToBigInt(hex).toString(10)
}

export function toDna(baseUnits: bigint | string | number) {
  const value = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits)
  const whole = value / 1_000_000_000_000_000_000n
  const fraction = value % 1_000_000_000_000_000_000n
  const trimmedFraction = fraction.toString().padStart(18, '0').replace(/0+$/, '')
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString()
}

export function compareDna(left: string, right: string) {
  const parse = (value: string) => {
    const [wholeRaw, fractionRaw = ''] = value.trim().split('.')
    const whole = wholeRaw || '0'
    const fraction = fractionRaw.padEnd(18, '0').slice(0, 18)
    return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(fraction || '0')
  }
  const leftValue = parse(left)
  const rightValue = parse(right)
  if (leftValue === rightValue) return 0
  return leftValue > rightValue ? 1 : -1
}
