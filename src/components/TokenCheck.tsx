import { useEffect, useState } from 'react'
import { utils } from 'ethers'
import { ELYSIUM } from '../config'
import { checkToken, type TokenReport, type Level } from '../lib/token'
import { Addr, Badge, errText } from './ui'

const ICON: Record<Level, string> = { ok: '✓', warn: '!', fail: '✕', info: 'i' }

export function TokenCheck({ address: initial, onMirror }: { address?: string; onMirror?: (a: string) => void }) {
  const [input, setInput] = useState(initial ?? '')
  const [report, setReport] = useState<TokenReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run(a: string) {
    if (!utils.isAddress(a.trim())) return setErr('Enter a token contract address (0x…, 40 hex chars).')
    setBusy(true)
    setErr(null)
    setReport(null)
    try {
      const r = await checkToken(a.trim())
      if (!r.reports.length) setErr('No contract at this address on Elysium or HyperEVM testnet.')
      else setReport(r)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (initial) {
      setInput(initial)
      run(initial)
    }
  }, [initial])

  return (
    <div className="stack">
      <form
        className="card inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          run(input)
        }}
      >
        <div>
          <div className="eyebrow">Token preflight</div>
          <p className="muted">Checks a token before you bridge it: metadata, rebasing / fee-on-transfer fingerprints, upgradeability, canonical route, mirror setup and HyperCore link.</p>
        </div>
        <div className="field">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token address on Elysium or HyperEVM" spellCheck={false} aria-label="Token address" />
          <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Check token'}</button>
        </div>
      </form>
      {err && <p className="note note-fail">{err}</p>}
      {report?.reports.map((r) => {
        const worst = r.checks.some((c) => c.level === 'fail') ? 'fail' : r.checks.some((c) => c.level === 'warn') ? 'warn' : 'ok'
        return (
          <article className="card" key={r.chainId}>
            <header className="card-head">
              <div>
                <div className="eyebrow">{r.chainId === ELYSIUM.chainId ? 'On Elysium' : 'On HyperEVM'} · {r.role}</div>
                <h3>
                  {r.meta ? `${r.meta.name} (${r.meta.symbol})` : 'Unknown token'} <Addr a={report.address} chainId={r.chainId} />
                </h3>
              </div>
              <Badge tone={worst}>{worst === 'ok' ? 'Ready' : worst === 'warn' ? 'Review warnings' : 'Not bridgeable'}</Badge>
            </header>
            <ul className="checks">
              {r.checks.map((c, i) => (
                <li key={i} className={`check check-${c.level}`}>
                  <span className="dot" aria-hidden>{ICON[c.level]}</span>
                  <div>
                    <b>{c.title}</b>
                    {c.detail && <p>{c.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {r.role === 'Elysium-native token' && onMirror && (
              <div className="action">
                <span className="muted">Set up or repair the HyperEVM mirror for this token.</span>
                <button className="btn primary" onClick={() => onMirror(report.address)}>
                  Open mirror wizard →
                </button>
              </div>
            )}
            {r.links.length > 0 && (
              <div className="links">
                {r.links.map((l) => (
                  <span key={l.label + l.address}>
                    {l.label}: <Addr a={l.address} chainId={l.chainId} />
                  </span>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
