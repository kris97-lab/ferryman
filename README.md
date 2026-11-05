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
Orbit network with a BoLD rollup). Contract addresses live in `src/config.ts`.

Notes
- The public HyperEVM RPC caps `eth_getLogs` at 1000 blocks and rate-limits; set your own in Settings.
- Elysium's RPC caps a `eth_getLogs` response at 10k logs; scans shrink their window automatically.
- Fingerprint checks scan bytecode for function selectors — they are heuristics, not proofs.
