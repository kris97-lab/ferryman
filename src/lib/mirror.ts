import { BigNumber, Contract, utils } from 'ethers'
import { ADDR, ABI, ELYSIUM, HYPEREVM } from '../config'
import { rpc, signerOn } from './chain'
import { readMeta, type Meta } from './token'

// Mirror bridge setup for an Elysium-native token (docs: "Bridging Elysium
// tokens to HyperEVM"). Three things must be true for the route to work:
//   1. escrow wallet exists on Elysium      (ElysiumBridgeFactory.createL2Wallet)
//   2. mirror registered on HyperEVM        (ElysiumMirrorFactory.createAndRegisterL1Mirror)
//   3. step 2's two retryables executed on Elysium (router + wallet gateway point at the mirror)
// Step 3 is where most testnet setups stall: the docs' sample gasPriceBid of
// 0.1 gwei sits just under Elysium's base fee, so auto-execution is skipped.

const ZERO = '0x0000000000000000000000000000000000000000'

const REGISTRATION_ABI = [
  'function createAndRegisterL1Mirror(address elysiumToken, string name, string symbol, uint8 decimals, (uint256 maxSubmissionCostForGateway, uint256 maxSubmissionCostForRouter, uint256 maxGasForGateway, uint256 maxGasForRouter, uint256 gasPriceBid, uint256 valueForGateway, uint256 valueForRouter, address creditBackAddress) params) payable returns (address)',
  'function registerL1Mirror(address mirror, (uint256 maxSubmissionCostForGateway, uint256 maxSubmissionCostForRouter, uint256 maxGasForGateway, uint256 maxGasForRouter, uint256 gasPriceBid, uint256 valueForGateway, uint256 valueForRouter, address creditBackAddress) params) payable',
]
const WALLET_GATEWAY_ABI = ['function l1ToL2Token(address l1Token) view returns (address)']

export type MirrorState = {
  token: string
  meta: Meta
  canonical?: string // set when the token is itself a canonical-bridge representation
  wallet: { address: string; predicted: string; live: boolean }
  mirror: { address: string; deployed: boolean; registered: boolean; predictedFromMeta: string }
  elysiumRoute: { router: boolean; gateway: boolean }
  step: 1 | 2 | 3 | 'done'
  routeStuck: boolean // registered on HyperEVM but Elysium side never landed
}

export async function mirrorState(token: string): Promise<MirrorState> {
  const { elysium: E, hyperevm: H } = rpc()
  token = utils.getAddress(token)
  const meta = await readMeta(E, token)
  if (!meta) throw new Error('This address has no readable name/symbol/decimals on Elysium. Mirrors need IERC20Metadata.')

  let canonical: string | undefined
  try {
    canonical = await new Contract(token, ABI.arbToken, E).l1Address()
  } catch {
    /* native token */
  }

  const bf = new Contract(ADDR.elysium.bridgeFactory, ABI.bridgeFactory, E)
  const mf = new Contract(ADDR.hyperevm.mirrorFactory, ABI.mirrorFactory, H)
  const [walletAddr, predicted, mirror] = await Promise.all([bf.l2WalletFor(token), bf.predictL2Wallet(token), bf.expectedL1Mirror(token)])
  const [mirrorCode, owner, predictedFromMeta, routerGw, gwToken] = await Promise.all([
    H.getCode(mirror),
    mf.elysiumTokenOf(mirror).catch(() => ZERO),
    mf.predictL1Mirror(token, meta.name, meta.symbol, meta.decimals),
    new Contract(ADDR.elysium.gatewayRouter, ABI.gatewayRouter, E).getGateway(mirror),
    new Contract(ADDR.elysium.bridgeWalletGateway, WALLET_GATEWAY_ABI, E).l1ToL2Token(mirror).catch(() => ZERO),
  ])

  const walletLive = walletAddr !== ZERO
  const registered = owner.toLowerCase() === token.toLowerCase()
  const router = routerGw.toLowerCase() === ADDR.elysium.bridgeWalletGateway.toLowerCase()
  const gateway = gwToken !== ZERO
  const step = !walletLive ? 1 : !registered ? 2 : !(router && gateway) ? 3 : 'done'

  return {
    token,
    meta,
    canonical,
    wallet: { address: walletLive ? walletAddr : predicted, predicted, live: walletLive },
    mirror: { address: mirror, deployed: mirrorCode !== '0x', registered, predictedFromMeta },
    elysiumRoute: { router, gateway },
    step,
    routeStuck: registered && !(router && gateway),
  }
}

export type RegistrationParams = {
  maxSubmissionCostForGateway: BigNumber
  maxSubmissionCostForRouter: BigNumber
  maxGasForGateway: BigNumber
  maxGasForRouter: BigNumber
  gasPriceBid: BigNumber
  valueForGateway: BigNumber
  valueForRouter: BigNumber
  creditBackAddress: string
}

/**
 * Fees for the two registration retryables. Measured execution is ~57k gas;
 * we keep the docs' 300k limit and bid 3× Elysium's live base fee so
 * auto-execution actually happens. Every unused wei refunds to
 * creditBackAddress on Elysium.
 */
export async function estimateRegistration(creditBack: string): Promise<{ params: RegistrationParams; total: BigNumber; elysiumBaseFee: BigNumber; docsBid: BigNumber }> {
  const { elysium: E, hyperevm: H } = rpc()
  const [eBlock, hBlock] = await Promise.all([E.getBlock('latest'), H.getBlock('latest')])
  const eBase = eBlock.baseFeePerGas ?? (await E.getGasPrice())
  const hBase = hBlock.baseFeePerGas ?? (await H.getGasPrice())
  const inbox = new Contract(ADDR.hyperevm.inbox, ['function calculateRetryableSubmissionFee(uint256 dataLength, uint256 baseFee) view returns (uint256)'], H)
  // registration calldata is ~200 bytes; size for 1 KB and triple it
  const sub = (await inbox.calculateRetryableSubmissionFee(1024, hBase)).mul(3)
  const gas = BigNumber.from(300_000)
  const floor = utils.parseUnits('0.2', 'gwei')
  const bid = eBase.mul(3).gt(floor) ? eBase.mul(3) : floor
  const value = sub.add(gas.mul(bid))
  const params: RegistrationParams = {
    maxSubmissionCostForGateway: sub,
    maxSubmissionCostForRouter: sub,
    maxGasForGateway: gas,
    maxGasForRouter: gas,
    gasPriceBid: bid,
    valueForGateway: value,
    valueForRouter: value,
    creditBackAddress: creditBack,
  }
  return { params, total: value.mul(2), elysiumBaseFee: eBase, docsBid: utils.parseUnits('0.1', 'gwei') }
}

export async function createWallet(token: string) {
  const signer = await signerOn(ELYSIUM.chainId)
  const bf = new Contract(ADDR.elysium.bridgeFactory, ABI.bridgeFactory, signer)
  const tx = await bf.createL2Wallet(token)
  return tx.wait()
}

/** Step 2: deploys + registers, or registers an already-deployed mirror. */
export async function registerMirror(s: MirrorState) {
  const signer = await signerOn(HYPEREVM.chainId)
  const { params, total } = await estimateRegistration(await signer.getAddress())
  const mf = new Contract(ADDR.hyperevm.mirrorFactory, REGISTRATION_ABI, signer)
  const tx = s.mirror.deployed
    ? await mf.registerL1Mirror(s.mirror.address, params, { value: total })
    : await mf.createAndRegisterL1Mirror(s.token, s.meta.name, s.meta.symbol, s.meta.decimals, params, { value: total })
  return tx.wait()
}

/** Dry-run step 2 from any address, so the UI can catch reverts before signing. */
export async function simulateRegistration(s: MirrorState, from: string) {
  const { params, total } = await estimateRegistration(from)
  const mf = new Contract(ADDR.hyperevm.mirrorFactory, REGISTRATION_ABI, rpc().hyperevm)
  try {
    if (s.mirror.deployed) await mf.callStatic.registerL1Mirror(s.mirror.address, params, { value: total, from })
    else await mf.callStatic.createAndRegisterL1Mirror(s.token, s.meta.name, s.meta.symbol, s.meta.decimals, params, { value: total, from })
    return { ok: true as const }
  } catch (e: any) {
    return { ok: false as const, reason: e?.errorName || e?.reason || e?.error?.message || 'reverted' }
  }
}
