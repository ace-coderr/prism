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
npm run video:render     # re-render the explainer videos + poster (each video < 8 MB, sync-checked)
npm run brand            # favicons, share card (og.jpg), X profile picture + banner (public/brand/x)
npm run brand brand/x    # only the X images
```

## Forge from ETH (PrismForgeRouter)

`contracts/contracts/PrismForgeRouter.sol` turns ETH into a crystal in **one transaction**: it
swaps ETH into the chosen test stocks through their Uniswap V4 pools (ETH-paired, 0.3%, no hooks,
straight through the PoolManager), checks every output against the caller's minimum, forges a
PrismCrystal with exactly those amounts (plus any ETH kept as ETH) and hands the NFT to the
caller. No owner, no fees, no pause, no upgrades, no storage; it only accepts the five test
stocks fixed at deploy and ends every call holding nothing. See `contracts/SECURITY.md`.

```bash
npm run test:contracts                     # unit tests (mock PoolManager)
npm run test:fork -w @prism/contracts      # real swaps on a fork of the testnet's latest block
```

In the app, Forge → **Start with ETH** (the default once the router is deployed): one ETH
amount, a slider per stock (plus "keep as ETH"), live V4Quoter quotes, price impact with a
plain warning above 3%, slippage 1% by default (3% when ANTHROPIC or OPENAI is picked: their
pools are thin and move fast; a note says so and it can still be changed). The router is
deployed and verified at `0xD1340ad67A4b5C0995CC050bE773ee74293fD24D` (see below).

The test-stock pools trade every few seconds and the thin pre-IPO ones (ANTHROPIC, OPENAI) can
jump several percent between two swaps, so **Swap & forge** quotes again the moment it's pressed.
If a fresh quote is still above the minimum on screen, it sends with the full slippage counted
from that fresh quote. If not, nothing is sent and the screen shows the new amounts. Every
router and crystal error is shown as a plain sentence ("ANTHROPIC's price moved more than 1%
since your quote…"), including for a transaction that fails on-chain, which is replayed at its
block to read the reason. Fork test: `contracts/test/fork/ForgeFromEthSlippage.fork.test.ts`.
V4 addresses (PoolManager, V4Quoter, Universal Router, Permit2) come from vibe/vibe's published
config for chain 46630 and were checked on-chain.

## Profiles (PrismProfiles)

`contracts/contracts/PrismProfiles.sol`: one optional public profile per address, with:

- a username: 3–20 characters of `a–z 0–9 _`, unique, first come first served; renaming frees the old one;
- one of your crystals as avatar: checked when set, and only shown while you still own it;
- a one-line bio of up to 120 bytes;
- an X handle, which is unverified.

`setProfile` saves several fields in one transaction, and `multicall` also clears removed ones.
No owner, admin, fees or upgrades.

In the app:

- `/profile` is your profile; `/u/<name>` and `/u/<address>` are shareable public ones.
- Each profile has a 3D avatar (your crystal, or a voxel gem generated from your address), stats, badges, your crystals and an activity feed.
- Stats, badges and activity all come from PrismCrystal's own events; no extra contract is needed for them.
- **Edit profile** is in the wallet menu, and owners appear as avatar + `@name` across Gallery, My Crystals and Agent.
- The app refuses impersonation-prone words (`prism` in usernames only) and basic profanity in names and bios. That is a UI check only (see `contracts/SECURITY.md`).
- Deployed and verified at `0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300`.

## Gifts (no new contract)

My Crystals → **Gift** sends a crystal with the existing PrismCrystal functions:

- **To:** an `@username` (looked up on PrismProfiles) or a `0x` address; your own wallet and the zero address are refused.
- **Note (optional, ≤ 140 characters):** sent as the `data` of `safeTransferFrom(from, to, id, data)`, UTF-8. ERC-721 neither stores nor emits it, so the app reads it back from the gift transaction's input (also when wrapped by a smart-contract wallet). Notes are public.
- **Opens on (optional):** `seal(id, unlockTime)` runs first, while it is still yours (Seal 1/2 → Send 2/2). A seal can't be shortened, by anyone.
- Received gifts sit in ice in My Crystals ("Gift from @name", the note, "Opens in 3d 4h"). Once open, **Unwrap** cracks, thaws and shatters the ice. Which gifts you unwrapped is kept in your browser only; without storage they simply show unwrapped.
- `/gift/<id>` is the shareable gift page, and "Share on X" appears after sending.
- Tests: `packages/core/test/gifts.test.ts`, plus `contracts/test/fork/PrismGift.fork.test.ts` (seal + send with a note on a fork of the testnet, read back with the app's reader).

## Gift links (PrismGiftLinks)

Send a crystal to anyone as a link, even someone with no wallet and no test ETH:

- **My Crystals → Gift → Send as a link.** Your browser makes a one-time claim key. The crystal goes
  into `PrismGiftLinks` with one `safeTransferFrom(you, giftLinks, id, abi.encode(claimKey, expiry, note))`
  (sealed first if you pick an opening date), then a little test ETH (0.0005 by default) goes to the
  claim key so the claim can pay its own fee. You get `prism-crystal.vercel.app/claim/<id>#k=<key>`
  with Copy, Share on X and a QR code.
- **The key lives only in the URL fragment** (`#k=…`), which browsers never send to a server, and in
  your browser's storage (to show the link again, or take the crystal and the gas money back).
  **Anyone with the link can claim the crystal**: share it privately, or post it as a giveaway.
- **`/claim/<id>`** shows the crystal in ice, the note and who it's from. "Claim with email or wallet"
  logs in with Privy, then the claim key sends `claim(id, yourAddress)` and the key's leftover ETH goes to
  you. States: claimed (by whom), cancelled, expired, missing or wrong key, sealed (claim now, opens later).
- **My gift links** (My Crystals) shows each link: waiting, claimed by @name, cancelled or expired, with
  Copy link and Cancel. A claimed link counts toward the Gifter badge, and the recipient's profile says
  "Joined via a gift from @name".
- Contract: no owner, no admin, no fees, no upgrades; only the claim key can claim, only the sender can
  cancel (any time before it's claimed). See `contracts/SECURITY.md`. Tests:
  `contracts/test/PrismGiftLinks.test.ts`, `contracts/test/fork/PrismGiftLinks.fork.test.ts`,
  `packages/core/test/giftLinks.test.ts`. Deploy it from `/deploy`, then add `giftLinks`,
  `giftLinksTx` and `giftLinksFromBlock` to `packages/core/src/deployments.ts`.

## Replays

`/replay/<id>` (and **▶ Replay** on My Crystals, the Gallery, profiles and gift pages) plays a crystal's life as an 8–15 s time-lapse built from real data: its on-chain events and the price history from the forge block to now (the last 48 h, or back to the forge block when it's newer; history reaches back about 14 days).

- **Timeline:** `buildReplay` in `packages/core/src/replay.ts` is pure: what it held at each moment (from the amounts in its Forged/Added/Withdrawn events), its value in ETH, the real drops (≥ 5 % from a peak: a crack) and when they recovered (healed in gold), and for gifts the seal, the gift (ice) and the unwrap. Tests: `packages/core/test/replay.test.ts`.
- **Scene:** the crystal morphs between keyframes, cracks and gold seams fade in and out, gifts get the ice shell and shatter at the unwrap; a 2D overlay adds the date/time ticker, the value line, captions and the end card (crystal #, owner, "A stock basket you can hold", prism-crystal.vercel.app).
- **Download video:** made in the browser. Where WebCodecs can encode H.264 + AAC (Chrome, Edge, Safari) every frame is rendered at an exact 1/30 s step and muxed with [Mediabunny](https://mediabunny.dev) (loaded only on download) into an MP4 with the index at the front, so a slow device takes longer but never drops frames. The sound is the same WebAudio synth rendered offline. Elsewhere it falls back to recording the canvas in real time with MediaRecorder (MP4 if supported, else WebM, with a note). 1080×1080 by default, 1920×1080 with **Wide 16:9**.
- Checked on crystal #2: H.264 High, 30 fps, 14.3 s, AAC-LC 48 kHz stereo, 8.6 MB square / 10.7 MB wide, plays in Chrome; inside X's limits (≤ 512 MB, ≤ 140 s, H.264/AAC).
- **Share on X** posts the replay link; X links can't carry a video, so download it and attach it to the post.
- Reduced motion: nothing plays by itself; it rests on the end card until you press Play.

## Explainer video

`apps/video` is a Remotion project (React + TypeScript) that reuses `buildCrystal` from
`packages/core`, the voxel look, the palette and the fonts (Space Grotesk, Space Mono; SIL OFL,
in `apps/video/public/fonts`). Short captions over a quiet original soundtrack (see below). The crystal in
the video is an illustrative basket of the six supported assets (it explains the idea; the
live data is on the site). The end card shows one official vibe viber, loaded as-is from
vibe/vibe's site, with a small credit. `npm run video:render` writes:

| File | Format | Size |
| --- | --- | --- |
| `prism-explainer.mp4` | 1920×1080, H.264 + AAC 128 kb/s (Home section 04) | 2.87 MB |
| `prism-explainer.webm` | 1920×1080, VP9 + Opus 96 kb/s (Home section 04) | 3.66 MB |
| `prism-explainer-poster.jpg` | poster frame | 0.07 MB |
| `prism-explainer-square.mp4` | 1080×1080, H.264 + AAC 128 kb/s (for X) | 2.61 MB |

**Sound, made in code.** `apps/video/scripts/soundtrack.ts` synthesises the whole soundtrack.
It uses oscillators, filtered noise, a small reverb and delay, and deterministic noise; there
are no samples or outside tracks, so no licensing to worry about. It writes
`apps/video/public/audio/soundtrack.wav`, 48 kHz stereo, 40 s; this is generated, not committed.

- **Music:** A minor at 96 BPM, so 16 bars fill exactly 40 s. A dark pad opens, an arpeggio
  joins at the token cards, and kick, hats and a riser build through the Forge scene. At the
  market drop the beat stops and the harmony turns tense; it lifts into warm F major as gold
  fills the crack, and lands on a clean C major chord at the call to action. The bed sits at
  about −27 dBFS RMS so the captions stay the focus.
- **Effects:** every one is placed from the same timeline the picture uses (`src/timeline.ts`,
  `src/shape.ts`), so it lands on its frame. Whooshes for the token cards and the gift flight;
  a click as each visible cube locks in, plus a final snap; a low crack at the drop; a rising
  chime as gold fills the seam; an icy shimmer as frost wraps the crystal; a tick per trust line.
- **Voiceover later:** drop `apps/video/voiceover.mp3` (starting at 0:00) and re-render. It is
  mixed on top and the music ducks about 10 dB under it.

`npm run video:audio` regenerates the WAV, and it also runs before `video:studio` and
`video:render`. Rendering encodes AAC 128 kb/s (MP4) or Opus 96 kb/s (WebM), keeps each file
under 8 MB, and finishes with `scripts/check-sync.mjs`. That script cross-correlates each
file's audio with the WAV around every effect and fails if anything drifts by a frame
(33 ms) or more.

On Home the player autoplays muted while in view (not under reduced motion) and has its own
control bar. It has play/pause, a progress bar you can click or drag, scene markers
(Hook, Pick, Forge, Read it, Gold seams, Gift, Trust, Start) that show their name on hover
and jump on click, the time, a sound on/off button (the choice is remembered for the browser
session; autoplay always starts muted and unmutes at the next tap or key press), and fullscreen. With a mouse the bar fades in on hover and
while paused; on touch screens it is always shown. Keyboard: Space plays and pauses,
←/→ skip 5 s, M toggles sound and F toggles fullscreen. The scene times live in
`apps/web/src/components/ExplainerVideo.tsx` (`SCENES`); keep them in step with
`apps/video/src/Explainer.tsx`.

## Deployed contracts

All on Robinhood Chain Testnet (46630), deployed from the owner's wallet via `/deploy`, with source verified on the explorer:

| Contract | Address | Block |
| --- | --- | --- |
| PrismCrystal | [`0x59ce49dE3782FA87E94850b23FEB1457009f9f40`](https://explorer.testnet.chain.robinhood.com/address/0x59ce49dE3782FA87E94850b23FEB1457009f9f40#code) | 128575215 |
| PrismForgeRouter | [`0xD1340ad67A4b5C0995CC050bE773ee74293fD24D`](https://explorer.testnet.chain.robinhood.com/address/0xD1340ad67A4b5C0995CC050bE773ee74293fD24D#code) | 128964670 |
| PrismProfiles | [`0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300`](https://explorer.testnet.chain.robinhood.com/address/0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300#code) | 128964290 |

`npx tsx packages/core/scripts/check-deployment.ts` re-checks, read-only, that each contract's
on-chain code matches this repo's compiled contract byte for byte. It also checks that each
creation transaction was exactly the compiled bytecode plus the expected constructor arguments
(the router's PoolManager, PrismCrystal, five test stocks, fee 3000 and tick spacing 60; the
profiles' PrismCrystal).

## Wallet + contract

- **Log in with Privy** (`apps/web/src/wallet`): email, Google, X or a wallet (MetaMask, Rabby, …).
  Anyone without a wallet gets an embedded one on first login, on Robinhood Chain Testnet only
  (custom chain 46630, RPC `https://rpc.testnet.chain.robinhood.com`, explorer
  `https://explorer.testnet.chain.robinhood.com`). CONNECT opens Privy's login, themed like PRISM
  (`PRIVY_CONFIG`: panel background, lime accent, `public/brand/privy-logo.png`).
- Every transaction goes through `useTxSteps`: a browser wallet signs it in its own window as before;
  an embedded wallet shows Privy's confirmation screen with PRISM's plain description of what it
  does ("Swap 0.02 ETH into AAPL, NVDA … and forge your crystal").
- The wallet menu shows how you signed in (email / Google / X / wallet), and for an embedded wallet
  **Export private key**, which opens Privy's own export screen (an iframe on Privy's domain: PRISM
  never sees the key). New wallets with 0 test ETH get a note with their address and the
  [Robinhood Chain faucet](https://faucet.testnet.chain.robinhood.com).
- `VITE_PRIVY_APP_ID` (public, client-side only) turns Privy on; it's set in Vercel's environment
  variables. Without it the app falls back to browser wallets only. For local dev, put
  `VITE_PRIVY_APP_ID=…` in `apps/web/.env.local` (git-ignored). The App Secret is never used.
- viem is pinned to 2.56.5, the exact version `@privy-io/react-auth` and `@privy-io/wagmi` require.
- PRISM never asks for or stores keys.
- `/deploy` (dev server only, not in the nav) deploys `PrismCrystal` from your wallet. The address goes in
  `packages/core/src/deployments.ts`; then Forge and My Crystals switch to real on-chain mode.

## Hosting (Vercel)

`vercel.json` at the repo root does the work: `npm ci` at the root (npm workspaces, so
`@prism/core` is linked), `npm run build` (builds `apps/web`), output `apps/web/dist`, and a
catch-all rewrite to `index.html` so routes like `/forge` survive a refresh. One environment
variable: `VITE_PRIVY_APP_ID` (Privy login, see above). The one-time `/deploy` page exists only
on the dev server.

Check a production build locally with the same rewrite behaviour:

```bash
npm run build && npm run serve:dist -w @prism/web   # http://localhost:4173
```


**Instant first load.** `GET /api/snapshot` (source: `apps/web/server/snapshot.ts`, logic in
`packages/core/src/snapshot.ts`) reads the chain server-side (public RPC, read-only, batches ≤ 20)
and returns everything the first screen needs: prices, 24h moves, the live basket's cracks and seams,
every crystal (with its own seams) and the live stats, in ~3 KB. It is cached by Vercel's CDN
(`s-maxage=300, stale-while-revalidate=86400`: fresh for 5 minutes, then served stale for up to a
day while it refreshes in the background). Any other `/api/*` path returns a JSON 404. Pages render from it at once, show an assembling
crystal while anything loads, and refresh live in the background. `npm run build` also writes
Vercel's Build Output (`.vercel/output`: the static site + the function bundled with esbuild); in
`npm run dev`, Vite serves the same route with a 5-minute in-memory cache.
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
- **Colours:** every asset keeps its own shade in every crystal (`packages/core/src/shades.ts`):
  a green-family shade when it is up today (lime-green, emerald, teal-green, mint, deep
  forest, …), a red-family shade when it is down (crimson, brick, coral, rose, maroon, …),
  and its own grey without a price. Each shade has a fixed lightness, so holdings stay apart
  even when they all moved the same way; a bigger move only makes the colour more vivid. A
  dark seam runs wherever one holding meets another, hovering or tapping a holding names it
  ("NVDA · 40% · +28.6% today"), and a row of colour dots sits under every thumbnail.

Testnet only, no real funds.
