import { Contract, utils, providers } from 'ethers'
import { ADDR, ABI, SLOTS, HL_INFO_API, ELYSIUM, HYPEREVM } from '../config'
import { rpc } from './chain'

export type Level = 'ok' | 'warn' | 'fail' | 'info'
export type Check = { level: Level; title: string; detail?: string }
export type Meta = { name: string; symbol: string; decimals: number }

export type ChainReport = {
  chainId: number
  meta?: Meta
  role: string
  checks: Check[]
  links: { label: string; chainId: number; address: string }[]
}

export type TokenReport = { address: string; reports: ChainReport[] }

const ZERO = '0x0000000000000000000000000000000000000000'

// Selector fingerprints. A match only means the bytecode *contains* the
// function, so these surface as warnings, never hard failures.
const FINGERPRINTS: Record<string, string[]> = {
  rebasing: [
    'rebase()',
    'rebase(uint256,int256)',
    'sharesOf(address)',
    'getSharesByPooledEth(uint256)',
    'scaledBalanceOf(address)',
    'gonsPerFragment()',
    'balanceOfUnderlying(address)',
  ],
  feeOnTransfer: [
    'setFee(uint256)',
    'setFees(uint256,uint256)',
    'setTaxFee(uint256)',
    'taxFee()',
    'buyFee()',
    'sellFee()',
    'setBuyTax(uint256)',
    'setSellTax(uint256)',
    'excludeFromFee(address)',
    'isExcludedFromFee(address)',
    'reflectionFromToken(uint256,bool)',
    'tokenFromReflection(uint256)',
  ],
  mutableMetadata: ['setName(string)', 'setSymbol(string)', 'updateName(string)', 'updateSymbol(string)', 'setMetadata(string,string)'],
  pausable: ['pause()', 'blacklist(address)', 'addToBlacklist(address)', 'freeze(address)'],
}
const sel = (sig: string) => utils.id(sig).slice(2, 10)

/** All PUSH4 operands in the bytecode (skipping PUSH data correctly). */
function push4Selectors(code: string): Set<string> {
  const bytes = utils.arrayify(code)
  const out = new Set<string>()
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i]
    if (op === 0x63 && i + 4 < bytes.length) out.add(utils.hexlify(bytes.slice(i + 1, i + 5)).slice(2))
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f
  }
  return out
}

export async function readMeta(p: providers.Provider, address: string): Promise<Meta | undefined> {
  const t = new Contract(address, ABI.erc20, p)
  try {
    const decimals = await t.decimals()
    let name: string, symbol: string
    try {
      ;[name, symbol] = await Promise.all([t.name(), t.symbol()])
    } catch {
      const b = new Contract(address, ABI.erc20Bytes32, p)
      ;[name, symbol] = (await Promise.all([b.name(), b.symbol()])).map((x: string) => utils.parseBytes32String(x))
    }
    return { name, symbol, decimals: Number(decimals) }
  } catch {
    return undefined
  }
}

/** Implementation code for proxies, so fingerprints look at the real logic. */
async function resolveCode(p: providers.Provider, address: string) {
  const code = await p.getCode(address)
  const minimal = code.match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af4/i)
  if (minimal) return { code: await p.getCode('0x' + minimal[1]), proxy: 'EIP-1167 clone' }
  const impl = await p.getStorageAt(address, SLOTS.implementation)
  if (impl && BigInt(impl) !== 0n) return { code: await p.getCode(utils.hexDataSlice(impl, 12)), proxy: 'EIP-1967 upgradeable proxy' }
  const beacon = await p.getStorageAt(address, SLOTS.beacon)
  if (beacon && BigInt(beacon) !== 0n) {
    const b = new Contract(utils.hexDataSlice(beacon, 12), ['function implementation() view returns (address)'], p)
    try {
      return { code: await p.getCode(await b.implementation()), proxy: 'Beacon proxy (upgradeable)' }
    } catch {
      return { code, proxy: 'Beacon proxy (upgradeable)' }
    }
  }
  return { code, proxy: undefined }
}

function fingerprintChecks(code: string, proxy: string | undefined, forMirror: boolean): Check[] {
  const sels = push4Selectors(code)
  const hits = (k: string) => FINGERPRINTS[k].filter((s) => sels.has(sel(s)))
  const checks: Check[] = []
  const reb = hits('rebasing')
  checks.push(
    reb.length
      ? { level: 'warn', title: 'Looks rebasing', detail: `Found ${reb.join(', ')}. Rebasing tokens are not supported by the bridge.` }
      : { level: 'ok', title: 'No rebasing functions found' },
  )
  const fee = hits('feeOnTransfer')
  checks.push(
    fee.length
      ? { level: 'warn', title: 'Looks fee-on-transfer', detail: `Found ${fee.join(', ')}. The bridge mints the requested amount, so taxed transfers will break 1:1 backing.` }
      : { level: 'ok', title: 'No transfer-tax functions found' },
  )
  const mm = hits('mutableMetadata')
  if (mm.length || proxy)
    checks.push({
      level: forMirror ? 'warn' : 'info',
      title: mm.length ? 'Metadata can change' : 'Token is upgradeable',
      detail:
        (mm.length ? `Found ${mm.join(', ')}. ` : `${proxy}. `) +
        (forMirror ? 'A name/symbol change creates a new mirror pair; only the pair matching live metadata stays canonical.' : 'Admin can change token behaviour later.'),
    })
  else checks.push({ level: 'ok', title: 'Metadata looks immutable' })
  const pz = hits('pausable')
  if (pz.length) checks.push({ level: 'info', title: 'Admin controls present', detail: `Found ${pz.join(', ')} — transfers into the bridge can be blocked.` })
  return checks
}

function metaChecks(meta: Meta | undefined): Check[] {
  if (!meta) return [{ level: 'fail', title: 'Not a readable ERC-20', detail: 'name/symbol/decimals calls failed. Mirrors require IERC20Metadata.' }]
  const out: Check[] = [{ level: 'ok', title: 'ERC-20 metadata readable', detail: `${meta.name} (${meta.symbol}), ${meta.decimals} decimals` }]
  if (!meta.name || !meta.symbol) out.push({ level: 'warn', title: 'Empty name or symbol' })
  return out
}

async function elysiumReport(address: string): Promise<ChainReport> {
  const { elysium: E, hyperevm: H } = rpc()
  const meta = await readMeta(E, address)
  const { code, proxy } = await resolveCode(E, address)
  const checks = metaChecks(meta)
  const links: ChainReport['links'] = []

  // a canonical representation of a HyperEVM token?
  let parent: string | undefined
  try {
    parent = await new Contract(address, ABI.arbToken, E).l1Address()
  } catch {
    /* native token */
  }
  if (parent) {
    links.push({ label: 'Original on HyperEVM', chainId: HYPEREVM.chainId, address: parent })
    checks.push({ level: 'info', title: 'Bridged from HyperEVM', detail: 'This is a canonical-bridge representation. Withdraw through the Elysium gateway router; the mirror bridge does not apply.' })
    return { chainId: ELYSIUM.chainId, meta, role: 'Canonical representation', checks, links }
  }

  checks.push(...fingerprintChecks(code, proxy, true))
  const bf = new Contract(ADDR.elysium.bridgeFactory, ABI.bridgeFactory, E)
  const mf = new Contract(ADDR.hyperevm.mirrorFactory, ABI.mirrorFactory, H)
  try {
    const [wallet, predicted, mirror] = await Promise.all([bf.l2WalletFor(address), bf.predictL2Wallet(address), bf.expectedL1Mirror(address)])
    const walletLive = wallet !== ZERO
    checks.push(
      walletLive
        ? { level: 'ok', title: 'Step 1 done: escrow wallet on Elysium', detail: wallet }
        : { level: 'info', title: 'Step 1 pending: create escrow wallet', detail: `ElysiumBridgeFactory.createL2Wallet(token) → ${predicted}` },
    )
    links.push({ label: walletLive ? 'Escrow wallet' : 'Escrow wallet (predicted)', chainId: ELYSIUM.chainId, address: walletLive ? wallet : predicted })

    const [mirrorCode, registeredTo] = await Promise.all([H.getCode(mirror), mf.elysiumTokenOf(mirror).catch(() => ZERO)])
    const registered = registeredTo.toLowerCase() === address.toLowerCase()
    checks.push(
      registered
        ? { level: 'ok', title: 'Step 2 done: mirror registered on HyperEVM', detail: mirror }
        : mirrorCode !== '0x'
          ? { level: 'warn', title: 'Mirror deployed but not registered', detail: `Call ElysiumMirrorFactory.registerL1Mirror for ${mirror}.` }
          : { level: 'info', title: 'Step 2 pending: create + register mirror', detail: `ElysiumMirrorFactory.createAndRegisterL1Mirror on HyperEVM → ${mirror}` },
    )
    links.push({ label: registered ? 'Mirror on HyperEVM' : 'Mirror (expected)', chainId: HYPEREVM.chainId, address: mirror })
    if (registered) {
      const routed = (await new Contract(ADDR.elysium.gatewayRouter, ABI.gatewayRouter, E).getGateway(mirror)).toLowerCase() === ADDR.elysium.bridgeWalletGateway.toLowerCase()
      checks.push(
        !routed
          ? { level: 'fail', title: 'Registration stuck on Elysium', detail: 'Registered on HyperEVM, but the Elysium router never received the route. Use the mirror wizard to re-send it.' }
          : walletLive
            ? { level: 'ok', title: 'Mirror route is live', detail: 'Lock on Elysium → mint on HyperEVM after the challenge period.' }
            : { level: 'info', title: 'Route registered, escrow wallet still missing' },
      )
    }
  } catch (e: any) {
    checks.push({ level: 'warn', title: 'Mirror factories reject this token', detail: 'The factories derive the mirror from live metadata; this usually means name/symbol/decimals are unreadable. ' + (e?.reason || '') })
  }
  return { chainId: ELYSIUM.chainId, meta, role: 'Elysium-native token', checks, links }
}

async function hyperevmReport(address: string): Promise<ChainReport> {
  const { elysium: E, hyperevm: H } = rpc()
  const meta = await readMeta(H, address)
  const { code, proxy } = await resolveCode(H, address)
  const checks = metaChecks(meta)
  const links: ChainReport['links'] = []
  let role = 'HyperEVM token'

  const mf = new Contract(ADDR.hyperevm.mirrorFactory, ABI.mirrorFactory, H)
  const native = await mf.elysiumTokenOf(address).catch(() => ZERO)
  if (native !== ZERO) {
    role = 'Mirror of an Elysium token'
    links.push({ label: 'Native token on Elysium', chainId: ELYSIUM.chainId, address: native })
    checks.push({ level: 'info', title: 'Mirror of an Elysium-native token', detail: 'Burn here to release the original on Elysium (≈1 minute).' })
  } else {
    checks.push(...fingerprintChecks(code, proxy, false))
    const router = new Contract(ADDR.hyperevm.gatewayRouter, ABI.gatewayRouter, H)
    try {
      const [gateway, child] = await Promise.all([router.getGateway(address), router.calculateL2TokenAddress(address)])
      const childCode = await E.getCode(child)
      const std = gateway.toLowerCase() === ADDR.hyperevm.erc20Gateway.toLowerCase()
      checks.push({ level: std ? 'ok' : 'info', title: std ? 'Routes through the standard gateway' : 'Custom gateway', detail: gateway })
      checks.push(
        childCode !== '0x'
          ? { level: 'ok', title: 'Already live on Elysium', detail: child }
          : { level: 'info', title: 'Not on Elysium yet', detail: `The first deposit auto-deploys it at ${child}.` },
      )
      links.push({ label: childCode !== '0x' ? 'Representation on Elysium' : 'Elysium address (predicted)', chainId: ELYSIUM.chainId, address: child })
    } catch (e: any) {
      checks.push({ level: 'warn', title: 'Could not read gateway router', detail: e?.reason || e?.message })
    }
  }

  const core = await hyperCoreLink(address)
  if (core) {
    checks.push({
      level: 'ok',
      title: `Linked to HyperCore spot: ${core.name}`,
      detail: `Token index ${core.index}, weiDecimals ${core.weiDecimals}, evmExtraWeiDecimals ${core.extra}. Deposits must be multiples of 10^${Math.max(0, core.extra)} base units.`,
    })
  } else checks.push({ level: 'info', title: 'Not linked to HyperCore spot (testnet)' })
  return { chainId: HYPEREVM.chainId, meta, role, checks, links }
}

export type CoreToken = { name: string; index: number; weiDecimals: number; szDecimals: number; extra: number }

let spotMetaCache: Promise<any> | null = null
export async function hyperCoreLink(evmAddress: string): Promise<CoreToken | null> {
  spotMetaCache ??= fetch(HL_INFO_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'spotMeta' }) }).then((r) => r.json())
  try {
    const meta = await spotMetaCache
    const t = meta.tokens.find((x: any) => x.evmContract?.address?.toLowerCase() === evmAddress.toLowerCase())
    if (!t) return null
    return { name: t.name, index: t.index, weiDecimals: t.weiDecimals, szDecimals: t.szDecimals, extra: t.evmContract.evm_extra_wei_decimals }
  } catch {
    spotMetaCache = null
    return null
  }
}

export async function checkToken(address: string): Promise<TokenReport> {
  const { elysium: E, hyperevm: H } = rpc()
  const [eCode, hCode] = await Promise.all([E.getCode(address), H.getCode(address)])
  const jobs: Promise<ChainReport>[] = []
  if (eCode !== '0x') jobs.push(elysiumReport(address))
  if (hCode !== '0x') jobs.push(hyperevmReport(address))
  return { address: utils.getAddress(address), reports: await Promise.all(jobs) }
}

/** Is this address a contract on either chain? Used to route the search box. */
export async function isContract(address: string) {
  const { elysium: E, hyperevm: H } = rpc()
  const [a, b] = await Promise.all([E.getCode(address), H.getCode(address).catch(() => '0x')])
  return a !== '0x' || b !== '0x'
}
