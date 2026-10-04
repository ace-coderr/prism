# PRISM

**Live:** https://prism-crystal.vercel.app

A stock basket you can hold. PRISM turns a basket of tokenized stocks + ETH on
Robinhood Chain Testnet into a 3D voxel crystal: each holding is a cluster of
cubes sized by weight, tinted by its 24h move, and spiked by its volatility.
Deep drawdowns crack the crystal; recovered ones are filled with glowing gold
cubes (kintsugi). Later, each crystal becomes an NFT that owns its basket.
Built for the vibe/vibe launchpad.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Vite + React + TypeScript app (react-three-fiber, drei, Tailwind, Motion) |
| `apps/video` | Remotion: the 40-second explainer (renders into `apps/web/public/media/`) |
| `packages/core` | Pure TS logic: `buildCrystal`, weight helpers, chain config (vitest) |
| `contracts` | Hardhat + TypeScript contracts (step 2) |
| `PLAN.md` | Phase plan |

## Run

```bash
npm install
npm test                 # core + web unit tests (offline)
npm run test:rpc         # + live read-only checks against the testnet RPC
npm run verify:tokens    # re-verify token candidates on chain 46630
npm run check:liquidity  # probe Uniswap V4 pools for the verified tokens
npm run dev              # http://localhost:5173
npm run test:contracts   # Hardhat tests for the PrismCrystal contract
npm run video:studio     # edit the explainer in Remotion Studio
npm run video:render     # re-render the explainer videos + poster (each video < 6 MB)
```

## Explainer video

`apps/video` is a Remotion project (React + TypeScript) that reuses `buildCrystal` from
`packages/core`, the voxel look, the palette and the fonts (Space Grotesk, Space Mono; SIL OFL,
in `apps/video/public/fonts`). No voiceover and no music, only short captions. The crystal in
the video is an illustrative basket of the six supported assets (it explains the idea; the
live data is on the site). The end card shows one official vibe viber, loaded as-is from
vibe/vibe's site, with a small credit. `npm run video:render` writes:

| File | Format |
| --- | --- |
| `prism-explainer.mp4` | 1920×1080, H.264 (Home section 04) |
| `prism-explainer.webm` | 1920×1080, VP9 (Home section 04) |
| `prism-explainer-poster.jpg` | poster frame |
| `prism-explainer-square.mp4` | 1080×1080, H.264 (for X) |

## Deployed contract

**PrismCrystal on Robinhood Chain Testnet (46630):**
[`0x59ce49dE3782FA87E94850b23FEB1457009f9f40`](https://explorer.testnet.chain.robinhood.com/address/0x59ce49dE3782FA87E94850b23FEB1457009f9f40#code)
— source verified on Blockscout; deployed at block 128575215 in tx
[`0xd2a73a56…`](https://explorer.testnet.chain.robinhood.com/tx/0xd2a73a5619ff9e3ac90ecb3ed9e02963af34ec360b41614a4b0fe0f480c86b57).
`npx tsx packages/core/scripts/check-deployment.ts` re-checks that the on-chain code matches
this repo's compiled contract byte for byte.

## Wallet + contract

- Injected wallets (MetaMask, Rabby, …) via wagmi. PRISM never asks for or stores keys.
- `/deploy` (dev server only, not in the nav) deploys `PrismCrystal` from your wallet. The address goes in
  `packages/core/src/deployments.ts`; then Forge and My Crystals switch to real on-chain mode.

## Hosting (Vercel)

`vercel.json` at the repo root does the work: `npm ci` at the root (npm workspaces, so
`@prism/core` is linked), `npm run build` (builds `apps/web`), output `apps/web/dist`, and a
catch-all rewrite to `index.html` so routes like `/forge` survive a refresh. No environment
variables. The one-time `/deploy` page exists only on the dev server.

Check a production build locally with the same rewrite behaviour:

```bash
npm run build && npm run serve:dist -w @prism/web   # http://localhost:4173
```

## vibe vibers

vibe/vibe's "vibe vibers" characters appear in PRISM **with permission** from the vibe/vibe
team (Telegram, 2026-10-04). Only official images are used, shown as-is, loaded from vibe/vibe's
own site (`https://testnet.vibevibe.fun/vibers/collection/<file>-480.webp`, the collection listed
on https://testnet.vibevibe.fun/vibe-vibers). Nothing is redrawn, recoloured, cropped or generated.

vibe vibers images are © vibe/vibe and featured with the team's permission (Telegram, 2026-10-04).

Holders' own vibers: `packages/core/src/vibers.ts` reads the wallet's viber (read-only) from the
official NFT once `VIBERS_NFT` is set. As of 2026-10-04 no vibers NFT contract is published (none
on Robinhood Chain Testnet; vibe/vibe doesn't support mainnet 4663 yet; the mint is announced as
upcoming), so that slot is empty and no address is guessed.

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
- **No mock data anywhere.** The Home crystal is a live equal-weight basket (AAPL, NVDA, SPCX,
  ANTHROPIC, OPENAI, WETH): colours from real 24h moves, spikes from real price swings, and
  cracks / gold seams from real drops in the pools' swap history (last 48h). Gallery, My
  Crystals and Agent show only real crystals; each real crystal's cracks and seams come from
  its holdings' price history since its own forge block (the `Forged` event). The Agent
  compares weights at forge-time prices with weights at live prices. A test
  (`apps/web/test/no-mock-imports.test.ts`) fails if app code imports a mock/sample module.
- **Cracks and gold seams:** a drop of 5% or more (peak to trough) cracks the crystal; once
  the price climbs back to that peak, the crack is filled with gold. Testnet history is days,
  not years, so this threshold is lower than the 15% long-run default in `buildCrystal`.
  Without an indexer, history older than ~14 days isn't scanned.

Testnet only, no real funds.
