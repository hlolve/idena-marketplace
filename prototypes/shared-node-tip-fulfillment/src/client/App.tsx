import {useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction} from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Database,
  Inbox,
  KeyRound,
  Lock,
  MailOpen,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import type {PaymentRecord, ProviderConfig} from '../server/store'
import type {DirectMessageRecord} from '../shared/directMessages'
import {decryptDirectMessage} from '../shared/directMessages'
import {decryptPrivateKeyBackup, privateKeyToAddress} from '../shared/keys'
import {extractSharedNodeConnection, type SharedNodeConnection} from '../shared/connection'

type PublicConfig = ProviderConfig & {
  rpcKeyConfigured?: boolean
  nodePasswordConfigured?: boolean
  readRpcKeyConfigured?: boolean
}

type PublicKeyEntry = {
  id: string
  label: string
  status: 'available' | 'reserved' | 'sent'
  assignedTo?: string
  paymentTxHash?: string
  createdAt: string
  updatedAt: string
}

type PublicState = {
  config: PublicConfig
  keys: PublicKeyEntry[]
  payments: PaymentRecord[]
  lastScan?: {
    at: string
    result: string
  }
}

type ConfigForm = PublicConfig & {
  rpcKey: string
  nodePassword: string
  readRpcKey: string
}

type DecryptedMessage = {
  body?: string
  error?: string
  connection?: SharedNodeConnection | null
}

const defaultConfig: ConfigForm = {
  enabled: false,
  indexerUrl: 'https://api.idena.io',
  socialContract: '0x18b0a55eb99AcA113f50eEBbdeAf6f96E789277f',
  rentalPostId: '',
  minTipDna: '1',
  providerAddress: '',
  sharedNodeUrl: '',
  rpcUrl: 'http://127.0.0.1:9009',
  readRpcUrl: 'https://restricted.idena.io',
  messageTemplate:
    'Shared node URL: {{sharedNodeUrl}}\nNode API key: {{apiKey}}\n\nPayment: {{paymentTxHash}}',
  maxFeeDna: '0.05',
  scanIntervalSeconds: 30,
  rpcKey: '',
  nodePassword: '',
  readRpcKey: '',
}

async function apiJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body as T
}

function statusTone(status: string) {
  if (['dm_sent', 'sent', 'available'].includes(status)) return 'good'
  if (['failed'].includes(status)) return 'bad'
  if (['ignored'].includes(status)) return 'muted'
  return 'warn'
}

function shortAddress(address?: string) {
  if (!address) return '-'
  return address.length > 14 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address
}

function formatTime(timestamp?: number) {
  if (!timestamp) return '-'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000))
}

function Field(props: {
  label: string
  value: string | number
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type || 'text'}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={event => props.onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function TextAreaField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <label className="field span-2">
      <span>{props.label}</span>
      <textarea
        rows={props.rows || 5}
        value={props.value}
        placeholder={props.placeholder}
        onChange={event => props.onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function ProviderPanel(props: {
  state?: PublicState
  config: ConfigForm
  setConfig: Dispatch<SetStateAction<ConfigForm>>
  reload: () => Promise<void>
}) {
  const [apiKeys, setApiKeys] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const patchConfig = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => {
    props.setConfig(previous => ({...previous, [key]: value}))
  }

  async function saveConfig() {
    setBusy('config')
    setError('')
    try {
      const body = {
        ...props.config,
        rpcKey: props.config.rpcKey,
        nodePassword: props.config.nodePassword,
        readRpcKey: props.config.readRpcKey,
      }
      const next = await apiJson<PublicState>('/api/config', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      props.setConfig({...next.config, rpcKey: '', nodePassword: '', readRpcKey: ''})
      await props.reload()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to save configuration')
    } finally {
      setBusy('')
    }
  }

  async function importKeys() {
    setBusy('keys')
    setError('')
    try {
      await apiJson('/api/keys/import', {
        method: 'POST',
        body: JSON.stringify({keys: apiKeys}),
      })
      setApiKeys('')
      await props.reload()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to import keys')
    } finally {
      setBusy('')
    }
  }

  async function scanNow() {
    setBusy('scan')
    setError('')
    try {
      await apiJson('/api/scan', {method: 'POST', body: JSON.stringify({})})
      await props.reload()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to scan payments')
    } finally {
      setBusy('')
    }
  }

  async function retry(txHash: string) {
    setBusy(txHash)
    setError('')
    try {
      await apiJson(`/api/payments/${txHash}/retry`, {method: 'POST', body: JSON.stringify({})})
      await props.reload()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to retry payment')
    } finally {
      setBusy('')
    }
  }

  const keyCounts = useMemo(() => {
    const counts = {available: 0, reserved: 0, sent: 0}
    for (const key of props.state?.keys || []) counts[key.status] += 1
    return counts
  }, [props.state?.keys])

  return (
    <div className="stack">
      <section className="toolbar">
        <div className="status-row">
          <span className={`pill ${props.config.enabled ? 'good' : 'muted'}`}>
            {props.config.enabled ? <ShieldCheck size={16} /> : <Lock size={16} />}
            {props.config.enabled ? 'Watcher active' : 'Watcher paused'}
          </span>
          <span className="pill"><KeyRound size={16} />{keyCounts.available} available</span>
          <span className="pill"><Send size={16} />{keyCounts.sent} sent</span>
        </div>
        <div className="actions">
          <button type="button" onClick={scanNow} disabled={busy === 'scan'}>
            <RefreshCw size={16} />
            Scan
          </button>
          <button type="button" className="primary" onClick={saveConfig} disabled={busy === 'config'}>
            <Save size={16} />
            Save
          </button>
        </div>
      </section>

      {error && <p className="alert"><CircleAlert size={16} />{error}</p>}
      {props.state?.lastScan && (
        <p className="notice">
          <CheckCircle2 size={16} />
          {props.state.lastScan.result} · {new Date(props.state.lastScan.at).toLocaleString()}
        </p>
      )}

      <section className="surface">
        <div className="section-title">
          <Settings2 size={18} />
          <h2>Provider Settings</h2>
        </div>
        <div className="grid-form">
          <label className="switch-row">
            <input
              type="checkbox"
              checked={props.config.enabled}
              onChange={event => patchConfig('enabled', event.currentTarget.checked)}
            />
            <span>Enable watcher</span>
          </label>
          <Field label="Rental post ID" value={props.config.rentalPostId} onChange={value => patchConfig('rentalPostId', value)} />
          <Field label="Provider address" value={props.config.providerAddress} onChange={value => patchConfig('providerAddress', value)} />
          <Field label="Shared node URL" value={props.config.sharedNodeUrl} onChange={value => patchConfig('sharedNodeUrl', value)} />
          <Field label="Minimum tip DNA" value={props.config.minTipDna} onChange={value => patchConfig('minTipDna', value)} />
          <Field label="Max fee DNA" value={props.config.maxFeeDna} onChange={value => patchConfig('maxFeeDna', value)} />
          <Field
            label="Scan interval seconds"
            type="number"
            value={props.config.scanIntervalSeconds}
            onChange={value => patchConfig('scanIntervalSeconds', Number(value || 30))}
          />
          <TextAreaField
            label="Message template"
            value={props.config.messageTemplate}
            onChange={value => patchConfig('messageTemplate', value)}
          />
        </div>
      </section>

      <section className="surface">
        <div className="section-title">
          <Database size={18} />
          <h2>Endpoints</h2>
        </div>
        <div className="grid-form">
          <Field label="Indexer URL" value={props.config.indexerUrl} onChange={value => patchConfig('indexerUrl', value)} />
          <Field label="Social contract" value={props.config.socialContract} onChange={value => patchConfig('socialContract', value)} />
          <Field label="Writable RPC URL" value={props.config.rpcUrl} onChange={value => patchConfig('rpcUrl', value)} />
          <Field
            label={props.config.rpcKeyConfigured ? 'Writable RPC key configured' : 'Writable RPC key'}
            type="password"
            value={props.config.rpcKey}
            placeholder={props.config.rpcKeyConfigured ? 'leave blank to keep current key' : ''}
            onChange={value => patchConfig('rpcKey', value)}
          />
          <Field
            label={props.config.nodePasswordConfigured ? 'Node password configured' : 'Node password'}
            type="password"
            value={props.config.nodePassword}
            placeholder={props.config.nodePasswordConfigured ? 'leave blank to keep current password' : ''}
            onChange={value => patchConfig('nodePassword', value)}
          />
          <Field label="Read RPC URL" value={props.config.readRpcUrl} onChange={value => patchConfig('readRpcUrl', value)} />
          <Field
            label={props.config.readRpcKeyConfigured ? 'Read RPC key configured' : 'Read RPC key'}
            type="password"
            value={props.config.readRpcKey}
            placeholder={props.config.readRpcKeyConfigured ? 'leave blank to keep current key' : ''}
            onChange={value => patchConfig('readRpcKey', value)}
          />
        </div>
      </section>

      <section className="surface split">
        <div>
          <div className="section-title">
            <KeyRound size={18} />
            <h2>Key Pool</h2>
          </div>
          <textarea
            className="key-import"
            rows={7}
            value={apiKeys}
            placeholder="one API key per line"
            onChange={event => setApiKeys(event.currentTarget.value)}
          />
          <button type="button" onClick={importKeys} disabled={!apiKeys.trim() || busy === 'keys'}>
            <KeyRound size={16} />
            Import
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Status</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {(props.state?.keys || []).map(key => (
                <tr key={key.id}>
                  <td>{key.label}</td>
                  <td><span className={`tag ${statusTone(key.status)}`}>{key.status}</span></td>
                  <td>{shortAddress(key.assignedTo)}</td>
                </tr>
              ))}
              {!props.state?.keys.length && (
                <tr><td colSpan={3} className="empty">No keys imported</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface">
        <div className="section-title">
          <WalletCards size={18} />
          <h2>Payments</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Payer</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Message tx</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(props.state?.payments || []).map(record => (
                <tr key={record.payment.txHash}>
                  <td>{formatTime(record.payment.timestamp)}</td>
                  <td title={record.payment.payer}>{shortAddress(record.payment.payer)}</td>
                  <td>{record.payment.amountDna}</td>
                  <td>
                    <span className={`tag ${statusTone(record.status)}`}>{record.status}</span>
                    {record.error && <span className="row-error">{record.error}</span>}
                  </td>
                  <td title={record.messageTxHash}>{shortAddress(record.messageTxHash)}</td>
                  <td>
                    {record.status === 'failed' && (
                      <button type="button" className="icon-button" title="Retry" onClick={() => retry(record.payment.txHash)} disabled={busy === record.payment.txHash}>
                        <RefreshCw size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!props.state?.payments.length && (
                <tr><td colSpan={6} className="empty">No payments scanned</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function CandidateInbox() {
  const [encryptedKey, setEncryptedKey] = useState('')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState<Uint8Array | null>(null)
  const [address, setAddress] = useState('')
  const [messages, setMessages] = useState<DirectMessageRecord[]>([])
  const [decrypted, setDecrypted] = useState<Record<string, DecryptedMessage>>({})
  const [savedConnection, setSavedConnection] = useState<SharedNodeConnection | null>(() => {
    const raw = localStorage.getItem('idena.sharedNode.connection')
    return raw ? JSON.parse(raw) as SharedNodeConnection : null
  })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const decryptAll = useCallback(async (nextMessages: DirectMessageRecord[], activeKey: Uint8Array, activeAddress: string) => {
    const nextDecrypted: Record<string, DecryptedMessage> = {}

    for (const message of nextMessages) {
      if (!message.envelope) {
        nextDecrypted[message.txHash] = {error: message.invalidReason || 'Encrypted envelope unavailable'}
        continue
      }

      try {
        const body = await decryptDirectMessage({
          activePrivateKey: activeKey,
          activeAddress,
          envelope: message.envelope,
        })
        nextDecrypted[message.txHash] = {
          body,
          connection: extractSharedNodeConnection(body),
        }
      } catch (nextError) {
        nextDecrypted[message.txHash] = {
          error: nextError instanceof Error ? nextError.message : 'Unable to decrypt message',
        }
      }
    }

    setDecrypted(nextDecrypted)
  }, [])

  async function unlock() {
    setBusy('unlock')
    setError('')
    try {
      const key = await decryptPrivateKeyBackup(encryptedKey.trim(), password)
      const nextAddress = privateKeyToAddress(key)
      setPrivateKey(previous => {
        previous?.fill(0)
        return key
      })
      setAddress(nextAddress)
      setPassword('')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to unlock key')
    } finally {
      setBusy('')
    }
  }

  async function loadMessages() {
    if (!address || !privateKey) return
    setBusy('messages')
    setError('')
    try {
      const body = await apiJson<{messages: DirectMessageRecord[]}>(
        `/api/inbox/messages?address=${encodeURIComponent(address)}&limit=200`,
      )
      setMessages(body.messages)
      await decryptAll(body.messages, privateKey, address)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load inbox')
    } finally {
      setBusy('')
    }
  }

  function lock() {
    privateKey?.fill(0)
    setPrivateKey(null)
    setAddress('')
    setMessages([])
    setDecrypted({})
  }

  function saveConnection(connection: SharedNodeConnection) {
    const value = {...connection, savedAt: new Date().toISOString()}
    localStorage.setItem('idena.sharedNode.connection', JSON.stringify(value))
    setSavedConnection(connection)
  }

  return (
    <div className="stack">
      <section className="toolbar">
        <div className="status-row">
          <span className={`pill ${privateKey ? 'good' : 'muted'}`}>
            {privateKey ? <ShieldCheck size={16} /> : <Lock size={16} />}
            {privateKey ? shortAddress(address) : 'Locked'}
          </span>
          {savedConnection && <span className="pill"><Database size={16} />{savedConnection.url}</span>}
        </div>
        <div className="actions">
          <button type="button" onClick={loadMessages} disabled={!privateKey || busy === 'messages'}>
            <RefreshCw size={16} />
            Refresh
          </button>
          {privateKey && (
            <button type="button" onClick={lock}>
              <Lock size={16} />
              Lock
            </button>
          )}
        </div>
      </section>

      {error && <p className="alert"><CircleAlert size={16} />{error}</p>}

      {!privateKey && (
        <section className="surface">
          <div className="section-title">
            <KeyRound size={18} />
            <h2>Local Key Unlock</h2>
          </div>
          <div className="grid-form">
            <TextAreaField
              label="Encrypted idena-web key"
              rows={6}
              value={encryptedKey}
              onChange={value => {
                setEncryptedKey(value)
                setError('')
              }}
              placeholder="encrypted private key"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={value => {
                setPassword(value)
                setError('')
              }}
            />
          </div>
          <button type="button" className="primary" onClick={unlock} disabled={!encryptedKey.trim() || !password || busy === 'unlock'}>
            <MailOpen size={16} />
            Unlock
          </button>
        </section>
      )}

      {privateKey && (
        <section className="surface">
          <div className="section-title">
            <Inbox size={18} />
            <h2>Messages</h2>
          </div>
          <div className="message-list">
            {messages.map(message => {
              const result = decrypted[message.txHash]
              return (
                <article className="message-row" key={message.txHash}>
                  <div className="message-head">
                    <span title={message.sender}>{shortAddress(message.sender)}</span>
                    <time>{formatTime(message.timestamp)}</time>
                  </div>
                  {result?.body && <pre>{result.body}</pre>}
                  {result?.error && <p className="row-error">{result.error}</p>}
                  {result?.connection && (
                    <div className="connection-row">
                      <span>{result.connection.url}</span>
                      <button type="button" onClick={() => saveConnection(result.connection!)}>
                        <Save size={16} />
                        Save
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
            {!messages.length && <p className="empty padded">No direct messages loaded</p>}
          </div>
        </section>
      )}
    </div>
  )
}

export function App() {
  const [tab, setTab] = useState<'provider' | 'inbox'>('provider')
  const [state, setState] = useState<PublicState>()
  const [config, setConfig] = useState<ConfigForm>(defaultConfig)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const next = await apiJson<PublicState>('/api/state')
    setState(next)
    setConfig(previous => ({
      ...defaultConfig,
      ...next.config,
      rpcKey: previous.rpcKey,
      nodePassword: previous.nodePassword,
      readRpcKey: previous.readRpcKey,
    }))
  }, [])

  useEffect(() => {
    reload().catch(nextError => {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load app state')
    })
  }, [reload])

  return (
    <main>
      <header className="app-header">
        <div>
          <h1>Shared-Node Fulfillment</h1>
          <p>Local provider watcher and candidate inbox</p>
        </div>
        <nav className="tabs" aria-label="Views">
          <button type="button" className={tab === 'provider' ? 'active' : ''} onClick={() => setTab('provider')}>
            <Settings2 size={16} />
            Provider
          </button>
          <button type="button" className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
            <Inbox size={16} />
            Inbox
          </button>
        </nav>
      </header>

      {error && <p className="alert"><CircleAlert size={16} />{error}</p>}
      {tab === 'provider'
        ? <ProviderPanel state={state} config={config} setConfig={setConfig} reload={reload} />
        : <CandidateInbox />}
    </main>
  )
}
