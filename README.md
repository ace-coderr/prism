# PRISM

A stock basket you can hold. PRISM turns a basket of tokenized stocks + ETH on
Robinhood Chain Testnet into a 3D crystal: each holding is a facet cluster sized
by weight, tinted by its 24h move, and spiked by its volatility. Deep drawdowns
crack the crystal; recovered ones heal as gold kintsugi seams. Later, each
crystal becomes an NFT that owns its basket.

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
npm test        # core unit tests
npm run dev     # http://localhost:5173
```

All market data is mock for now. No wallet or contract code yet.
