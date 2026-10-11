# PRISM — Plan

**PRISM: see every launch's true colors.** Holder-only reviews of vibe/vibe launches and test
stocks, with SOLD marks, a true colors score and honesty rep.

Status: **Done** · **In progress** · **Not started**

The first PRISM (crystals) is archived at the `crystal-v1` tag and the `archive/crystal-v1`
branch; its old plan is in `PLAN.md` there.

## Foundation (prompt 1)
- **Done** · Archive the crystal app; placeholder Home so the live site never breaks
- **Done** · Launch index from the chain (every vibe/vibe factory generation + the test stocks), search, live holder checks; refreshed every 30 minutes by a GitHub Action, served by /api/launches
- **Done** · PrismReviews contract (holder-only, permanent reviews, SOLD marks): tested (unit + fork), deployed and verified at 0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3
- **Done** · Scoring: review status, true colors score, honesty rep

## Product (prompt 2)
- **Not started** · Token pages, writing and reading reviews, reviewer profiles

## Non-negotiables
- Never hold people's money: no contract or server ever takes custody of user funds
- No admin keys
- No upgradeable contracts
- vibe/vibe data is read from the chain, not from their API
