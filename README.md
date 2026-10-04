# PRISM

A stock basket you can hold. PRISM turns a basket of tokenized stocks + ETH on
Robinhood Chain Testnet into a 3D voxel crystal: each holding is a cluster of
cubes sized by weight, tinted by its 24h move, and spiked by its volatility.
Deep drawdowns crack the crystal; recovered ones are filled with glowing gold
cubes (kintsugi). Later, each crystal becomes an NFT that owns its basket.
Built for the vibe/vibe launchpad.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Vite + React + TypeScript app (react-three-fiber, drei, Tailwind) |
| `packages/core` | Pure TS logic: `buildCrystal`, weight helpers, chain config (vitest) |
| `contracts` | Hardhat + TypeScript contracts (step 2) |
| `PLAN.md` | Phase plan |

## Run

```bash
npm install
npm test                 # core unit tests (offline)
npm run test:rpc         # + live read-only checks against the testnet RPC
npm run verify:tokens    # re-verify token candidates on chain 46630
npm run check:liquidity  # probe Uniswap V4 pools for the verified tokens
npm run dev              # http://localhost:5173
```

## Data: what is real

- **Forge → Testnet tokens** reads `packages/core/src/tokens.ts` live from the
  Robinhood Chain Testnet RPC (read-only, no wallet, no keys). Every address there cites
  its source and passed on-chain `name/symbol/decimals/totalSupply` checks.
- Robinhood's official Stock Tokens are currently deployed on **mainnet (4663) only**, and
  Chainlink publishes Robinhood feeds for mainnet only, so on testnet every token shows
  **"no price feed"** and renders in neutral grey. Prices are never invented.
- **Sample tokens**, My Crystals, Gallery and Agent use mock data and say so with a
  "Sample data" badge.

Testnet only, no real funds.
