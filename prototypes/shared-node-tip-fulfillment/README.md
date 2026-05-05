# Shared-Node Tip Fulfillment

Local provider dashboard and local candidate inbox for shared-node API-key delivery through encrypted `idena.social` direct messages.

## Prototype Warning

This is a rough prototype produced from a short Codex session. It is meant to show one possible future direction for distributing shared-node API keys after social tips, not production-ready code.

Do not publish or run this as-is for real users. The candidate inbox intentionally handles an unlocked private key in a web interface, and the provider side exports the node key from a writable node. The whole flow needs a proper security review by someone with deeper Idena and browser-crypto knowledge before anything can be built on top of it.

## Run

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:3060`.

For development, run the API and Vite separately:

```bash
npm run server
npm run dev
```

## Provider Flow

1. Configure the provider address, rental post ID, shared-node URL, writable node RPC URL/key, and node password.
2. Import one shared-node API key per line into the key pool.
3. Enable the watcher or use `Scan`.
4. The watcher scans `idena.social` `sendTip` calls, deduplicates by `txHash`, reserves one key, encrypts it for the payer, stores the envelope in IPFS, and calls `sendMessage`.

Provider DM sending still requires a writable provider node because v1 uses `dna_exportKey`, `dna_storeToIpfs`, and `contract_call`.

## Candidate Flow

1. Open `Inbox`.
2. Paste the encrypted idena-web private key backup and unlock it locally.
3. Refresh messages.
4. The server fetches encrypted envelopes from the indexer/IPFS, while decryption happens in the browser with the unlocked private key.
5. Use `Save` on a decrypted shared-node credential message to store the local node connection in browser local storage.

The private key is not sent to the server.

## Verification

```bash
npm test
npm run build
```
