// HyperEVM <-> HyperCore amount scaling for deposit wallets.
// extra = underlyingDecimals - coreWeiDecimals, valid range [-2, 18].
// A deposit of `amount` EVM base units credits amount / 10^extra Core wei and
// must be an exact multiple of 10^extra (else AmountNotCoreAligned).

export type Alignment =
  | { ok: false; error: string }
  | {
      ok: true
      extra: number
      baseUnits: bigint
      coreWei: bigint
      aligned: boolean
      step: bigint
      roundDown: bigint
      roundUp: bigint
      overflowsU64: boolean
    }

const U64_MAX = (1n << 64n) - 1n

export function parseUnits(human: string, decimals: number): bigint | null {
  const s = human.trim()
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null
  const [int, frac = ''] = s.split('.')
  if (frac.length > decimals) return null
  return BigInt(int || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

export function formatUnits(v: bigint, decimals: number): string {
  if (decimals <= 0) return (v * 10n ** BigInt(-decimals)).toString()
  const s = v.toString().padStart(decimals + 1, '0')
  const int = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

export function align(underlyingDecimals: number, coreWeiDecimals: number, human: string): Alignment {
  const extra = underlyingDecimals - coreWeiDecimals
  if (extra < -2 || extra > 18) return { ok: false, error: `evmExtraWeiDecimals = ${extra}; HyperCore only links tokens with a value in [-2, 18].` }
  const baseUnits = parseUnits(human, underlyingDecimals)
  if (baseUnits === null) return { ok: false, error: `Not a valid amount with at most ${underlyingDecimals} decimals.` }
  const step = extra > 0 ? 10n ** BigInt(extra) : 1n
  const coreWei = extra >= 0 ? baseUnits / step : baseUnits * 10n ** BigInt(-extra)
  const roundDown = (baseUnits / step) * step
  const roundUp = roundDown === baseUnits ? baseUnits : roundDown + step
  return { ok: true, extra, baseUnits, coreWei, aligned: baseUnits % step === 0n, step, roundDown, roundUp, overflowsU64: coreWei > U64_MAX }
}
