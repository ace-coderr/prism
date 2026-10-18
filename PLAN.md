# PRISM — Plan

**See every launch's true colors.** Holder-only reviews of vibe/vibe launches and test stocks, with
SOLD marks, a true colors score and honesty rep.

Status: **Done** · **In progress** · **Not started**

The first PRISM (crystals) is archived at the `crystal-v1` tag and the `archive/crystal-v1` branch.

## Done
- PrismReviews v2: holder-only permanent reviews; SOLD measured from the baseline, the most held since the first review of that run (deployed, verified)
- The first contract's reviews stay readable as retired history
- Anti-gaming: no escaping SOLD by selling in steps; sell below half and buy back still shows SOLD; creator reviews and positions under $1 don't count; only listed tokens count; dust wallets don't outweigh real holders; the honesty board needs 3 decided positions
- Launch index from the chain: four vibe/vibe factory generations + the test stocks, kept fresh by a scheduled job
- Scoring: review status, true colors, honesty rep
- Website at seeprism.xyz: Home (search, live feeds, the living gem), launch pages with on-chain setup, writing reviews, review pages, profiles with badges, leaderboards, stocks
- Growth: share images for launches and reviews, live score badges for creators, share texts
- /legacy: v1 crystal holders empty their crystals in one transaction

## Next
- **Not started** · $PRISM on vibe/vibe: NVDA pair, Product & Utility; reviewed here like any other token
- **Not started** · **Launch X-ray** — a verdict on every launch from day one, with no reviews needed. Plain facts read from the chain on each launch page: whether the creator still holds or dumped and when, how concentrated the top wallets are, how many buyers sold within the hour, how fast the first holders left. It makes all ~226k launches useful immediately, gives people a reason to check a token before buying, and that traffic is what brings the reviews in.
- **Not started** · **Creator promises** — SOLD, but for creators. A creator commits on-chain ("I won't sell for 30 days") and PRISM stamps it KEPT or BROKEN, permanently. No funds are held; the chain checks the promise. Creators share the badge to sell their launch, which brings their holders here: the growth flywheel.

## Later
- **Not started** · Compare two launches side by side before buying
- **Not started** · A public read-only API so other vibe/vibe builders can show PRISM scores
- **Not started** · Follow reviewers, with alerts when one you follow sells
- **Not started** · Creator replies under reviews, from the launch's creator wallet
- **Not started** · Accuracy score: how well a reviewer's ratings matched what happened next
- **Not started** · A portable honesty passport for airdrops and allowlists

## Non-negotiables
- Never hold people's money: no contract or server ever takes custody of user funds
- No admin: no owner keys, no upgrades, no pause
- Reviews are permanent: never edited, never deleted
- vibe/vibe data is read from the chain, not from their API
- No fake activity: no self-reviews, no self-trades, no seeded data on the live testnet
