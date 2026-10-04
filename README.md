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
npm run test:contracts   # Hardhat tests for the PrismCrystal contract
```

## Deployed contract

**PrismCrystal on Robinhood Chain Testnet (46630):**
[`0x59ce49dE3782FA87E94850b23FEB1457009f9f40`](https://explorer.testnet.chain.robinhood.com/address/0x59ce49dE3782FA87E94850b23FEB1457009f9f40#code)
— source verified on Blockscout; deployed at block 128575215 in tx
[`0xd2a73a56…`](https://explorer.testnet.chain.robinhood.com/tx/0xd2a73a5619ff9e3ac90ecb3ed9e02963af34ec360b41614a4b0fe0f480c86b57).
`npx tsx packages/core/scripts/check-deployment.ts` re-checks that the on-chain code matches
this repo's compiled contract byte for byte.

## Wallet + contract

- Injected wallets (MetaMask, Rabby, …) via wagmi. PRISM never asks for or stores keys.
- `/deploy` (not in the nav) deploys `PrismCrystal` from your wallet. The address goes in
  `packages/core/src/deployments.ts`; then Forge and My Crystals switch to real on-chain mode.

## Data: what is real

- **Forge → Testnet tokens** uses `packages/core/src/tokens.ts`: the vibe/vibe Discover test
  stocks (NVDA, SPCX/SpaceX, AAPL) and pre-IPO test assets (OPENAI, ANTHROPIC), plus WETH and
  Seedify's mock SPCX. All are test assets with no value. Each address cites its source and
  passed on-chain `name/symbol/decimals/totalSupply` checks; the app re-checks on load.
- **Prices are fully on-chain** (read-only, no wallet, no third-party APIs): each token's
  price in ETH comes from its ETH-paired Uniswap V4 pool, ETH's USD price from the ETH/USDG
  pool, and USD = ETH price × ETH/USD. **24h change** and **volatility** come from those
  pools' real `Swap` events over the last 24h, combined into a USD series. Labelled
  "On-chain pool price". There are no Chainlink feeds on testnet.
- Testnet USD is only as good as the ETH/USDG test pool: it currently values ETH around
  $1.8k, well below the real market, so USD figures are testnet values, not market prices.
- The vibe/vibe API blocks third-party origins, so PRISM does not call it. Ask vibe/vibe to
  allowlist PRISM's domain before using it.
- Robinhood's official Stock Tokens are deployed on **mainnet (4663) only** for now.
- **Sample tokens**, My Crystals, Gallery and Agent use mock data and say so with a
  "Sample data" badge.

Testnet only, no real funds.
