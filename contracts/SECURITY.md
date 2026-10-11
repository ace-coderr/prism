# PrismReviews — security notes

`contracts/PrismReviews.sol` stores holder-only reviews of tokens. **Status: tested (unit + fork
tests), not audited. Deployed on Robinhood Chain Testnet at
0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3 (block 132977970), source verified on the explorer.**

## Trust model, in plain words

**It holds no money, ever.** Nothing in it is payable and it has no `receive` or `fallback`, so
any ETH sent to it (on its own or with a call) is refused. It never takes, moves or approves
tokens: it only *reads* balances, with `balanceOf` through STATICCALL, so a token can't call back
into it or change anything while it's read. (As with any contract, ETH could still be forced in
by `selfdestruct`; there is no way to take it out, and nothing reads it.)

**There is no admin.** No owner, no pause, no upgrade path (no proxy), no fees, no allow-list, no
"rescue" function. Once deployed, nobody — including whoever deployed it — can change a rule,
edit or delete a review, or undo a SOLD mark.

**The rules, all enforced on-chain:**

- **Holders only.** `post(token, rating, text)` reverts unless the caller holds more than 0 of
  `token` right now. The review stores `heldAtPost`, the caller's balance at that moment. Rating
  is 1–5; text is at most 280 bytes (UTF-8, so emoji count 4) and lives only in the event.
- **One current review per author per token.** Posting again links the new review to the one it
  replaces (`previous`), which stays readable with status `Replaced`. Allowed only while still
  holding, and only `UPDATE_COOLDOWN` (1 hour) after the author's last review of that token (spam
  limit).
- **Reviews are permanent.** There is no delete and no edit; every review and its text stay
  readable forever.
- **The SOLD rule.** `markSold(id)` can be called by anyone. If the author now holds *less than
  half* of `heldAtPost` (exactly half is still holding), the review becomes `Sold` with a
  timestamp and a `ReviewSold` event, permanently. Otherwise it reverts with `StillHolding`. Only
  the author's current review can be marked. An update can't hide a sale either: if the author is
  below half when posting again, the old review is marked SOLD in the same transaction. Smaller
  drops aren't recorded on-chain; the app shows them as "trimmed X%" from live balances.

## Known limitations

- **SOLD is checked, not watched.** Nothing happens until someone calls `markSold`. A reviewer who
  sells and **buys back before anyone checks** keeps an Active review; the app compares live
  balances to `heldAtPost` on every view, so it shows the review as sold or trimmed while the
  balance is low, but only an on-chain `markSold` makes it permanent.
- **Balance, not ownership history.** A holder can move tokens to another wallet they control and
  review from both, or borrow tokens for a moment to post. The review records how much they held,
  so tiny positions carry little weight off-chain, but the contract can't tell people apart.
- **Any ERC-20 can be reviewed.** The contract accepts any address that answers `balanceOf`,
  including a token someone deployed to fake balances. The app only shows reviews of indexed
  vibe/vibe launches and the five test stocks.
- **Tokens decide balances.** A token with a broken or malicious `balanceOf` can make reviews of
  that token wrong (or `markSold` revert); it can't affect reviews of other tokens.
- **Rebasing / fee-on-transfer tokens** change balances on their own; a big negative rebase can
  make a review markable as SOLD without a sale.
- Unaudited. Testnet only.

# PRISM Crystal (legacy) — security notes

`contracts/PrismCrystal.sol` is an ERC-721 where each NFT (a "crystal") holds its own
basket of ERC-20 tokens and ETH. **Status: legacy.** It belongs to the archived crystal app
(tag `crystal-v1`): deployed on testnet at 0x59ce49dE3782FA87E94850b23FEB1457009f9f40, unaudited,
no longer used by the app. It stays in this folder because PrismProfiles' tests deploy it. Owners
keep full control of their crystals and can still withdraw on-chain (e.g. the explorer's Write tab).

## Trust model, in plain words

**There is no admin.** The contract has no owner role, no pause switch, no upgrade path
(no proxy), no fees and no "rescue" or "sweep" function. Once deployed, nobody — including
the PRISM team or the deployer — can change its rules or touch a crystal.

**The crystal's current owner (whoever holds the NFT) can:**
- add more tokens or ETH (`addTo`)
- withdraw some or all of the contents to any address (`withdraw`, `withdrawAllAndBurn`)
- burn the crystal after emptying it (`withdrawAllAndBurn`)
- seal it until a future time, or extend an existing seal (`seal`)
- sell, gift or transfer it like any NFT. **The basket moves with the NFT**: the new owner
  gets full control and the old owner loses all access immediately.

**An approved operator** (ERC-721 `approve` / `setApprovalForAll`, e.g. a marketplace) can
transfer the NFT — and therefore the whole basket — to someone else. It **cannot** withdraw,
add, seal or burn: those require the owner's own address. Only approve operators you trust.

**Nobody else can:**
- withdraw or move any crystal's tokens or ETH
- shorten or remove a seal (not even the owner)
- freeze, pause, confiscate, upgrade or take fees

**Sealed gifts:** while `block.timestamp < sealedUntil`, `withdraw` and `withdrawAllAndBurn`
revert for everyone, including the owner. The seal can be set or extended, never shortened,
and travels with the NFT when it is transferred (that is how a gift is sent). Adding to a
sealed crystal is still allowed. Seals are capped at 100 years to catch typos such as a
millisecond timestamp.

**Accounting:** every deposit records the amount that actually arrived (balance before vs
after), so fee-on-transfer tokens cannot inflate a crystal. `totalRecorded[token]` and
`totalEthRecorded` track the sum across all crystals; tests check that the contract's real
balance is always ≥ that sum. All state-changing entry points are `nonReentrant` and update
state before making external calls.

## Known limitations

1. **Stray funds are stuck forever.** Tokens sent straight to the contract (not via `forge`/
   `addTo`) belong to no crystal, and there is deliberately no rescue function. Plain ETH
   transfers are rejected, but ETH forced in (e.g. via `selfdestruct`) is also unrecoverable.
2. **Tokens that change balances on their own** (rebasing tokens, negative rebases) or that
   can **freeze / blacklist / pause** holders can leave a crystal's recorded balance above what
   the contract can actually send. Withdrawing that token then reverts. Because
   `withdrawAllAndBurn` moves everything in one transaction, one frozen token blocks it; the
   owner can still use `withdraw` for the other assets.
3. **Issuer controls still apply.** Regulated tokens (e.g. Robinhood Stock Tokens) may be
   frozen or restricted by their issuer; a crystal cannot override that.
4. **Fee-on-transfer on the way out:** a crystal records the received amount on deposit, but
   the token may charge again on withdrawal, so the recipient can get less than `amount`.
5. **Metadata trusts token contracts.** `tokenURI` calls each token's `symbol()` and
   `decimals()`. Symbols are sanitized to `[A-Za-z0-9._-]` (max 12 chars) so the JSON stays
   valid, but a hostile token can still make `tokenURI` fail for crystals that hold it.
   Holdings and withdrawals are unaffected.
6. **Max 8 assets per crystal**, and ETH counts as one while its balance is above zero.
   Withdrawing an asset's full balance frees its slot.
7. **Seals are a hard commitment.** If the owner's key is lost or a seal is set too long, there
   is no recovery. Buyers of a sealed crystal can't withdraw until it unlocks, so marketplaces
   should show `sealedUntil`.
8. **Contract recipients:** `forge` uses `_safeMint`, so a contract that calls `forge` must
   implement `onERC721Received`. Withdrawing ETH to a contract that rejects ETH reverts; choose
   `to` accordingly.
9. **No prices on-chain.** The contract knows balances, not values; any valuation is off-chain.
10. **Compiler / chain:** Solidity 0.8.24, optimizer 200 runs, EVM target `cancun`. Confirm the
    target chain (Robinhood Chain Testnet, an Arbitrum Orbit chain) supports the Cancun opcodes
    before deploying, or recompile for an older EVM version.
11. **Unaudited.** Tests cover the cases listed in `test/PrismCrystal.test.ts`, but this is not a
    substitute for a review. Testnet only, no real funds.

---

# PrismProfiles — security notes

`contracts/PrismProfiles.sol` stores optional public profiles, one per address: a username,
a PrismCrystal as avatar, a one-line bio and an X handle.

## Trust model, in plain words

- **No admin.** No owner, no fees, no pause, no upgrades, no reserved names. Only
  `msg.sender` can set or clear its own fields; nobody (not even the deployer) can change,
  take or free someone else's. The only thing fixed at deploy is the PrismCrystal address
  (an immutable) that avatars come from.
- **Names: strict rules on-chain.** 3–20 bytes, each `a–z`, `0–9` or `_` (`isValidName`),
  unique, first come first served. Uppercase, spaces, symbols and any non-ASCII byte are
  rejected, so look-alike Unicode names (homoglyphs) can't be registered. Renaming releases the
  old name in the same call (`NameCleared` then `NameSet`).
- **Avatars only count while owned.** `setAvatar` checks `ownerOf` at set time (a crystal you
  don't own, never minted or burned reverts with `NotCrystalOwner`), and `avatarOf` /
  `profileOf` check ownership again on every read, returning 0 once the crystal is sold,
  gifted or burned. The stored choice is kept, so it shows again if the crystal comes back.
  `ownerOf` is called with try/catch; it's a view call into the fixed PrismCrystal.
- **Bios and handles are bounded.** Bio: 1–120 bytes with no control characters
  (`isValidBio`); the contract doesn't check that the bytes are valid UTF-8, so the app decodes
  defensively and React escapes it on display. X handle: 1–15 of `a–z A–Z 0–9 _` — a handle,
  never a URL, so it can't smuggle a link.
- **`setProfile` and `multicall`.** `setProfile` updates several fields at once (empty values
  leave a field unchanged) and reverts as a whole if any value is invalid. `multicall` is
  OpenZeppelin's (delegatecall to itself only, `msg.sender` preserved, not payable), so the
  app can save new values and clear removed ones in one transaction.

## Known limitations

1. **The blocklist is UI-only.** The app refuses usernames containing `vibevibe`,
   `vibe_vibe`, `prism`, `admin`, `official` or `robinhood`, and bios containing any of those
   except `prism` (ignoring case and separators), plus a basic profanity list in both
   (`packages/core/src/profiles.ts`), before sending. The contract
   has no blocklist (that would need an admin or a hard-coded list), so anyone calling it
   directly can still set such a name or bio. Treat a username as a nickname, never as proof of
   identity; the app always shows the address in the tooltip and on the profile page.
2. **X handles are unverified.** Anyone can type any handle, including a famous account's.
   The app labels it "unverified" and links to `x.com/<handle>` with `rel="nofollow noopener"`.
3. **Squatting.** Names are first come, first served, with no fee or expiry.
4. **Front-running.** A pending `setName` / `setProfile` is visible in the mempool; someone
   could claim the same name first. The transaction then reverts with `NameTaken` and nothing
   is lost but gas.
5. **Avatar reads cost a call.** `profileOf` makes one `ownerOf` call per read; fine for a view.
6. **Unaudited.** Tests in `test/PrismProfiles.test.ts`. Testnet only.
