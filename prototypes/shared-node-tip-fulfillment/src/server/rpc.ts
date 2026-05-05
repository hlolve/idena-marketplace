export type RpcResponse<T = unknown> = {
  result?: T
  error?: {
    message?: string
  }
}

export class RpcClient {
  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  async call<T = unknown>(method: string, params: unknown[] = []) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        method,
        params,
        id: 1,
        key: this.key,
      }),
    })

    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}`)
    }

    const body = (await response.json()) as RpcResponse<T>
    if (body.error) throw new Error(body.error.message || 'RPC error')
    return body.result as T
  }
}

export type IdentityResult = {
  address: string
  pubkey?: string
  state?: string
  age?: number
  stake?: string
}

export type BalanceResult = {
  nonce: number
  balance: string
}

export type EpochResult = {
  epoch: number
}
