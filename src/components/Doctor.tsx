import { useEffect, useRef, useState } from 'react'
import { HYPEREVM, ELYSIUM } from '../config'
import {
  claimWithdrawal,
  findStuckTickets,
  findWithdrawals,
  getTicket,
  redeemTicket,
  type Diagnosis,
  type Ticket,
  type Withdrawal,
} from '../lib/doctor'
import { Addr, Badge, Progress, Row, amount, errText, gwei, hype, timeAgo, timeLeft, useTokenMeta, type Tone } from './ui'

const TICKET_TONE: Record<Ticket['state'], [Tone, string]> = {
  stuck: ['warn', 'Stuck — needs redeem'],
  redeemed: ['ok', 'Delivered'],
  expired: ['fail', 'Expired'],
  'not-created': ['info', 'Not on Elysium yet'],
}

const AUTO_REDEEM: Record<Ticket['autoRedeem'], string> = {
  succeeded: 'Auto-executed on arrival.',
  failed: 'Auto-execution ran and reverted.',
  'skipped-low-bid': 'Auto-execution was skipped: the gas price bid was below Elysium’s base fee at that block.',
  'skipped-underfunded': 'Auto-execution was skipped: the deposit didn’t cover submission + gas.',
  unknown: 'No auto-execution was scheduled.',
}

export function TicketCard({ initial }: { initial: Ticket }) {
  const [t, setT] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null)
  const [tone, label] = TICKET_TONE[t.state]
  const meta = useTokenMeta(HYPEREVM.chainId, t.deposit?.token)

  async function redeem() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await redeemTicket(t.id)
      setMsg({ tone: 'ok', text: `Redeem sent in ${r.transactionHash.slice(0, 12)}…` })
      const fresh = await getTicket(t.id)
      if (fresh) setT(fresh)
    } catch (e) {
      setMsg({ tone: 'fail', text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card">
      <header className="card-head">
        <div>
          <div className="eyebrow">Retryable ticket · {t.kind}</div>
          <h3>
            <Addr a={t.id} tx />
          </h3>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </header>

      <p className="diagnosis">
        {AUTO_REDEEM[t.autoRedeem]}
        {t.autoRedeem === 'skipped-low-bid' && (
          <>
            {' '}
            Bid <b>{gwei(t.bid)}</b> vs base fee <b>{gwei(t.baseFeeAtCreation)}</b>.
          </>
        )}
      </p>

      <div className="grid2">
        <Row k="Created">{timeAgo(t.timestamp)} · block {t.block.toLocaleString()}</Row>
        <Row k="Sent by">{t.l1SenderLabel ?? <Addr a={t.l1Sender} chainId={HYPEREVM.chainId} />}</Row>
        <Row k="Beneficiary"><Addr a={t.beneficiary} /></Row>
        <Row k="Target"><Addr a={t.retryTo} /></Row>
        {t.deposit && (
          <>
            <Row k="Token"><Addr a={t.deposit.token} chainId={HYPEREVM.chainId} /></Row>
            <Row k="Amount">{amount(t.deposit.amount, meta)} → <Addr a={t.deposit.to} /></Row>
          </>
        )}
        {t.retryValue.gt(0) && <Row k="Value">{hype(t.retryValue)}</Row>}
        {t.timeout && <Row k="Expires">{timeLeft(t.timeout)}</Row>}
      </div>

      {t.state === 'stuck' && (
        <div className="action">
          {t.simulation?.ok ? (
            <Badge tone="ok">Simulation: redeem would succeed now</Badge>
          ) : (
            <Badge tone="fail">Simulation reverts: {t.simulation?.reason}</Badge>
          )}
          <button className="btn primary" onClick={redeem} disabled={busy}>
            {busy ? 'Confirm in wallet…' : 'Redeem on Elysium'}
          </button>
        </div>
      )}
      {msg && <p className={`note note-${msg.tone}`}>{msg.text}</p>}
    </article>
  )
}

const W_TONE: Record<Withdrawal['status'], [Tone, string]> = {
  waiting: ['info', 'In challenge period'],
  claimable: ['warn', 'Ready to claim'],
  claimed: ['ok', 'Claimed'],
}

export function WithdrawalCard({ initial }: { initial: Withdrawal }) {
  const [w, setW] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null)
  const [tone, label] = W_TONE[w.status]
  const meta = useTokenMeta(HYPEREVM.chainId, w.token?.l1Token)

  async function claim() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await claimWithdrawal(w.txHash, w.index)
      setMsg({ tone: 'ok', text: `Claimed on HyperEVM in ${r.transactionHash.slice(0, 12)}…` })
      setW({ ...w, status: 'claimed' })
    } catch (e) {
      setMsg({ tone: 'fail', text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card">
      <header className="card-head">
        <div>
          <div className="eyebrow">Withdrawal · Elysium → HyperEVM</div>
          <h3>
            <Addr a={w.txHash} tx />
          </h3>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </header>
      <div className="grid2">
        <Row k="Sent">{timeAgo(w.timestamp)}</Row>
        <Row k="Outbox position">{w.position}</Row>
        {w.token ? (
          <>
            <Row k="Token (HyperEVM)"><Addr a={w.token.l1Token} chainId={HYPEREVM.chainId} /></Row>
            <Row k="Amount">{amount(w.token.amount, meta)}</Row>
            <Row k="Recipient"><Addr a={w.token.to} chainId={HYPEREVM.chainId} /></Row>
          </>
        ) : (
          <>
            <Row k="Amount">{hype(w.value)}</Row>
            <Row k="Recipient"><Addr a={w.destination} chainId={HYPEREVM.chainId} /></Row>
          </>
        )}
      </div>
      {w.status === 'claimable' && (
        <div className="action">
          <span className="muted">Funds wait in the HyperEVM outbox until someone executes the claim.</span>
          <button className="btn primary" onClick={claim} disabled={busy}>
            {busy ? 'Confirm in wallet…' : 'Claim on HyperEVM'}
          </button>
        </div>
      )}
      {w.status === 'waiting' && <p className="muted">Becomes claimable once the assertion containing it is confirmed on HyperEVM.</p>}
      {msg && <p className={`note note-${msg.tone}`}>{msg.text}</p>}
    </article>
  )
}

export function DiagnosisView({ d }: { d: Diagnosis }) {
  if (d.chain === 'none')
    return <p className="note note-fail">Transaction not found on Elysium or HyperEVM testnet. If you use a custom RPC, check it in Settings.</p>
  return (
    <div className="stack">
      <div className="result-head">
        <Badge tone="live">Found on {d.chain === 'elysium' ? ELYSIUM.name : HYPEREVM.name}</Badge>
        <Addr a={d.hash} tx chainId={d.chain === 'elysium' ? ELYSIUM.chainId : HYPEREVM.chainId} />
      </div>
      {d.note && <p className="note note-info">{d.note}</p>}
      {d.pendingTickets > 0 && <p className="note note-info">{d.pendingTickets} message(s) not yet created on Elysium — usually under a minute.</p>}
      {d.ethDeposits.map((e) => (
        <article className="card" key={e.childTxHash}>
          <header className="card-head">
            <div>
              <div className="eyebrow">HYPE deposit</div>
              <h3>{hype(e.value)} → <Addr a={e.to} /></h3>
            </div>
            <Badge tone={e.status === 'done' ? 'ok' : 'info'}>{e.status === 'done' ? 'Credited' : 'Pending'}</Badge>
          </header>
        </article>
      ))}
      {d.tickets.map((t) => <TicketCard key={t.id} initial={t} />)}
      {d.withdrawals.map((w) => <WithdrawalCard key={w.txHash + w.index} initial={w} />)}
    </div>
  )
}

const WINDOWS = [
  { h: 1, label: '1 hour' },
  { h: 6, label: '6 hours' },
  { h: 24, label: '24 hours' },
  { h: 168, label: '7 days (slow)' },
]

export function WalletScan({ address }: { address: string }) {
  const [hours, setHours] = useState(1)
  const [prog, setProg] = useState<{ p: number; msg: string } | null>(null)
  const [res, setRes] = useState<{ tickets: Ticket[]; scanned: number; alive: number; withdrawals: Withdrawal[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    setErr(null)
    setRes(null)
    try {
      const w = await findWithdrawals(address, (p, msg) => setProg({ p: p * 0.2, msg }))
      const s = await findStuckTickets(address, hours, (p, msg) => setProg({ p: 0.2 + p * 0.8, msg }))
      setRes({ tickets: s.tickets, scanned: s.scanned, alive: s.aliveNetworkWide, withdrawals: w })
    } catch (e) {
      setErr(errText(e))
    } finally {
      setProg(null)
    }
  }

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    run()
  }, [])

  const claimable = res?.withdrawals.filter((w) => w.status === 'claimable') ?? []
  return (
    <div className="stack">
      <div className="card scan-bar">
        <div>
          <div className="eyebrow">Wallet checkup</div>
          <h3><Addr a={address} /></h3>
        </div>
        <label className="select">
          Tickets from the last
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {WINDOWS.map((o) => <option key={o.h} value={o.h}>{o.label}</option>)}
          </select>
        </label>
        <button className="btn primary" onClick={run} disabled={!!prog}>
          {prog ? 'Scanning…' : res ? 'Scan again' : 'Run checkup'}
        </button>
      </div>
      {prog && <Progress {...prog} />}
      {err && <p className="note note-fail">{err}</p>}
      {res && (
        <>
          <div className="summary">
            <div><b>{res.tickets.length}</b><span>your stuck tickets</span></div>
            <div><b>{claimable.length}</b><span>withdrawals to claim</span></div>
            <div><b>{res.alive.toLocaleString()}</b><span>stuck network-wide (of {res.scanned.toLocaleString()})</span></div>
          </div>
          {!res.tickets.length && !res.withdrawals.length && <p className="note note-ok">Clean bill of health — nothing stuck for this address.</p>}
          {res.tickets.map((t) => <TicketCard key={t.id} initial={t} />)}
          {res.withdrawals.map((w) => <WithdrawalCard key={w.txHash + w.index} initial={w} />)}
        </>
      )}
    </div>
  )
}
