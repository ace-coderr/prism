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

- **Forge → Testnet tokens** uses `packages/core/src/tokens.ts`: the vibe/vibe Discover test
  stocks (NVDA, SPCX/SpaceX, AAPL) and pre-IPO test assets (OPENAI, ANTHROPIC), plus WETH and
  Seedify's mock SPCX. All are test assets with no value. Each address cites its source and
  passed on-chain `name/symbol/decimals/totalSupply` checks; the app re-checks on load.
- **Prices** (read-only, no wallet): (a) the vibe/vibe API (`v6/pair-prices`, `market/eth-usd`),
  else (b) the token's Uniswap V4 pool spot price. **24h change** (vs ETH) and **volatility**
  come from the pool's real `Swap` events over the last 24h. Every row says which source it
  used; nothing is invented. There are no Chainlink feeds on testnet.
- The vibe/vibe API answers other websites with HTTP 403, so the app reads it through a
  same-origin proxy (`/vibe-api` in `vite.config.ts`, dev + preview). A static deploy needs the
  same rewrite, or prices fall back to on-chain pool spot (in ETH).
- Robinhood's official Stock Tokens are deployed on **mainnet (4663) only** for now.
- **Sample tokens**, My Crystals, Gallery and Agent use mock data and say so with a
  "Sample data" badge.

Testnet only, no real funds.
