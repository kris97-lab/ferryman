import { BigNumber, Contract, utils, providers } from 'ethers'
import { ADDR, ABI, ELYSIUM, HYPEREVM } from '../config'
import { rpc, multicall, getLogsChunked, signerOn } from './chain'
import { loadSdk } from './sdk'

const retryableIface = new utils.Interface(ABI.arbRetryableTx)
const arbSysIface = new utils.Interface([
  'event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)',
])
const gatewayIface = new utils.Interface([
  'event WithdrawalInitiated(address l1Token, address indexed _from, address indexed _to, uint256 indexed _l2ToL1Id, uint256 _exitNum, uint256 _amount)',
  'function finalizeInboundTransfer(address _token, address _from, address _to, uint256 _amount, bytes _data)',
])
const TOPIC = {
  ticketCreated: retryableIface.getEventTopic('TicketCreated'),
  redeemScheduled: retryableIface.getEventTopic('RedeemScheduled'),
  l2ToL1Tx: arbSysIface.getEventTopic('L2ToL1Tx'),
  withdrawalInitiated: gatewayIface.getEventTopic('WithdrawalInitiated'),
}

// L1 contracts calling into L2 appear under an aliased address.
const ALIAS_OFFSET = BigNumber.from('0x1111000000000000000000000000000000001111')
const MOD = BigNumber.from(2).pow(160)

function hexAddr(bn: BigNumber) {
  return utils.getAddress(utils.hexZeroPad(bn.toHexString(), 20))
}
function unaliasAddr(a: string) {
  return hexAddr(BigNumber.from(a).sub(ALIAS_OFFSET).add(MOD).mod(MOD))
}

const DESTINATIONS: Record<string, string> = {
  [ADDR.elysium.erc20Gateway.toLowerCase()]: 'Token deposit (canonical bridge)',
  [ADDR.elysium.gatewayRouter.toLowerCase()]: 'Gateway router registration',
  [ADDR.elysium.bridgeWalletGateway.toLowerCase()]: 'Mirror bridge message',
}
const SENDERS: Record<string, string> = {
  [ADDR.hyperevm.gatewayRouter.toLowerCase()]: 'HyperEVM gateway router',
  [ADDR.hyperevm.erc20Gateway.toLowerCase()]: 'HyperEVM ERC-20 gateway',
  [ADDR.hyperevm.mirrorGateway.toLowerCase()]: 'HyperEVM mirror gateway',
  [ADDR.hyperevm.mirrorFactory.toLowerCase()]: 'HyperEVM mirror factory',
}

export type AutoRedeem = 'succeeded' | 'failed' | 'skipped-low-bid' | 'skipped-underfunded' | 'unknown'
export type TicketState = 'redeemed' | 'stuck' | 'expired' | 'not-created'

export type Ticket = {
  id: string
  block: number
  timestamp: number
  kind: string
  l1Sender: string
  l1SenderLabel?: string
  beneficiary: string
  retryTo: string
  retryValue: BigNumber
  gasLimit: BigNumber
  bid: BigNumber
  baseFeeAtCreation: BigNumber
  autoRedeem: AutoRedeem
  state: TicketState
  timeout?: number
  simulation?: { ok: boolean; reason?: string }
  deposit?: { token: string; from: string; to: string; amount: BigNumber }
  requestId: string
  l1BlockNumber?: number
}

/** Full diagnosis of one retryable ticket on Elysium. */
export async function getTicket(id: string): Promise<Ticket | null> {
  const E = rpc().elysium
  const tx: any = await E.send('eth_getTransactionByHash', [id])
  if (!tx || tx.type !== '0x69') return null
  const [receipt, block] = await Promise.all([
    E.send('eth_getTransactionReceipt', [id]),
    E.send('eth_getBlockByNumber', [tx.blockNumber, false]),
  ])

  const bid = BigNumber.from(tx.maxFeePerGas)
  const gasLimit = BigNumber.from(tx.gas)
  const baseFee = BigNumber.from(block.baseFeePerGas)
  const needed = BigNumber.from(tx.maxSubmissionFee).add(gasLimit.mul(bid)).add(tx.retryValue)

  // auto-redeem outcome
  let autoRedeem: AutoRedeem = 'unknown'
  const scheduled = receipt.logs
    .filter((l: any) => l.topics[0] === TOPIC.redeemScheduled)
    .map((l: any) => retryableIface.parseLog(l).args.retryTxHash as string)
  if (scheduled.length) {
    const r: any = await E.send('eth_getTransactionReceipt', [scheduled[0]])
    autoRedeem = r?.status === '0x1' ? 'succeeded' : 'failed'
  } else if (gasLimit.isZero() || bid.lt(baseFee)) {
    autoRedeem = 'skipped-low-bid'
  } else if (BigNumber.from(tx.depositValue).lt(needed)) {
    autoRedeem = 'skipped-underfunded'
  }

  // still alive?
  const rt = new Contract(ADDR.elysium.arbRetryableTx, ABI.arbRetryableTx, E)
  let timeout: number | undefined
  try {
    timeout = (await rt.getTimeout(id)).toNumber()
  } catch {
    /* NoTicketWithID: redeemed or expired */
  }

  let state: TicketState
  if (timeout) state = 'stuck'
  else if (autoRedeem === 'succeeded') state = 'redeemed'
  else {
    // look for a later manual redeem that succeeded
    const later = await getLogsChunked(
      E,
      { address: ADDR.elysium.arbRetryableTx, topics: [TOPIC.redeemScheduled, id] },
      parseInt(tx.blockNumber, 16),
      await E.getBlockNumber(),
      { initialSpan: 2_000_000 },
    )
    state = 'expired'
    for (const l of later) {
      const h = retryableIface.parseLog(l).args.retryTxHash
      const r: any = await E.send('eth_getTransactionReceipt', [h])
      if (r?.status === '0x1') {
        state = 'redeemed'
        break
      }
    }
  }

  let simulation: Ticket['simulation']
  if (state === 'stuck') simulation = await simulateRetry(tx)

  let deposit: Ticket['deposit']
  try {
    const d = gatewayIface.decodeFunctionData('finalizeInboundTransfer', tx.retryData)
    deposit = { token: d._token, from: d._from, to: d._to, amount: d._amount }
  } catch {
    /* not a token deposit */
  }

  const l1Sender = unaliasAddr(tx.from)
  return {
    id,
    block: parseInt(tx.blockNumber, 16),
    timestamp: parseInt(block.timestamp, 16),
    kind: DESTINATIONS[tx.retryTo.toLowerCase()] ?? (tx.retryData === '0x' ? 'HYPE transfer' : 'Contract call'),
    l1Sender,
    l1SenderLabel: SENDERS[l1Sender.toLowerCase()],
    beneficiary: utils.getAddress(tx.beneficiary),
    retryTo: utils.getAddress(tx.retryTo),
    retryValue: BigNumber.from(tx.retryValue),
    gasLimit,
    bid,
    baseFeeAtCreation: baseFee,
    autoRedeem,
    state,
    timeout,
    simulation,
    deposit,
    requestId: tx.requestId,
    l1BlockNumber: receipt.l1BlockNumber ? parseInt(receipt.l1BlockNumber, 16) : undefined,
  }
}

/** Would the ticket's call succeed if someone redeemed it right now? */
async function simulateRetry(tx: any): Promise<{ ok: boolean; reason?: string }> {
  try {
    await rpc().elysium.call({ from: tx.from, to: tx.retryTo, data: tx.retryData, value: tx.retryValue })
    return { ok: true }
  } catch (e: any) {
    const data = e?.error?.data ?? e?.data
    let reason = e?.error?.message || e?.reason || 'execution reverted'
    if (typeof data === 'string' && data.startsWith('0x08c379a0')) {
      try {
        reason = utils.defaultAbiCoder.decode(['string'], '0x' + data.slice(10))[0]
      } catch {
        /* keep generic reason */
      }
    }
    return { ok: false, reason }
  }
}

export async function redeemTicket(id: string) {
  const signer = await signerOn(ELYSIUM.chainId)
  const rt = new Contract(ADDR.elysium.arbRetryableTx, ABI.arbRetryableTx, signer)
  const tx = await rt.redeem(id, { gasLimit: 2_000_000 })
  return tx.wait()
}

// ---- withdrawals (Elysium -> HyperEVM) ----

export type WithdrawalStatus = 'waiting' | 'claimable' | 'claimed'
export type Withdrawal = {
  txHash: string
  index: number
  block: number
  timestamp: number
  destination: string
  value: BigNumber
  token?: { l1Token: string; to: string; amount: BigNumber }
  status: WithdrawalStatus
  position: string
}

const W_STATUS: Record<number, WithdrawalStatus> = {
  // ChildToParentMessageStatus: UNCONFIRMED, CONFIRMED, EXECUTED
  0: 'waiting',
  1: 'claimable',
  2: 'claimed',
}

async function withdrawalsFromReceipt(receipt: providers.TransactionReceipt): Promise<Withdrawal[]> {
  const parsed = parseWithdrawals(receipt)
  return Promise.all(parsed.map(async (w) => ({ ...w, status: await sdkStatus(receipt, w.index) })))
}

async function sdkStatus(receipt: providers.TransactionReceipt, index: number): Promise<WithdrawalStatus> {
  const { ChildTransactionReceipt } = await loadSdk()
  const msgs = await new ChildTransactionReceipt(receipt).getChildToParentMessages(rpc().hyperevm)
  return W_STATUS[await msgs[index].status(rpc().elysium)] ?? 'waiting'
}

/** Withdrawal events in a receipt; status is filled in by the caller. */
function parseWithdrawals(receipt: providers.TransactionReceipt): Withdrawal[] {
  const sends = receipt.logs.filter((l) => l.topics[0] === TOPIC.l2ToL1Tx && l.address.toLowerCase() === ADDR.elysium.arbSys.toLowerCase())
  const tokenLogs = receipt.logs.filter((l) => l.topics[0] === TOPIC.withdrawalInitiated).map((l) => gatewayIface.parseLog(l).args)
  return sends.map((l, i) => {
    const ev = arbSysIface.parseLog(l).args
    const t = tokenLogs[i]
    return {
      txHash: receipt.transactionHash,
      index: i,
      block: receipt.blockNumber,
      timestamp: ev.timestamp.toNumber(),
      destination: ev.destination,
      value: ev.callvalue,
      token: t ? { l1Token: t.l1Token, to: t._to, amount: t._amount } : undefined,
      status: 'waiting' as WithdrawalStatus,
      position: ev.position.toString(),
    }
  })
}

export async function claimWithdrawal(txHash: string, index: number) {
  const signer = await signerOn(HYPEREVM.chainId)
  const receipt = await rpc().elysium.getTransactionReceipt(txHash)
  const { ChildTransactionReceipt } = await loadSdk()
  const msgs = await new ChildTransactionReceipt(receipt).getChildToParentMessages(signer)
  const tx = await msgs[index].execute(rpc().elysium)
  return tx.wait()
}

// ---- one-hash diagnosis ----

export type EthDeposit = { to: string; value: BigNumber; childTxHash: string; status: 'pending' | 'done' }
export type Diagnosis =
  | { chain: 'none' }
  | {
      chain: 'elysium' | 'hyperevm'
      hash: string
      tickets: Ticket[]
      pendingTickets: number
      withdrawals: Withdrawal[]
      ethDeposits: EthDeposit[]
      claimedWithdrawal?: boolean
      note?: string
    }

export async function diagnose(hash: string): Promise<Diagnosis> {
  const { elysium: E, hyperevm: H } = rpc()
  const [eTx, hRc] = await Promise.all([
    E.send('eth_getTransactionByHash', [hash]).catch(() => null),
    H.getTransactionReceipt(hash).catch(() => null),
  ])

  if (eTx) {
    const base = { chain: 'elysium' as const, hash, tickets: [] as Ticket[], pendingTickets: 0, withdrawals: [] as Withdrawal[], ethDeposits: [] }
    // ticket creation tx, or a redeem attempt that points back at its ticket
    const ticketId = eTx.type === '0x69' ? hash : eTx.type === '0x68' ? eTx.ticketId : null
    if (ticketId) {
      const t = await getTicket(ticketId)
      return { ...base, tickets: t ? [t] : [] }
    }
    if (eTx.type === '0x64') return { ...base, note: 'HYPE deposit from HyperEVM, credited directly — nothing to fix.' }
    const receipt = await E.getTransactionReceipt(hash)
    const withdrawals = receipt ? await withdrawalsFromReceipt(receipt) : []
    return { ...base, withdrawals, note: withdrawals.length ? undefined : 'No bridge activity in this transaction.' }
  }

  if (hRc) {
    const base = { chain: 'hyperevm' as const, hash, tickets: [] as Ticket[], pendingTickets: 0, withdrawals: [], ethDeposits: [] as EthDeposit[] }
    const outboxExec = hRc.logs.some((l) => l.address.toLowerCase() === ADDR.hyperevm.outbox.toLowerCase())
    if (outboxExec) return { ...base, claimedWithdrawal: true, note: 'This transaction claimed a withdrawal from Elysium.' }
    const { ParentTransactionReceipt, ParentToChildMessageStatus, EthDepositMessageStatus } = await loadSdk()
    const prc = new ParentTransactionReceipt(hRc)
    const [msgs, eth] = await Promise.all([prc.getParentToChildMessages(E).catch(() => []), prc.getEthDeposits(E).catch(() => [])])
    const tickets: Ticket[] = []
    let pending = 0
    for (const m of msgs) {
      const s = await m.status()
      if (s === ParentToChildMessageStatus.NOT_YET_CREATED) pending++
      else {
        const t = await getTicket(m.retryableCreationId)
        if (t) tickets.push(t)
      }
    }
    const ethDeposits: EthDeposit[] = await Promise.all(
      eth.map(async (d) => ({
        to: d.to,
        value: d.value,
        childTxHash: d.childTxHash,
        status: (await d.status()) === EthDepositMessageStatus.DEPOSITED ? ('done' as const) : ('pending' as const),
      })),
    )
    const note = !msgs.length && !eth.length ? 'No messages to Elysium in this transaction.' : undefined
    return { ...base, tickets, pendingTickets: pending, ethDeposits, note }
  }

  return { chain: 'none' }
}

// ---- wallet-wide scans ----

/** Average Elysium block time, measured over the last 100k blocks. */
async function blocksPerSecond(): Promise<{ tip: number; bps: number }> {
  const E = rpc().elysium
  const tip = await E.getBlockNumber()
  const [a, b] = await Promise.all([E.getBlock(tip), E.getBlock(Math.max(0, tip - 100_000))])
  return { tip, bps: (a.number - b.number) / Math.max(1, a.timestamp - b.timestamp) }
}

/**
 * Stuck tickets whose beneficiary is `owner`, created in the last `hours`.
 * Tickets aren't indexed by user, so this walks every TicketCreated event and
 * batch-checks liveness + beneficiary through Multicall3.
 */
export async function findStuckTickets(owner: string, hours: number, onProgress: (p: number, msg: string) => void) {
  const E = rpc().elysium
  const { tip, bps } = await blocksPerSecond()
  const from = Math.max(0, tip - Math.round(hours * 3600 * bps))
  onProgress(0, 'Reading ticket events…')
  const logs = await getLogsChunked(E, { address: ADDR.elysium.arbRetryableTx, topics: [TOPIC.ticketCreated] }, from, tip, {
    initialSpan: 50_000,
    onProgress: (p) => onProgress(p * 0.6, 'Reading ticket events…'),
  })
  const ids = [...new Set(logs.map((l) => l.topics[1]))]
  onProgress(0.6, `Checking ${ids.length.toLocaleString()} tickets…`)

  const calls = ids.flatMap((id) => [
    { target: ADDR.elysium.arbRetryableTx, data: retryableIface.encodeFunctionData('getTimeout', [id]) },
    { target: ADDR.elysium.arbRetryableTx, data: retryableIface.encodeFunctionData('getBeneficiary', [id]) },
  ])
  const res = await multicall(calls)
  const me = owner.toLowerCase()
  let alive = 0
  const mine: string[] = []
  ids.forEach((id, i) => {
    if (!res[i * 2]) return
    alive++
    const ben = res[i * 2 + 1]
    if (ben && utils.defaultAbiCoder.decode(['address'], ben)[0].toLowerCase() === me) mine.push(id)
  })
  onProgress(0.85, `Diagnosing ${mine.length} of your tickets…`)
  const tickets = (await Promise.all(mine.slice(-40).map(getTicket))).filter(Boolean) as Ticket[]
  onProgress(1, 'Done')
  return { scanned: ids.length, aliveNetworkWide: alive, tickets: tickets.reverse() }
}

/** HYPE and token withdrawals sent by or to `owner`, with claim status. */
export async function findWithdrawals(owner: string, onProgress: (p: number, msg: string) => void) {
  const E = rpc().elysium
  const tip = await E.getBlockNumber()
  const who = utils.hexZeroPad(owner, 32).toLowerCase()
  onProgress(0, 'Searching withdrawals…')
  const span = { initialSpan: 5_000_000 }
  const [hype, tokFrom, tokTo] = await Promise.all([
    getLogsChunked(E, { address: ADDR.elysium.arbSys, topics: [TOPIC.l2ToL1Tx, who] }, 0, tip, span),
    getLogsChunked(E, { address: [ADDR.elysium.erc20Gateway, ADDR.elysium.bridgeWalletGateway], topics: [TOPIC.withdrawalInitiated, who] }, 0, tip, span),
    getLogsChunked(E, { address: [ADDR.elysium.erc20Gateway, ADDR.elysium.bridgeWalletGateway], topics: [TOPIC.withdrawalInitiated, null, who] }, 0, tip, span),
  ])
  const hashes = [...new Set([...hype, ...tokFrom, ...tokTo].sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber)).map((l) => l.transactionHash))].slice(0, 50)
  onProgress(0.2, `Reading ${hashes.length} withdrawals…`)
  const receipts = await Promise.all(hashes.map((h) => E.getTransactionReceipt(h)))
  const byHash = new Map(receipts.map((r) => [r.transactionHash, r]))
  const all = receipts.flatMap(parseWithdrawals)

  // Claimed = outbox leaf spent. One cheap call each, in small batches for
  // the rate-limited HyperEVM RPC.
  const outbox = new Contract(ADDR.hyperevm.outbox, ['function isSpent(uint256) view returns (bool)'], rpc().hyperevm)
  for (let i = 0; i < all.length; i += 5) {
    const spent = await Promise.all(all.slice(i, i + 5).map((w) => outbox.isSpent(w.position)))
    spent.forEach((s, j) => s && (all[i + j].status = 'claimed'))
    onProgress(0.2 + (0.5 * (i + 5)) / all.length, 'Checking which are already claimed…')
  }

  // Confirmation is monotonic in outbox position, so binary-search the
  // boundary with the SDK instead of asking about every withdrawal.
  const open = all.filter((w) => w.status !== 'claimed').sort((a, b) => Number(BigInt(a.position) - BigInt(b.position)))
  let lo = 0, hi = open.length // open[0..lo) claimable, open[hi..) waiting
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const s = await sdkStatus(byHash.get(open[mid].txHash)!, open[mid].index)
    if (s === 'waiting') hi = mid
    else lo = mid + 1
    onProgress(0.75, 'Checking challenge period…')
  }
  open.forEach((w, i) => (w.status = i < lo ? 'claimable' : 'waiting'))
  onProgress(1, 'Done')
  const rank = { claimable: 0, waiting: 1, claimed: 2 }
  return all.sort((a, b) => rank[a.status] - rank[b.status] || b.block - a.block)
}

/** Network-wide count of stuck tickets in the recent window — the hero "pulse". */
export async function networkPulse(minutes = 30) {
  const E = rpc().elysium
  const { tip, bps } = await blocksPerSecond()
  const from = tip - Math.round(minutes * 60 * bps)
  const logs = await getLogsChunked(E, { address: ADDR.elysium.arbRetryableTx, topics: [TOPIC.ticketCreated] }, from, tip, { initialSpan: 50_000 })
  const ids = [...new Set(logs.map((l) => l.topics[1]))]
  const res = await multicall(ids.map((id) => ({ target: ADDR.elysium.arbRetryableTx, data: retryableIface.encodeFunctionData('getTimeout', [id]) })))
  return { created: ids.length, stuck: res.filter(Boolean).length, minutes }
}
