import { useEffect, useState, type ReactNode } from 'react'
import { utils, type BigNumber } from 'ethers'
import { explorerAddr, explorerTx, rpc } from '../lib/chain'
import { readMeta, type Meta } from '../lib/token'
import { ELYSIUM } from '../config'

export const short = (s: string, n = 6) => (s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n + 2)}` : s)

export function timeAgo(ts: number) {
  const s = Math.round(Date.now() / 1000 - ts)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function timeLeft(ts: number) {
  const s = ts - Date.now() / 1000
  if (s <= 0) return 'expired'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`
}

export const gwei = (v: BigNumber) => `${Number(utils.formatUnits(v, 'gwei')).toFixed(4)} gwei`
export const hype = (v: BigNumber) => `${Number(utils.formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 6 })} HYPE`

export type Tone = 'ok' | 'warn' | 'fail' | 'info' | 'live'
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Addr({ a, chainId = ELYSIUM.chainId, tx = false }: { a: string; chainId?: number; tx?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="addr">
      <a href={tx ? explorerTx(chainId, a) : explorerAddr(chainId, a)} target="_blank" rel="noreferrer" title={a}>
        {short(a)}
      </a>
      <button
        className="copy"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(a).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  )
}

export function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  )
}

export function Progress({ p, msg }: { p: number; msg: string }) {
  return (
    <div className="progress" role="status">
      <div className="bar">
        <div style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
      <span>{msg}</span>
    </div>
  )
}

export function errText(e: any): string {
  if (e?.code === 4001 || e?.code === 'ACTION_REJECTED') return 'Rejected in wallet.'
  return e?.reason || e?.error?.message || e?.message || String(e)
}

const metaCache = new Map<string, Promise<Meta | undefined>>()
/** name/symbol/decimals of a token, cached per chain+address. */
export function useTokenMeta(chainId: number, address?: string) {
  const [meta, setMeta] = useState<Meta>()
  useEffect(() => {
    if (!address) return
    const key = chainId + address.toLowerCase()
    const provider = chainId === ELYSIUM.chainId ? rpc().elysium : rpc().hyperevm
    // the public HyperEVM RPC rate-limits bursts: retry with backoff, cache only hits
    const load = async () => {
      for (let i = 0; i < 4; i++) {
        const m = await readMeta(provider, address)
        if (m) return m
        await new Promise((r) => setTimeout(r, 800 * 2 ** i + Math.random() * 500))
      }
      metaCache.delete(key)
    }
    if (!metaCache.has(key)) metaCache.set(key, load())
    let live = true
    metaCache.get(key)!.then((m) => live && m && setMeta(m))
    return () => {
      live = false
    }
  }, [chainId, address])
  return meta
}

export function amount(v: BigNumber, meta?: Meta) {
  return meta ? `${Number(utils.formatUnits(v, meta.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${meta.symbol}` : `${v.toString()} base units`
}
