import {describe, expect, it} from 'vitest'
import {extractSharedNodeConnection} from './connection'

describe('shared node connection parsing', () => {
  it('extracts credentials from a decrypted shared-node DM', () => {
    expect(extractSharedNodeConnection(
      'Shared node URL: https://shared-node.example\nNode API key: example-api-key',
    )).toEqual({
      url: 'https://shared-node.example',
      apiKey: 'example-api-key',
    })
  })

  it('ignores messages without both fields', () => {
    expect(extractSharedNodeConnection('hello')).toBeNull()
  })
})
