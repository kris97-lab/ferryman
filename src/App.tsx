import { useEffect, useState } from 'react'
import { utils } from 'ethers'
import { CityBackground } from './components/CityBackground'
import { DiagnosisView, WalletScan } from './components/Doctor'
import { TokenCheck } from './components/TokenCheck'
import { Decimals } from './components/Decimals'
import { MirrorWizard } from './components/MirrorWizard'
import { Progress, errText, short } from './components/ui'
import { Logo } from './components/Logo'
import { connectWallet, injected, loadRpcOverrides, saveRpcOverrides } from './lib/chain'
import { diagnose, networkPulse, type Diagnosis } from './lib/doctor'
import { isContract } from './lib/token'
import { ELYSIUM, HYPEREVM } from './config'

type Tab = 'doctor' | 'token' | 'mirror' | 'decimals'
type View = { kind: 'diagnosis'; d: Diagnosis } | { kind: 'wallet'; address: string } | null

const EXAMPLES = [
  { label: 'Stuck ticket', value: '0xe2172fb783075a8d7da422d1e3484175f318a95c3449ab214e7a816799005256' },
  { label: 'Claimable withdrawal', value: '0x24030824da9ce6a1182e42b4173d04efcd71a57a669b46b52fcb535fe7a67b53' },
  { label: 'Wallet checkup', value: '0x32E863A15c0Af01f698a84B966070eD4E958ECA9' },
  { label: 'Token', value: '0x4a25f807EE4dce1537bd8f56EA6A8A774505a2f2' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('doctor')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>(null)
  const [tokenAddr, setTokenAddr] = useState<string>()
  const [mirrorAddr, setMirrorAddr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [pulse, setPulse] = useState<{ stuck: number; created: number; minutes: number } | null>(null)
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    networkPulse(15).then(setPulse).catch(() => {})
    injected()?.request({ method: 'eth_accounts' }).then((a: string[]) => a[0] && setAccount(a[0])).catch(() => {})
    injected()?.on?.('accountsChanged', (a: string[]) => setAccount(a[0] ?? null))
  }, [])

  async function submit(raw: string) {
    const q = raw.trim()
    setErr(null)
    if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
      setTab('doctor')
      setBusy(true)
      setView(null)
      try {
        setView({ kind: 'diagnosis', d: await diagnose(q) })
      } catch (e) {
        setErr(errText(e))
      } finally {
        setBusy(false)
      }
    } else if (utils.isAddress(q)) {
      setBusy(true)
      try {
        if (await isContract(q)) {
          setTokenAddr(q)
          setTab('token')
        } else {
          setTab('doctor')
          setView({ kind: 'wallet', address: utils.getAddress(q) })
        }
      } catch (e) {
        setErr(errText(e))
      } finally {
        setBusy(false)
      }
    } else if (q) setErr('Paste a transaction hash (66 chars) or an address (42 chars).')
  }

  return (
    <>
      <CityBackground />
      <div className="shell">
        <nav className="nav glass">
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setView(null); setTab('doctor') }}>
            <Logo />
            <span>Ferryman</span>
          </a>
          <div className="tabs" role="tablist">
            {([
              ['doctor', 'Doctor'],
              ['token', 'Token preflight'],
              ['mirror', 'Mirror setup'],
              ['decimals', 'Core decimals'],
            ] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="nav-right">
            <button className="icon-btn" aria-label="RPC settings" onClick={() => setSettings(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
            </button>
            {account ? (
              <button className="btn light" onClick={() => submit(account)} title="Run a checkup on your wallet">
                {short(account, 4)} · Checkup
              </button>
            ) : (
              <button className="btn light" onClick={() => connectWallet().then(setAccount).catch((e) => setErr(errText(e)))}>
                Connect wallet
              </button>
            )}
          </div>
        </nav>

        <header className="hero">
          <div className="pill glass">
            <span className="live-dot" />
            {pulse ? (
              <span>
                Elysium testnet · <b>{pulse.stuck.toLocaleString()}</b> of {pulse.created.toLocaleString()} bridge messages stuck in the last {pulse.minutes} min
              </span>
            ) : (
              <span>Elysium testnet · checking network pulse…</span>
            )}
          </div>
          <h1>
            Unstick your
            <br />
            bridge.
          </h1>
          <p className="lede">
            Diagnose deposits and withdrawals between HyperEVM and Elysium, rescue stuck messages before they expire, and preflight tokens before you bridge.
          </p>
          <form
            className="search glass"
            onSubmit={(e) => {
              e.preventDefault()
              submit(query)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Paste a tx hash from either chain, a wallet or a token address"
              spellCheck={false}
              aria-label="Transaction hash or address"
            />
            <button className="btn light" disabled={busy}>{busy ? 'Diagnosing…' : 'Diagnose'}</button>
          </form>
          <div className="examples">
            <span>Try:</span>
            {EXAMPLES.map((x) => (
              <button key={x.label} className="chip" onClick={() => { setQuery(x.value); submit(x.value) }}>
                {x.label}
              </button>
            ))}
          </div>
        </header>

        <main className="content">
          {err && <p className="note note-fail">{err}</p>}
          {tab === 'doctor' && (
            <>
              {busy && <Progress p={0.5} msg="Reading both chains…" />}
              {view?.kind === 'diagnosis' && <DiagnosisView d={view.d} />}
              {view?.kind === 'wallet' && <WalletScan key={view.address} address={view.address} />}
              {!view && !busy && <HowItWorks />}
            </>
          )}
          {tab === 'token' && (
            <TokenCheck
              address={tokenAddr}
              onMirror={(a) => {
                setMirrorAddr(a)
                setTab('mirror')
              }}
            />
          )}
          {tab === 'mirror' && (
            <MirrorWizard
              address={mirrorAddr}
              onDiagnose={(h) => {
                setQuery(h)
                submit(h)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          )}
          {tab === 'decimals' && <Decimals />}
        </main>

        <footer className="foot">
          Independent tool for Elysium testnet ({ELYSIUM.chainId}) and HyperEVM testnet ({HYPEREVM.chainId}). Not affiliated with Kinetiq. Reads are public RPC; writes go through your wallet.
        </footer>
      </div>
      {settings && <Settings onClose={() => setSettings(false)} />}
    </>
  )
}

function HowItWorks() {
  const items = [
    ['Deposit didn’t arrive?', 'Paste the HyperEVM tx. If the retryable wasn’t auto-executed we show why (usually a gas bid below Elysium’s base fee), simulate the redeem and let you execute it.'],
    ['Withdrawal stuck?', 'Paste the Elysium tx. Once the challenge period passes, funds wait in the HyperEVM outbox until someone claims — one click here.'],
    ['Check a whole wallet', 'Paste an address to find every stuck ticket where it is the beneficiary, plus all claimable withdrawals.'],
    ['Before you bridge a token', 'Token preflight flags rebasing, fee-on-transfer and mutable metadata, and shows the canonical, mirror and HyperCore routes.'],
    ['Launching on Elysium?', 'Mirror setup walks an Elysium-native token to HyperEVM with gas bids that actually clear — and repairs half-registered mirrors.'],
  ]
  return (
    <section className="how">
      {items.map(([t, d]) => (
        <div className="card" key={t}>
          <h3>{t}</h3>
          <p className="muted">{d}</p>
        </div>
      ))}
    </section>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const init = loadRpcOverrides()
  const [e, setE] = useState(init.elysium ?? '')
  const [h, setH] = useState(init.hyperevm ?? '')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal glass" role="dialog" aria-label="RPC settings" onClick={(ev) => ev.stopPropagation()}>
        <h3>RPC endpoints</h3>
        <p className="muted">The public HyperEVM testnet RPC is rate-limited. Plug in your own (e.g. Alchemy) if lookups fail.</p>
        <label>
          Elysium testnet
          <input value={e} onChange={(x) => setE(x.target.value)} placeholder={ELYSIUM.rpc} />
        </label>
        <label>
          HyperEVM testnet
          <input value={h} onChange={(x) => setH(x.target.value)} placeholder={HYPEREVM.rpc} />
        </label>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={() => {
              saveRpcOverrides({ elysium: e.trim() || undefined, hyperevm: h.trim() || undefined })
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
