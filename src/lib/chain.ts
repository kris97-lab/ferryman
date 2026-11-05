import { providers, Contract } from 'ethers'
import { registerCustomArbitrumNetwork } from '@arbitrum/sdk'
import { ELYSIUM, HYPEREVM, ADDR, ABI } from '../config'

const RPC_KEY = 'ferryman:rpc'

export type RpcOverrides = { elysium?: string; hyperevm?: string }

export function loadRpcOverrides(): RpcOverrides {
  try {
    return JSON.parse(localStorage.getItem(RPC_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveRpcOverrides(o: RpcOverrides) {
  try {
    localStorage.setItem(RPC_KEY, JSON.stringify(o))
  } catch {
    /* storage unavailable: overrides last for this page only */
  }
  current = makeProviders(o)
}

function makeProviders(o: RpcOverrides) {
  return {
    elysium: new providers.StaticJsonRpcProvider(o.elysium || ELYSIUM.rpc, ELYSIUM.chainId),
    hyperevm: new providers.StaticJsonRpcProvider(o.hyperevm || HYPEREVM.rpc, HYPEREVM.chainId),
  }
}

let current = makeProviders(loadRpcOverrides())
export const rpc = () => current

const ZERO = '0x0000000000000000000000000000000000000000'

// Elysium is an Orbit chain with native HYPE gas on a HyperEVM parent, so the
// stock Arbitrum SDK works once the network is registered. The rollup is BoLD.
registerCustomArbitrumNetwork({
  name: ELYSIUM.name,
  chainId: ELYSIUM.chainId,
  parentChainId: HYPEREVM.chainId,
  confirmPeriodBlocks: 10,
  isCustom: true,
  isTestnet: true,
  isBold: true,
  ethBridge: {
    bridge: ADDR.hyperevm.bridge,
    inbox: ADDR.hyperevm.inbox,
    sequencerInbox: ADDR.hyperevm.sequencerInbox,
    outbox: ADDR.hyperevm.outbox,
    rollup: ADDR.hyperevm.rollup,
  },
  tokenBridge: {
    parentGatewayRouter: ADDR.hyperevm.gatewayRouter,
    childGatewayRouter: ADDR.elysium.gatewayRouter,
    parentErc20Gateway: ADDR.hyperevm.erc20Gateway,
    childErc20Gateway: ADDR.elysium.erc20Gateway,
    parentCustomGateway: ZERO,
    childCustomGateway: ZERO,
    parentWethGateway: ZERO,
    childWethGateway: ZERO,
    parentWeth: ZERO,
    childWeth: ZERO,
    parentMultiCall: ZERO,
    childMultiCall: ADDR.elysium.multicall3,
  },
})

/** Multicall3.aggregate3 on Elysium; returns null for failed calls. */
export async function multicall(calls: { target: string; data: string }[]): Promise<(string | null)[]> {
  const mc = new Contract(ADDR.elysium.multicall3, ABI.multicall3, rpc().elysium)
  const out: (string | null)[] = []
  for (let i = 0; i < calls.length; i += 600) {
    const chunk = calls.slice(i, i + 600)
    const res = await mc.callStatic.aggregate3(chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.data })))
    for (const r of res) out.push(r.success ? r.returnData : null)
  }
  return out
}

/**
 * eth_getLogs over a wide range. Elysium's RPC caps a response at 10k logs and
 * HyperEVM's caps the range at 1000 blocks, so the window shrinks on error.
 */
export async function getLogsChunked(
  provider: providers.JsonRpcProvider,
  filter: { address: string | string[]; topics: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
  opts: { initialSpan?: number; maxSpan?: number; onProgress?: (done: number) => void } = {},
) {
  const logs: providers.Log[] = []
  let span = opts.initialSpan ?? 200_000
  let start = fromBlock
  while (start <= toBlock) {
    const end = Math.min(start + span - 1, toBlock)
    try {
      const chunk: providers.Log[] = await provider.send('eth_getLogs', [
        { ...filter, fromBlock: '0x' + start.toString(16), toBlock: '0x' + end.toString(16) },
      ])
      logs.push(...chunk)
      start = end + 1
      opts.onProgress?.((start - fromBlock) / (toBlock - fromBlock + 1))
      if (chunk.length < 3000 && (!opts.maxSpan || span * 2 <= opts.maxSpan)) span *= 2
    } catch (e) {
      if (span <= 100) throw e
      span = Math.floor(span / 4)
    }
  }
  return logs
}

// ---- wallet ----

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<any>; on?: (e: string, f: (...a: any[]) => void) => void }
export const injected = (): Eip1193 | undefined => (window as any).ethereum

export async function connectWallet(): Promise<string> {
  const eth = injected()
  if (!eth) throw new Error('No browser wallet found. Install MetaMask, Rabby or similar.')
  const [account] = await eth.request({ method: 'eth_requestAccounts' })
  return account
}

const CHAIN_PARAMS = {
  [ELYSIUM.chainId]: { chainName: ELYSIUM.name, rpcUrls: [ELYSIUM.rpc], blockExplorerUrls: [ELYSIUM.explorer] },
  [HYPEREVM.chainId]: { chainName: HYPEREVM.name, rpcUrls: [HYPEREVM.rpc], blockExplorerUrls: [HYPEREVM.explorer] },
}

/** Returns an ethers signer on the requested chain, switching the wallet if needed. */
export async function signerOn(chainId: number) {
  const eth = injected()
  if (!eth) throw new Error('No browser wallet found.')
  await eth.request({ method: 'eth_requestAccounts' })
  const hex = '0x' + chainId.toString(16)
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
  } catch (e: any) {
    if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hex, nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, ...CHAIN_PARAMS[chainId] }],
    })
  }
  return new providers.Web3Provider(eth as any, 'any').getSigner()
}

export const explorerTx = (chainId: number, hash: string) =>
  `${chainId === ELYSIUM.chainId ? ELYSIUM.explorer : HYPEREVM.explorer}/tx/${hash}`
export const explorerAddr = (chainId: number, a: string) =>
  `${chainId === ELYSIUM.chainId ? ELYSIUM.explorer : HYPEREVM.explorer}/address/${a}`
