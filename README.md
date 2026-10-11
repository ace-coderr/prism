# PRISM

**Live:** https://seeprism.vercel.app

**PRISM: see every launch's true colors.** Reviews of vibe/vibe launches (and test stocks)
that can't lie:

- Only holders of a token can review it, and each review records how much the reviewer held.
- If a reviewer sells after reviewing, the review is marked **SOLD** for everyone.
- Each token gets a **true colors** score, counted only from reviewers who are still holding.
- Reviewers earn an **honesty rep** for holding what they review.

PRISM never holds anyone's money: no contract or server ever takes custody of user funds. The
review contract stores reviews only and rejects ETH.

Built on Robinhood Chain Testnet (chain 46630) for the vibe/vibe launchpad. Test assets only.

> The first PRISM (crystals: a stock basket you can hold) is archived on the
> [`archive/crystal-v1`](https://github.com/ace-coderr/prism/tree/archive/crystal-v1) branch and
> the [`crystal-v1`](https://github.com/ace-coderr/prism/releases/tag/crystal-v1) tag. Its
> contracts stay on-chain (listed as legacy in `packages/core/src/deployments.ts`), but this
> app no longer uses them.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Vite + React + TypeScript app (Tailwind, Motion, wagmi + Privy) |
| `apps/web/server` | Vercel functions (Node), listed in `server/routes.json` |
| `packages/core` | Pure TS logic shared by the app, the functions and the scripts (vitest) |
| `contracts` | Hardhat + TypeScript contracts |
| `PLAN.md` | Plan |

## Run

```bash
npm install
npm test                 # core + web unit tests (offline)
npm run test:rpc         # + live read-only checks against the testnet RPC
npm run verify:tokens    # re-verify the test stock addresses on chain 46630
npm run dev              # http://localhost:5173
npm run test:contracts   # Hardhat tests
npm run test:fork -w @prism/contracts   # PrismReviews against real tokens on a fork of the testnet
```

## Launch index (from the chain)

Every vibe/vibe launch is read from vibe/vibe's own launch contracts on Robinhood Chain Testnet,
never from their API (`packages/core/src/launches.ts`, `launchScan.ts`, `assets.ts`):

| Generation | Factory | Launch event | Graduation |
| --- | --- | --- | --- |
| gen 1 | `0xB5B7…9eb9` (from block 108435450) | `TokenLaunched` (ETH-paired) | `PoolGraduated` from its adapter `0x1eD9…501a` |
| gen 2 | `0x40f1…DF59` (from block 115025604) | `TokenLaunched` (ETH; one stock-paired variant) | `PoolGraduated` from its adapter `0xA6a5…7F06` |
| v6 | `0xe794…Fea0` (from block 123503237), the one stock-paired launches use | carries name, symbol, curve and quote asset | each curve's own event |

For each launch: token, name, symbol (read from the token for gen 1/2), quote asset (ETH, a test
stock, USDG, VIBEVIBE or another launch's token), lifecycle (on curve / graduated), creator,
launch block and generation. One entry per token address across generations and re-scans.
Together with the five test stocks (AAPL, NVDA, SPCX, ANTHROPIC, OPENAI) that's everything
reviewable. Holder checks are live `balanceOf` reads (`balancesOf` batches them in one
Multicall3 call).

**Kept fresh for free, with no secrets:**

1. `.github/workflows/launch-index.yml` runs every 30 minutes (free for public repos): it
   downloads the last index, reads the new blocks (`packages/core/scripts/index-launches.ts`) and
   republishes `launches.json.gz` as an asset of the `launch-index` release. Its only credential
   is the workflow's own short-lived `GITHUB_TOKEN`.
2. `GET /api/launches` (`apps/web/server/launches.ts`) loads that file, reads the blocks since
   (a few `eth_getLogs` calls), and answers with the stocks + newest launches, `?q=` search by
   name, symbol or address, or `?token=0x…`. Vercel's CDN caches each answer for 60 s.

Build an index locally (a first build reads ~207k launches):

```bash
npx tsx packages/core/scripts/index-launches.ts launches.json.gz
LAUNCH_INDEX_FILE=launches.json.gz npm run dev     # /api/launches serves that file
```

## Reviews (PrismReviews)

`contracts/contracts/PrismReviews.sol`, holder-only reviews:

- `post(token, rating 1–5, text ≤ 280 bytes)` only while holding the token; stores the balance
  held (`heldAtPost`), time and status; the text is in the `ReviewPosted` event.
- One current review per author per token: posting again (still holding, 1 hour after the last
  one) adds a new review linked to the one it replaces. Reviews are never deleted or edited.
- `markSold(id)`: anyone can call it; below half of `heldAtPost`, the review is SOLD for good.
  An update can't hide a sale (the old review is checked first).
- No owner, admin, fees or upgrades; it holds no funds and refuses ETH. See `contracts/SECURITY.md`.
- Not deployed yet: deploy it from your wallet on the dev-only `/deploy` page.

## Scoring

`packages/core/src/scoring.ts`, pure and fully tested:

- **Review status**: holding / trimmed X% / SOLD, from the author's live balance against
  `heldAtPost` (SOLD on-chain is final).
- **True colors** per token: the weighted average rating of current reviewers still holding.
  Weight = position size (what they still hold of what they reviewed, capped so nobody counts more
  than 10%, or an equal share with fewer than 10 reviewers) × holding time (0.25 on the day of
  posting → 1 at 7 days) × honesty rep. With few reviews the score is pulled toward a neutral 3,
  and a confidence level says how much to trust it.
- **Honesty rep**: the share of a reviewer's positions they kept holding at least 7 days after
  reviewing.

## Profiles (PrismProfiles)

`contracts/contracts/PrismProfiles.sol`, deployed for the first PRISM and kept: one optional
public profile per address with a unique username (3–20 characters of `a–z 0–9 _`, first come
first served), a one-line bio of up to 120 bytes and an unverified X handle. No owner, admin,
fees or upgrades. Its avatar field points at legacy crystals and is ignored: every avatar is a
pattern generated from the address (`packages/core/src/identicon.ts`).

In the app, `/profile` is your profile; `/u/<name>` and `/u/<address>` are shareable public
ones. **Edit profile** is in the wallet menu. The app refuses impersonation-prone words and basic
profanity in names and bios; that is a UI check only (see `contracts/SECURITY.md`).

## Deployed contracts

On Robinhood Chain Testnet (46630), deployed from the owner's wallet via `/deploy`, with source
verified on the explorer:

| Contract | Address | Block |
| --- | --- | --- |
| PrismProfiles | [`0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300`](https://explorer.testnet.chain.robinhood.com/address/0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300#code) | 128964290 |
| PrismCrystal (legacy) | [`0x59ce49dE3782FA87E94850b23FEB1457009f9f40`](https://explorer.testnet.chain.robinhood.com/address/0x59ce49dE3782FA87E94850b23FEB1457009f9f40#code) | 128575215 |
| PrismForgeRouter (legacy) | [`0xD1340ad67A4b5C0995CC050bE773ee74293fD24D`](https://explorer.testnet.chain.robinhood.com/address/0xD1340ad67A4b5C0995CC050bE773ee74293fD24D#code) | 128964670 |

## Wallet

- **Log in with Privy** (`apps/web/src/wallet`): email, Google, X or a wallet (MetaMask, Rabby, …).
  Anyone without a wallet gets an embedded one on first login, on Robinhood Chain Testnet only
  (custom chain 46630). CONNECT opens Privy's login, themed like PRISM (`PRIVY_CONFIG`).
- Every transaction goes through `useTxSteps`: a browser wallet signs it in its own window; an
  embedded wallet shows Privy's confirmation screen with PRISM's plain description of what it does.
- The wallet menu shows how you signed in, and for an embedded wallet **Export private key**,
  which opens Privy's own export screen (PRISM never sees the key). Wallets with 0 test ETH get a
  note with their address and the [Robinhood Chain faucet](https://faucet.testnet.chain.robinhood.com).
- `VITE_PRIVY_APP_ID` (public, client-side only) turns Privy on; it's set in Vercel's environment
  variables. Without it the app falls back to browser wallets only. For local dev, put it in
  `apps/web/.env.local` (git-ignored). The App Secret is never used.
- viem is pinned to 2.56.5, the exact version `@privy-io/react-auth` and `@privy-io/wagmi` require.
- PRISM never asks for or stores keys. `/deploy` (dev server only, not in the nav) deploys
  contracts from your own wallet.

## Hosting (Vercel)

`vercel.json` at the repo root: `npm ci` at the root (npm workspaces, so `@prism/core` is
linked), `npm run build`, output `apps/web/dist`, and a catch-all rewrite to `index.html`. One
environment variable: `VITE_PRIVY_APP_ID`.

`npm run build` also writes Vercel's Build Output (`.vercel/output`): the static site plus one
Node function per route in `apps/web/server/routes.json`, each bundled with esbuild so
`packages/core` works on the server exactly as in the browser. Any other `/api/*` path returns a
JSON 404. In `npm run dev`, Vite serves the same routes with an in-memory cache standing in for
the CDN.

```bash
npm run build && npm run serve:dist -w @prism/web   # http://localhost:4173
```

## vibe vibers

vibe/vibe's "vibe vibers" characters appear in PRISM **with permission** from the vibe/vibe
team (Telegram, 2026-10-04). Only official images are used, shown as-is, loaded from vibe/vibe's
own site (`https://testnet.vibevibe.fun/vibers/collection/<file>-480.webp`, the collection listed
on https://testnet.vibevibe.fun/vibe-vibers). Nothing is redrawn, recoloured, cropped or generated.

vibe vibers images are © vibe/vibe and featured with the team's permission (Telegram, 2026-10-04).

## Data: what is real

- **Test stocks** (`packages/core/src/tokens.ts`): the vibe/vibe Discover test stocks (NVDA,
  SPCX, AAPL) and pre-IPO test assets (OPENAI, ANTHROPIC). All are test assets with no value.
  Each address cites its source and passed on-chain `name/symbol/decimals/totalSupply` checks.
- **vibe/vibe data comes from the chain**, never from vibe/vibe's API.
- **No mock data anywhere.** A test (`apps/web/test/no-mock-imports.test.ts`) fails if app code
  imports a mock/sample module.

Testnet only, no real funds.
