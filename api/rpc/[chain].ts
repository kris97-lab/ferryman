// JSON-RPC proxy for the browser app. Keeps provider API keys (Alchemy etc.)
// server-side and only forwards read methods the app actually uses — wallet
// writes go straight from the user's wallet, never through here.
//
// Env: ELYSIUM_RPC_URL, HYPEREVM_RPC_URL (fall back to the public endpoints).

export const config = { runtime: 'edge' }

const UPSTREAM: Record<string, { env: string; fallback: string }> = {
  elysium: { env: 'ELYSIUM_RPC_URL', fallback: 'https://testnet-rpc.elysium.kinetiq.xyz' },
  hyperevm: { env: 'HYPEREVM_RPC_URL', fallback: 'https://rpc.hyperliquid-testnet.xyz/evm' },
}

const ALLOWED = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getBalance',
  'eth_getTransactionCount',
])

const MAX_BODY = 512 * 1024 // multicall batches of ~300 calls are ~100 KB
const MAX_BATCH = 20

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const chain = new URL(req.url).pathname.split('/').pop() ?? ''
  const target = UPSTREAM[chain]
  if (!target) return json({ error: `unknown chain "${chain}"` }, 404)

  const raw = await req.text()
  if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413)

  let payload: RpcRequest | RpcRequest[]
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400)
  }

  const calls = Array.isArray(payload) ? payload : [payload]
  if (calls.length === 0 || calls.length > MAX_BATCH) return json({ error: 'bad batch size' }, 400)
  const blocked = calls.find((c) => typeof c.method !== 'string' || !ALLOWED.has(c.method))
  if (blocked) {
    return json({ jsonrpc: '2.0', id: blocked.id ?? null, error: { code: -32601, message: `method not allowed: ${String(blocked.method)}` } }, 403)
  }

  const url = (globalThis as any).process?.env?.[target.env] || target.fallback
  const upstream = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
