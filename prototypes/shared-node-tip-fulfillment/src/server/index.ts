import express from 'express'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  createKeyEntry,
  encryptLocalSecret,
  loadState,
  publicState,
  saveState,
  type ProviderConfig,
} from './store'
import {retryPayment, scanAndFulfill} from './provider'
import {scanInboxMessages} from './inbox'

const app = express()
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env[isProduction ? 'PORT' : 'API_PORT'] || (isProduction ? 3060 : 3061))

app.use(express.json({limit: '1mb'}))

function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

function pickConfigPatch(body: Partial<ProviderConfig>) {
  const keys = [
    'enabled',
    'indexerUrl',
    'socialContract',
    'rentalPostId',
    'minTipDna',
    'providerAddress',
    'sharedNodeUrl',
    'rpcUrl',
    'readRpcUrl',
    'messageTemplate',
    'maxFeeDna',
    'scanIntervalSeconds',
  ] as const

  return Object.fromEntries(
    keys
      .filter(key => body[key] !== undefined)
      .map(key => [key, body[key]]),
  ) as Partial<ProviderConfig>
}

app.get('/api/state', asyncRoute(async (_request, response) => {
  response.json(await publicState())
}))

app.post('/api/config', asyncRoute(async (request, response) => {
  const state = await loadState()
  const body = request.body as Partial<ProviderConfig> & {
    rpcKey?: string
    nodePassword?: string
    readRpcKey?: string
    clearRpcKey?: boolean
    clearNodePassword?: boolean
    clearReadRpcKey?: boolean
  }

  state.config = {
    ...state.config,
    ...pickConfigPatch(body),
    scanIntervalSeconds: Math.max(10, Number(body.scanIntervalSeconds || state.config.scanIntervalSeconds || 30)),
  }

  if (body.rpcKey?.trim()) state.config.rpcKeyEncrypted = await encryptLocalSecret(body.rpcKey.trim())
  if (body.nodePassword) state.config.nodePasswordEncrypted = await encryptLocalSecret(body.nodePassword)
  if (body.readRpcKey?.trim()) state.config.readRpcKeyEncrypted = await encryptLocalSecret(body.readRpcKey.trim())
  if (body.clearRpcKey) state.config.rpcKeyEncrypted = undefined
  if (body.clearNodePassword) state.config.nodePasswordEncrypted = undefined
  if (body.clearReadRpcKey) state.config.readRpcKeyEncrypted = undefined

  await saveState(state)
  response.json(await publicState())
}))

app.post('/api/keys/import', asyncRoute(async (request, response) => {
  const state = await loadState()
  const keys = String(request.body?.keys || '')
    .split(/\r?\n|,/g)
    .map(value => value.trim())
    .filter(Boolean)

  const created = []
  for (const [index, key] of keys.entries()) {
    const entry = createKeyEntry(`shared-key-${state.keys.length + index + 1}`, await encryptLocalSecret(key))
    state.keys.push(entry)
    created.push(entry.id)
  }

  await saveState(state)
  response.json({created, state: await publicState()})
}))

app.post('/api/scan', asyncRoute(async (_request, response) => {
  const result = await scanAndFulfill()
  response.json({result, state: await publicState()})
}))

app.post('/api/payments/:txHash/retry', asyncRoute(async (request, response) => {
  await retryPayment(String(request.params.txHash))
  response.json(await publicState())
}))

app.get('/api/inbox/messages', asyncRoute(async (request, response) => {
  const address = String(request.query.address || '')
  const limit = Number(request.query.limit || 150)
  response.json({messages: await scanInboxMessages(address, limit)})
}))

let scanRunning = false
let lastAutoScanAt = 0

setInterval(async () => {
  if (scanRunning) return
  const state = await loadState()
  if (!state.config.enabled) return

  const intervalMs = Math.max(10, state.config.scanIntervalSeconds || 30) * 1000
  if (Date.now() - lastAutoScanAt < intervalMs) return

  scanRunning = true
  lastAutoScanAt = Date.now()
  try {
    await scanAndFulfill()
  } catch (error) {
    console.error('Background scan failed:', error)
  } finally {
    scanRunning = false
  }
}, 5000)

if (isProduction) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const clientDir = path.resolve(__dirname, '../../dist/client')
  app.use(express.static(clientDir))
  app.use((_request, response) => {
    response.sendFile(path.join(clientDir, 'index.html'))
  })
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error'
  response.status(500).json({error: message})
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Shared-node app listening on http://127.0.0.1:${port}`)
})
