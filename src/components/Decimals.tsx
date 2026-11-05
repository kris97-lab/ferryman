import { useState } from 'react'
import { align, formatUnits } from '../lib/decimals'
import { Badge } from './ui'

export function Decimals() {
  const [evm, setEvm] = useState('18')
  const [core, setCore] = useState('8')
  const [amt, setAmt] = useState('100.000000001')
  const ud = Number(evm), cd = Number(core)
  const valid = Number.isInteger(ud) && Number.isInteger(cd) && ud >= 0 && ud <= 36 && cd >= 0 && cd <= 36
  const r = valid ? align(ud, cd, amt) : ({ ok: false, error: 'Decimals must be whole numbers from 0 to 36.' } as const)

  return (
    <article className="card">
      <div className="eyebrow">HyperEVM ↔ HyperCore amounts</div>
      <p className="muted">
        Deposit wallets scale by <code>evmExtraWeiDecimals = decimals − weiDecimals</code>. A deposit that isn’t a multiple of <code>10^extra</code> base
        units reverts with <code>AmountNotCoreAligned</code>.
      </p>
      <div className="calc">
        <label>
          ERC-20 decimals
          <input inputMode="numeric" value={evm} onChange={(e) => setEvm(e.target.value)} />
        </label>
        <label>
          Core weiDecimals
          <input inputMode="numeric" value={core} onChange={(e) => setCore(e.target.value)} />
        </label>
        <label className="wide">
          Amount to deposit
          <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </label>
      </div>
      {!r.ok ? (
        <p className="note note-fail">{r.error}</p>
      ) : (
        <div className="calc-out">
          <div className="row">
            <span className="k">evmExtraWeiDecimals</span>
            <span className="v mono">{r.extra}</span>
          </div>
          <div className="row">
            <span className="k">EVM base units</span>
            <span className="v mono">{r.baseUnits.toString()}</span>
          </div>
          <div className="row">
            <span className="k">Core wei credited</span>
            <span className="v mono">{r.coreWei.toString()}</span>
          </div>
          <div className="row">
            <span className="k">Status</span>
            <span className="v">
              {r.overflowsU64 ? (
                <Badge tone="fail">Credit overflows HyperCore u64</Badge>
              ) : r.aligned ? (
                <Badge tone="ok">Aligned — deposit will go through</Badge>
              ) : (
                <Badge tone="fail">Not aligned — would revert</Badge>
              )}
            </span>
          </div>
          {!r.aligned && (
            <div className="suggest">
              Use{' '}
              <button className="chip" onClick={() => setAmt(formatUnits(r.roundDown, ud))}>
                {formatUnits(r.roundDown, ud)}
              </button>{' '}
              or{' '}
              <button className="chip" onClick={() => setAmt(formatUnits(r.roundUp, ud))}>
                {formatUnits(r.roundUp, ud)}
              </button>
              <span className="muted"> (step {formatUnits(r.step, ud)})</span>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
