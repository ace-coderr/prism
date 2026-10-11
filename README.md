# PRISM

**See every launch's true colors.** https://seeprism.vercel.app · [@holdprism](https://x.com/holdprism)

PRISM is a review site for [vibe/vibe](https://testnet.vibevibe.fun) launches (and vibe/vibe's test
stocks) on Robinhood Chain Testnet, where reviews can't lie:

- **Only holders can review.** The review contract checks your balance when you post.
- **Your position is shown.** Each review records how much you held, as an amount and a share of supply.
- **Sell, and it says SOLD.** If a reviewer later holds less than half of what they reviewed with,
  anyone can mark the review SOLD, for good. Smaller sales show as "trimmed X%". Reviews can't be
  deleted or edited, only replaced by a newer one (the old one stays visible).
- **True colors.** Each token's score counts only reviewers who are still holding, weighted by
  position (no wallet over 10%), holding time and honesty rep. It shows once 3 holders have reviewed.
- **Honesty rep.** The share of a reviewer's positions they kept for at least 7 days after reviewing.

Test assets only, no real value.

## How it works

| Page | What's there |
| --- | --- |
| `/` | Search (name, $SYMBOL or address), how it works, live feeds: latest reviews, caught selling, top launches, top honest reviewers. A 3D prism whose light follows live sentiment and clouds over as reviewers sell (a still picture on slow devices). |
| `/t/<address>` | A launch or test stock: pair, on curve (with bonding progress) or graduated, creator and date, **how it's set up** (read from its contracts), true colors, reviews (Holding · Trimmed · SOLD · All), "Make it permanent" on unmarked sales, Buy on vibe/vibe, share and a creator kit (live badge, "Ask my holders to review"). |
| `/t/<address>/review` | Write or update a review: login, holder check, rating + 280 bytes of text, a preview of exactly what's recorded, one transaction, then Share on X. |
| `/r/<id>` | One review, shareable (with its own share image). |
| `/u/<name or address>` | Honesty rep, counts, badges (First review, Truth keeper, Held 30 days, Early reviewer), reviews. Edit profile sets your PrismProfiles username. |
| `/leaderboards` | Launches (true colors, 3+ holders), reviewers (honesty rep, 3+ reviews), truth keepers. |
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
- **Known limits** (see `contracts/SECURITY.md`): SOLD needs someone to call `markSold` (the site
  shows sold reviews from live balances in the meantime, and anyone can make them permanent); a
  wallet can sell and buy back between checks; balances are per wallet, so one person can use several.
- vibe/vibe data comes **from the chain only** (their launch contracts' events and views), never
  from vibe/vibe's API.

## Contracts (Robinhood Chain Testnet, 46630)

Deployed from the owner's browser wallet via the dev-only `/deploy` page, source verified:

| Contract | Address |
| --- | --- |
| PrismReviews | [`0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3`](https://explorer.testnet.chain.robinhood.com/address/0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3#code) (block 132977970) |
| PrismProfiles | [`0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300`](https://explorer.testnet.chain.robinhood.com/address/0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300#code) (usernames) |
| PrismCrystal (v1, legacy) | [`0x59ce49dE3782FA87E94850b23FEB1457009f9f40`](https://explorer.testnet.chain.robinhood.com/address/0x59ce49dE3782FA87E94850b23FEB1457009f9f40#code) (only `/legacy` uses it) |
| PrismForgeRouter (v1, legacy) | [`0xD1340ad67A4b5C0995CC050bE773ee74293fD24D`](https://explorer.testnet.chain.robinhood.com/address/0xD1340ad67A4b5C0995CC050bE773ee74293fD24D#code) |

`npx tsx packages/core/scripts/check-deployment.ts` re-checks, read-only, that PrismReviews' creation
transaction and on-chain code match this repo's compiled contract byte for byte.

## vibe/vibe referral (disclosure)

"Buy on vibe/vibe" links include PRISM's vibe/vibe invite (`ref=_ace_won`,
`refWallet=VV1-ETAM4H6SGFH3U6ESHPQCRJEPTJ87WL92`), and the footer links PRISM's invite to vibe/vibe.
vibe/vibe's web app reads these parameters on every page, token pages included (its referral handler
wraps all of its routes). Every such link says "vibe/vibe links include PRISM's invite." The invite
is never added for PRISM's own wallet. The settings live in one place: `VIBE_REFERRAL` in
`packages/core/src/site.ts`.

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
| `apps/web/server` | Vercel functions: `data` (all `/api/*` JSON and `/badge/*.svg`), `og` (share images, resvg), `page` (share tags for `/t/*` and `/r/*`); routes in `server/routes.json` |
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
