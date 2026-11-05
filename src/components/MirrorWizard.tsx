import { useEffect, useRef, useState, type ReactNode } from 'react'
import { utils } from 'ethers'
import { ELYSIUM, HYPEREVM } from '../config'
import { injected } from '../lib/chain'
import {
  createWallet,
  estimateRegistration,
  mirrorState,
  registerMirror,
  simulateRegistration,
  type MirrorState,
} from '../lib/mirror'
import { Addr, Badge, errText, gwei, hype, type Tone } from './ui'

type Estimate = Awaited<ReturnType<typeof estimateRegistration>>

export function MirrorWizard({ address: initial, onDiagnose }: { address?: string; onDiagnose: (hash: string) => void }) {
  const [input, setInput] = useState(initial ?? '')
  const [s, setS] = useState<MirrorState | null>(null)
  const [est, setEst] = useState<Estimate | null>(null)
  const [sim, setSim] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState<{ chainId: number; hash: string; label: string }[]>([])
  const [watching, setWatching] = useState(false)
  const poll = useRef<number | undefined>(undefined)

  async function load(a: string) {
    if (!utils.isAddress(a.trim())) return setErr('Enter an Elysium token address.')
    setErr(null)
    setBusy('load')
    try {
      const st = await mirrorState(a.trim())
      setS(st)
      const from = (await injected()?.request({ method: 'eth_accounts' }).catch(() => []))?.[0] ?? '0x36dAbc3CEE2E1084B7d04c8015Ef68Cac78f4f37'
      const [e, d] = await Promise.all([estimateRegistration(from), st.step !== 'done' && !st.canonical ? simulateRegistration(st, from) : null])
      setEst(e)
      setSim(d)
    } catch (e) {
      setS(null)
      setErr(errText(e))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (initial) {
      setInput(initial)
      load(initial)
    }
  }, [initial])

  // after step 2, watch Elysium until both registration messages land
  useEffect(() => {
    if (!watching || !s) return
    let tries = 0
    poll.current = window.setInterval(async () => {
      tries++
      const st = await mirrorState(s.token).catch(() => null)
      if (st) setS(st)
      if ((st && st.step === 'done') || tries > 40) {
        setWatching(false)
        clearInterval(poll.current)
      }
    }, 5000)
    return () => clearInterval(poll.current)
  }, [watching, s?.token])

  async function run(label: string, fn: () => Promise<{ transactionHash: string }>, chainId: number, watch = false) {
    setBusy(label)
    setErr(null)
    try {
      const r = await fn()
      setSent((x) => [...x, { chainId, hash: r.transactionHash, label }])
      setS(await mirrorState(s!.token))
      if (watch) setWatching(true)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(null)
    }
  }

  const stepTone = (n: 1 | 2 | 3): [Tone, string] => {
    if (!s) return ['info', '']
    const done = s.step === 'done' || (typeof s.step === 'number' && s.step > n)
    if (done) return ['ok', 'Done']
    if (n === 3 && s.routeStuck) return ['fail', watching ? 'Waiting for Elysium…' : 'Stuck']
    if (s.step === n) return ['warn', 'Next']
    return ['info', 'Pending']
  }

  return (
    <div className="stack">
      <form
        className="card inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          load(input)
        }}
      >
        <div>
          <div className="eyebrow">Mirror setup wizard</div>
          <p className="muted">
            Makes an Elysium-native token bridgeable to HyperEVM. Two transactions, either order, then both registration messages must execute on Elysium. We bid a gas price that clears
            Elysium’s base fee, so they don’t get stuck the way the docs’ sample parameters do.
          </p>
        </div>
        <div className="field">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Elysium token address" spellCheck={false} aria-label="Elysium token address" />
          <button className="btn primary" disabled={!!busy}>{busy === 'load' ? 'Reading…' : 'Load token'}</button>
        </div>
      </form>

      {err && <p className="note note-fail">{err}</p>}

      {s?.canonical && (
        <p className="note note-info">
          {s.meta.symbol} is a canonical-bridge representation of <Addr a={s.canonical} chainId={HYPEREVM.chainId} />. It already moves through the standard gateway — no mirror needed.
        </p>
      )}

      {s && !s.canonical && (
        <>
          <article className="card">
            <header className="card-head">
              <div>
                <div className="eyebrow">Elysium-native token</div>
                <h3>
                  {s.meta.name} ({s.meta.symbol}) <Addr a={s.token} />
                </h3>
              </div>
              <Badge tone={s.step === 'done' ? 'ok' : s.routeStuck ? 'fail' : 'warn'}>
                {s.step === 'done' ? 'Route live' : s.routeStuck ? 'Half-registered' : `Step ${s.step} of 3`}
              </Badge>
            </header>
            <p className="muted">
              Mirror keyed on live metadata: “{s.meta.name}” / “{s.meta.symbol}” / {s.meta.decimals} decimals. Changing any of them later creates a different mirror.
            </p>
          </article>

          <Step n={1} title="Escrow wallet on Elysium" chain="Elysium" tone={stepTone(1)}>
            <p className="muted">
              <code>ElysiumBridgeFactory.createL2Wallet(token)</code> — holds the locked tokens. Address: <Addr a={s.wallet.address} />
            </p>
            {!s.wallet.live && (
              <div className="action">
                <span className="muted">Costs only Elysium gas.</span>
                <button className="btn primary" disabled={!!busy} onClick={() => run('wallet', () => createWallet(s.token), ELYSIUM.chainId)}>
                  {busy === 'wallet' ? 'Confirm in wallet…' : 'Create escrow wallet'}
                </button>
              </div>
            )}
          </Step>

          <Step n={2} title="Mirror on HyperEVM" chain="HyperEVM" tone={stepTone(2)}>
            <p className="muted">
              <code>ElysiumMirrorFactory.{s.mirror.deployed ? 'registerL1Mirror' : 'createAndRegisterL1Mirror'}</code> — {s.mirror.deployed ? 'registers the existing' : 'deploys the'} 1:1 mirror and
              sends two registration messages to Elysium. Mirror: <Addr a={s.mirror.address} chainId={HYPEREVM.chainId} />
            </p>
            {!s.mirror.registered && est && <FeeTable est={est} />}
            {!s.mirror.registered && (
              <div className="action">
                {sim && (sim.ok ? <Badge tone="ok">Dry run passes</Badge> : <Badge tone="fail">Dry run reverts: {sim.reason}</Badge>)}
                <button className="btn primary" disabled={!!busy || sim?.ok === false} onClick={() => run('mirror', () => registerMirror(s), HYPEREVM.chainId, true)}>
                  {busy === 'mirror' ? 'Confirm in wallet…' : `Register mirror · ${est ? hype(est.total) : '…'}`}
                </button>
              </div>
            )}
          </Step>

          <Step n={3} title="Registration lands on Elysium" chain="Elysium" tone={stepTone(3)}>
            <div className="grid2">
              <div className="row">
                <span className="k">Gateway router → wallet gateway</span>
                <span className="v">{s.elysiumRoute.router ? <Badge tone="ok">set</Badge> : <Badge tone="info">missing</Badge>}</span>
              </div>
              <div className="row">
                <span className="k">Wallet gateway → escrow wallet</span>
                <span className="v">{s.elysiumRoute.gateway ? <Badge tone="ok">set</Badge> : <Badge tone="info">missing</Badge>}</span>
              </div>
            </div>
            {s.routeStuck && !watching && (
              <>
                <p className="diagnosis" style={{ marginTop: 14 }}>
                  The mirror is registered on HyperEVM, but its two messages never executed on Elysium — almost always a gas bid below the base fee. Until they land, withdrawals revert
                  safely and no funds are at risk.
                </p>
                {est && <FeeTable est={est} />}
                <div className="action">
                  <span className="muted">
                    Re-sending is permissionless and idempotent. Or paste the original registration tx into Doctor to redeem its tickets.
                  </span>
                  <button className="btn primary" disabled={!!busy || sim?.ok === false} onClick={() => run('resend', () => registerMirror(s), HYPEREVM.chainId, true)}>
                    {busy === 'resend' ? 'Confirm in wallet…' : `Re-send registration · ${est ? hype(est.total) : '…'}`}
                  </button>
                </div>
              </>
            )}
            {watching && <p className="note note-info">Watching Elysium for the registration messages (usually under a minute)…</p>}
          </Step>

          {s.step === 'done' && (
            <p className="note note-ok">
              Route is live. Lock {s.meta.symbol} through the Elysium gateway router to mint the mirror on HyperEVM after the challenge period; burn the mirror on HyperEVM to release it back in
              about a minute.
            </p>
          )}

          {sent.length > 0 && (
            <article className="card">
              <div className="eyebrow">Sent from this page</div>
              {sent.map((t) => (
                <div className="row" key={t.hash}>
                  <span className="k">{t.label === 'wallet' ? 'Escrow wallet' : 'Mirror registration'}</span>
                  <span className="v">
                    <Addr a={t.hash} tx chainId={t.chainId} />{' '}
                    {t.chainId === HYPEREVM.chainId && (
                      <button className="chip" onClick={() => onDiagnose(t.hash)}>
                        Track messages
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </article>
          )}
        </>
      )}
    </div>
  )
}

function Step({ n, title, chain, tone: [tone, label], children }: { n: number; title: string; chain: string; tone: [Tone, string]; children: ReactNode }) {
  return (
    <article className={`card step step-${tone}`}>
      <header className="card-head">
        <div className="step-title">
          <span className="step-num">{n}</span>
          <div>
            <div className="eyebrow">On {chain}</div>
            <h3>{title}</h3>
          </div>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </header>
      {children}
    </article>
  )
}

function FeeTable({ est }: { est: Estimate }) {
  const p = est.params
  return (
    <div className="fees">
      <div className="row">
        <span className="k">Elysium base fee now</span>
        <span className="v mono">{gwei(est.elysiumBaseFee)}</span>
      </div>
      <div className="row">
        <span className="k">Our gas bid (3× base fee)</span>
        <span className="v mono">{gwei(p.gasPriceBid)}</span>
      </div>
      <div className="row">
        <span className="k">Docs sample bid</span>
        <span className="v mono">
          {gwei(est.docsBid)} {est.docsBid.lt(est.elysiumBaseFee) && <Badge tone="fail">would get stuck</Badge>}
        </span>
      </div>
      <div className="row">
        <span className="k">Per message: submission + 300k gas</span>
        <span className="v mono">{hype(p.valueForGateway)}</span>
      </div>
      <div className="row">
        <span className="k">Total sent (unused part refunded on Elysium)</span>
        <span className="v mono">{hype(est.total)}</span>
      </div>
    </div>
  )
}
