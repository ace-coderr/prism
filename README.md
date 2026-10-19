# PRISM

**See every launch's true colors.** https://seeprism.xyz · [@holdprism](https://x.com/holdprism)

PRISM is a review site for [vibe/vibe](https://testnet.vibevibe.fun) launches (and vibe/vibe's test
stocks) on Robinhood Chain Testnet, where reviews can't lie:

- **Only holders can review.** The review contract checks your balance when you post.
- **Your position is shown.** Each review records how much you held, as an amount and a share of supply.
- **Sell, and it says SOLD.** If a reviewer holds less than half of the most they've held since
  their first review of the token, anyone can mark the review SOLD, for good. Moving tokens out of
  your wallet (to another wallet, a pool, staking or an exchange) counts as selling, and selling
  below half then buying back still shows SOLD in the app. Smaller sales show as "trimmed X%".
  Reviews can't be deleted or edited, only replaced by a newer one (the old one stays visible).
- **True colors.** Each token's score counts only reviewers who are still holding, weighted by
  position (no wallet over 10% once 10 or more count), holding time and honesty rep. It shows once 3
  holders have reviewed. The creator's own review and positions worth under $1 show, labelled, but
  don't count; reviews of tokens PRISM doesn't list don't appear.
- **Honesty rep.** The share of a reviewer's positions they kept for at least 7 days after reviewing.
- **Launch X-ray.** Every launch gets a plain read of its own chain history, whether or not anyone
  has reviewed it: what the creator bought, holds and sold, how concentrated the holders are, what
  the first buyers did, how the holder count moved in a day, the tax, and its age. Facts with the
  numbers behind them, each linking to the address or block they were read from. It states facts and
  never advises: no buy / sell / avoid wording and no risk score. It can't know who is behind a
  wallet, whether one person holds several, or what happens off-chain; anything it couldn't read
  says so instead of guessing, and a time worked out from the block rate is marked `approx`.

Test assets only, no real value.

## How it works

| Page | What's there |
| --- | --- |
| `/` | Search (name, $SYMBOL or address), how it works, live feeds: latest reviews, caught selling, top launches, top honest reviewers. The living gem: a 3D cut gem whose facets are the latest real reviews (colored by rating, sized by position, grey and cracked once SOLD; point at one to see who said what), clear glass until the first review, and a still picture on slow devices or with reduced motion. |
| `/t/<address>` | A launch or test stock: its picture, name, $SYMBOL, pair, on curve or graduated, creator and date; **market cap · holders · 24h volume · 24h change · progress**; the creator's description and links; **Launch X-ray** (what the chain says, no reviews needed); **how it's set up** (read from its contracts), true colors, reviews (Holding · Trimmed · SOLD · All), "Make it permanent" on unmarked sales, Buy on vibe/vibe, share and a creator kit (live badge, "Ask my holders to review"). |
| `/search?q=` | Every match with its picture, pair, status, market cap, holders and PRISM's reviews and score (the search box shows the top 8 the same way). |
| `/t/<address>/review` | Write or update a review: login, holder check, rating + 280 bytes of text, a preview of exactly what's recorded, one transaction, then Share on X. |
| `/r/<id>` | One review, shareable (with its own share image). |
| `/u/<name or address>` | Honesty rep, counts, badges (First review, Truth keeper, Held 30 days, Early reviewer), reviews. Edit profile sets your PrismProfiles username. |
| `/leaderboards` | Launches (true colors, 3+ holders), reviewers (honesty rep, once 3+ positions are decided, ranked by (kept + 1) / (decided + 2)), truth keepers. |
| `/stocks` | The five test stocks, their reviews, and the launches paired with each. |
| `/legacy` | PRISM v1 crystal holders: see what's inside and "Empty & burn" to get it all back in one transaction. |

Old v1 links (`/forge`, `/my-crystals`, `/gift/…`, `/replay/…`, `/claim/…`) show a short "PRISM v1
has been archived" note. v1 is archived on the
[`archive/crystal-v1`](https://github.com/ace-coderr/prism/tree/archive/crystal-v1) branch and the
[`crystal-v1`](https://github.com/ace-coderr/prism/releases/tag/crystal-v1) tag.

## Trust model

- **PRISM never holds your money.** No contract or server ever takes custody of anyone's funds.
  PrismReviews stores reviews only: nothing in it is payable, it refuses ETH, and it only *reads*
  balances (view calls). Posting needs a little test ETH for gas, paid to the network.
- **No admin.** No owner, no pause, no upgrades, no fees. Nobody, including PRISM, can edit or
  delete a review or undo a SOLD mark.
- **Reviews are permanent** and public, on-chain.
- **Known limits** (see `contracts/SECURITY.md`): SOLD on-chain needs someone to call `markSold`
  (the site shows sold reviews from live balances in the meantime, and anyone can make them
  permanent); a wallet that sells below half and buys back before anyone checks can't be marked
  on-chain, so the site replays its transfers and shows it SOLD anyway; balances are per wallet, so
  one person can use several (positions under $1 don't count).
- vibe/vibe data comes **from the chain only** (their launch contracts' events and views), never
  from vibe/vibe's API.

## Contracts (Robinhood Chain Testnet, 46630)

Deployed from the owner's browser wallet via the dev-only `/deploy` page, source verified:

| Contract | Address |
| --- | --- |
| PrismReviews (v2) | [`0x9e05AF8cbAC4877CAC1B0Ef089b7e023fFB23B40`](https://explorer.testnet.chain.robinhood.com/address/0x9e05AF8cbAC4877CAC1B0Ef089b7e023fFB23B40#code) (block 138031161) |
| PrismReviews (v1, retired) | [`0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3`](https://explorer.testnet.chain.robinhood.com/address/0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3#code) (block 132977970): its reviews show as history and never count |
| PrismProfiles | [`0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300`](https://explorer.testnet.chain.robinhood.com/address/0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300#code) (usernames) |
| PrismCrystal (v1, legacy) | [`0x59ce49dE3782FA87E94850b23FEB1457009f9f40`](https://explorer.testnet.chain.robinhood.com/address/0x59ce49dE3782FA87E94850b23FEB1457009f9f40#code) (only `/legacy` uses it) |
| PrismForgeRouter (v1, legacy) | [`0xD1340ad67A4b5C0995CC050bE773ee74293fD24D`](https://explorer.testnet.chain.robinhood.com/address/0xD1340ad67A4b5C0995CC050bE773ee74293fD24D#code) |

`npx tsx packages/core/scripts/check-deployment.ts` re-checks, read-only, that PrismReviews' creation
transaction and on-chain code match this repo's compiled contract byte for byte.

## Token pictures, descriptions and market data

All read from the chain and the token's own IPFS metadata, never from vibe/vibe's API:

- **Metadata:** every launch event (all four factory generations) carries an `ipfs://` URI; gen 0/1/2
  events also carry keccak256 of the file. `/api/meta` reads the event, asks Pinata, Filebase,
  ipfs.io and dweb.link at once and keeps the first file whose SHA-256 equals the raw CID (and, for
  gen 0/1/2, whose keccak256 equals the event's digest). A launch's metadata never changes, so final
  answers are kept for good: each scheduled run (`packages/core/scripts/cache-metadata.ts`) reads
  a few hundred more launches, newest first, gently (one gateway per file unless it's slow), and
  publishes them all as `launch-meta.json.gz` next to the launch index. `/api/meta` answers from
  that, then from what it has read itself, and only asks IPFS about launches neither has;
  "unavailable" means PRISM has never managed to read the file. Pictures
  (`/img/t/<address>.png?s=96`) are checked the same way, decoded (WebP via libwebp, others via
  resvg), centre-cropped, resized and cached as immutable (a month in browsers, a year on the CDN;
  a deploy clears the CDN); no picture or a broken one shows the identicon. `TOKEN_HIDE` in `packages/core/src/site.ts` hides a
  token's picture and description if ever needed. After each index build the scheduled job warms
  the picture cache (`packages/core/scripts/warm-pictures.ts`): the newest 500 launches, the 300
  most traded on their curves in the last 24h, the 200 most recently graduated, every reviewed token
  and the test stocks.
- **Market (`/api/market`):** on a curve, vibe/vibe's own maths from the curve's state (v6:
  80·T·S²/(16·S − 15·sold)², progress = raised / target; gen 0/1/2: `fdvWei`, ETH raised / graduation
  target); graduated launches and test stocks, the Uniswap V4 pool (price, market cap = price ×
  supply, liquidity). 24h volume, buys and sells from the curve's trade events and the pool's swaps;
  the 24h change is exact on a curve (its state 24h ago is rebuilt from the trades since). Holders are
  every address holding some, from all Transfer events, minus the curve, the pool manager, the token
  itself (its reward pool) and burn addresses. Dollar figures are ETH × the real ETH price from
  Chainlink's ETH / USD feed on Robinhood Chain mainnet (`0x78F3…d3A9`, from Chainlink's feed
  directory: https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json), read with
  eth_call and cached for 5 minutes; a stale or missing price hides them.
  Cached for a few minutes.

## vibe/vibe referral

"Buy on vibe/vibe" links carry PRISM's vibe/vibe invite (never for PRISM's own wallet); it's set in `VIBE_REFERRAL` in `packages/core/src/site.ts`.

## The launch index

Every vibe/vibe launch (~220k across four factory generations, plus the five test stocks) is read
from vibe/vibe's launch contracts (`packages/core/src/launches.ts`):

| Generation | Factory | Launch event | Graduation |
| --- | --- | --- | --- |
| gen 0 | `0x4FEb…91dF` (block 95,916,239) | `TokenLaunched` (ETH) | `PoolGraduated` from adapter `0x1fD0…4e8f` |
| gen 1 | `0xB5B7…9eb9` (block 108,435,450) | `TokenLaunched` (ETH) | `PoolGraduated` from adapter `0x1eD9…501a` |
| gen 2 | `0x40f1…DF59` (block 115,025,604) | `TokenLaunched` (ETH; one stock-paired variant) | `PoolGraduated` from adapter `0xA6a5…7F06` |
| v6 | `0xe794…Fea0` (block 123,503,237) | `LaunchCreated` (ETH, test stocks, USDG or other launches) | each curve's own event |

"How this token is set up" reads each launch's own contracts: v6 project tax, the creator's split
(treasury / holder rewards in the pair asset / in the token / burn, from the token's `packedWeights`),
the fixed 20% protocol share and the graduation airdrop; older generations' fixed curve fee and
creator share ("not available for this launch generation" for the rest).

It stays fresh for free and without secrets: `.github/workflows/launch-index.yml` runs every 30
minutes on GitHub Actions, reads the new blocks and republishes `launches.json.gz` on the
`launch-index` release; the site's API loads it and reads the blocks since.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Vite + React + TypeScript (Tailwind, Motion, three.js for the hero, wagmi + Privy) |
| `apps/web/server` | Vercel functions: `data` (all `/api/*` JSON and `/badge/*.svg`), `og` (share images, resvg), `page` (share tags for `/t/*` and `/r/*`), `img` (token pictures); routes in `server/routes.json` |
| `packages/core` | Pure TS shared by the app, the functions and the scripts: launch index, scoring, reviews, setup, site links (vitest) |
| `contracts` | Hardhat: PrismReviews, PrismProfiles, PrismCrystal (legacy) |

## Run

```bash
npm install
npm test                 # core + web unit tests (offline)
npm run test:contracts   # contract tests
npm run dev              # http://localhost:5173
npm run brand            # regenerate favicons, og.jpg, X avatar/banner, Privy logo
```

```bash
npm run test:fork -w @prism/contracts   # PrismReviews against real tokens on a fork of the testnet
```

Checking the site with reviews in it never uses the real chain: start a local fork
(`FORK=1 npx hardhat node` in `contracts/`), fill it with `npx hardhat run scripts/seed-fork.ts
--network localhost` (it refuses any other network), and point the dev server's functions at it
with `PRISM_RPC_URL=http://127.0.0.1:8545`.

**Hosting (Vercel):** `vercel.json` at the root; one environment variable, `VITE_PRIVY_APP_ID`
(public, client-side). `npm run build` writes Vercel's Build Output with the three functions.

## Wallets

Log in with Privy (email, Google, X or a wallet); anyone without a wallet gets an embedded one. The
wallet menu shows how you signed in and, for embedded wallets, Privy's own key export. PRISM never
asks for or stores keys. Wallets with 0 test ETH get a note with the
[faucet](https://faucet.testnet.chain.robinhood.com).

## vibe vibers

vibe/vibe's "vibe vibers" guide new users through PRISM **with permission** from the vibe/vibe team
(Telegram, 2026-10-04): official images only, shown as-is, loaded from vibe/vibe's own site. vibe
vibers images are © vibe/vibe.
