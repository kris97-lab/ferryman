# Ferryman

*Every message reaches the other shore.*

Diagnose and rescue bridge messages between HyperEVM testnet (998) and Elysium testnet (99801).

- **Doctor** — paste any tx hash from either chain:
  - deposits (HyperEVM → Elysium): finds the retryable ticket, explains why auto-execution didn't happen
    (e.g. gas bid below Elysium's base fee), simulates the redeem, and redeems through your wallet.
  - withdrawals (Elysium → HyperEVM): waiting / ready to claim / claimed, with a one-click claim.
- **Wallet checkup** — paste an address: stuck tickets where it is the beneficiary (recent window)
  plus every claimable withdrawal.
- **Token preflight** — rebasing / fee-on-transfer / mutable-metadata fingerprints, canonical route,
  mirror-bridge setup state (both steps), HyperCore spot link.
- **Mirror setup** — walks an Elysium-native token through `createL2Wallet` → `createAndRegisterL1Mirror`
  with a gas bid of 3× Elysium's live base fee (the docs' 0.1 gwei sample sits below it and stalls),
  dry-runs step 2, then watches Elysium until the router and wallet gateway routes land. Detects and
  repairs half-registered mirrors by re-sending the registration.
- **Core decimals** — `evmExtraWeiDecimals` alignment calculator for deposit wallets.

```bash
npm install
npm run dev
```

Stack: Vite + React + TypeScript, ethers v5, `@arbitrum/sdk` (Elysium is registered as a custom
Orbit network with a BoLD rollup, loaded lazily). Contract addresses live in `src/config.ts`.

## Deploy (Vercel)

1. Push the repo to GitHub and import it in Vercel (framework is detected from `vercel.json`).
2. In Project → Settings → Environment Variables set `ELYSIUM_RPC_URL` and `HYPEREVM_RPC_URL`
   (e.g. Alchemy endpoints with your key). See `.env.example`.
3. Deploy. In production the app reads through `/api/rpc/{elysium,hyperevm}` — an edge function that
   keeps the keys server-side and only forwards read-only JSON-RPC methods. Wallet transactions go
   straight from the user's wallet and never touch the proxy.

`vercel.json` also sets security headers, including `frame-ancestors 'none'` so the app can't be
embedded in another site (clickjacking protection for a page that asks for wallet signatures).

Notes
- The public HyperEVM RPC caps `eth_getLogs` at 1000 blocks and rate-limits; the proxy with your own
  endpoint fixes this. Users can still point at their own RPC in Settings.
- Elysium's RPC caps a `eth_getLogs` response at 10k logs; scans shrink their window automatically.
- Fingerprint checks scan bytecode for function selectors — they are heuristics, not proofs.
