import {describe, expect, it} from 'vitest'
import {stringToHex} from './encoding'
import {
  buildSendMessageArgs,
  parseCurrentSendTipEvent,
  parseSendMessageEvent,
  qualifiesPayment,
  type PaymentEvent,
} from './idenaSocial'

const payer = '0x1111111111111111111111111111111111111111'
const provider = '0x2222222222222222222222222222222222222222'

function addPaymentOnce(records: Record<string, PaymentEvent>, payment: PaymentEvent) {
  if (records[payment.txHash]) return false
  records[payment.txHash] = payment
  return true
}

describe('idena.social events', () => {
  it('parses sendTip as a labeled wallet transfer and qualifies by tx fields', () => {
    const payment = parseCurrentSendTipEvent({
      txHash: '0xtip',
      timestamp: 1710000000,
      blockHeight: 42,
      eventArgs: [
        payer,
        provider,
        '0x2a000000',
        '0x0de0b6b3a7640000',
      ],
    })

    expect(payment).toMatchObject({
      source: 'idena.social.sendTip',
      payer,
      recipient: provider,
      postId: '42',
      amountDna: '1',
    })
    expect(qualifiesPayment(payment, {
      postId: '42',
      recipient: provider,
      minAmountDna: '0.5',
    })).toBe(true)
  })

  it('protects payment state from duplicate tx hashes', () => {
    const first = parseCurrentSendTipEvent({
      txHash: '0xduplicate',
      timestamp: 1710000000,
      eventArgs: [payer, provider, '0x1', '0x01'],
    })
    const second = {...first, amountDna: '99'}
    const records: Record<string, PaymentEvent> = {}

    expect(addPaymentOnce(records, first)).toBe(true)
    expect(addPaymentOnce(records, second)).toBe(false)
    expect(records['0xduplicate'].amountDna).toBe(first.amountDna)
  })

  it('builds and parses sendMessage event arguments', () => {
    const args = buildSendMessageArgs(payer, 'ipfs://cid')
    expect(JSON.parse(args[0].value)).toMatchObject({
      recipient: payer,
      message: 'ipfs://cid',
      encrypted: true,
    })

    const parsed = parseSendMessageEvent({
      txHash: '0xmessage',
      timestamp: 1710000001,
      eventArgs: [
        provider,
        stringToHex(payer),
        stringToHex(''),
        stringToHex('ipfs://cid'),
        stringToHex('true'),
        stringToHex(''),
      ],
    }, payer)

    expect(parsed).toMatchObject({
      txHash: '0xmessage',
      sender: provider,
      recipient: payer,
      messageRef: 'ipfs://cid',
      encrypted: true,
    })
  })
})
