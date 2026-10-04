# PRISM Crystal — security notes

`contracts/PrismCrystal.sol` is an ERC-721 where each NFT (a "crystal") holds its own
basket of ERC-20 tokens and ETH. **Status: unaudited, not deployed, testnet only.**

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

# PrismForgeRouter — security notes

`contracts/PrismForgeRouter.sol` forges a crystal from ETH in one transaction: it swaps ETH
into the chosen test stocks through their Uniswap V4 pools, checks each output against the
caller's minimum, forges a PrismCrystal holding exactly those outputs (plus any ETH the caller
keeps as ETH), and transfers the NFT to the caller.

## Trust model, in plain words

- **No admin, no state.** No owner, no fees, no pause, no upgrades, and no storage variables.
  Everything it depends on is fixed at deploy as an immutable: the PoolManager, the
  PrismCrystal, the pool fee (3000) and tick spacing (60), and up to five allowed tokens.
- **Only the known test stocks.** `forgeFromETH` rejects any token that isn't one of the
  deploy-time tokens (`UnknownToken`), so it can't be pointed at an arbitrary contract.
  Hooks are always `address(0)`, and ETH is always `currency0`.
- **All or nothing.** If any swap returns less than its `minAmountsOut` entry, the whole call
  reverts (`InsufficientOutput`): no swap, no crystal, the ETH stays with the caller. Minimums
  must be above zero (`ZeroMinimum`), so every call has slippage protection.
- **Ends empty, every time.** After forging, the router sends any leftover ETH (unused swap
  input, overpayment, ETH someone force-sent) and any balance of the swapped tokens back to the
  caller, then asserts it holds zero ETH and zero of those tokens (`NotEmpty`). Sweeping strays
  to the caller (instead of failing) means nobody can block forges by sending dust to it.
- **The NFT ends with the caller.** The crystal is minted to the router, transferred with
  `safeTransferFrom` to `msg.sender`, and `ownerOf(id) == msg.sender` is checked
  (`NotDelivered`).
- **Reentrancy.** `forgeFromETH` uses OpenZeppelin's `ReentrancyGuardTransient` (EIP-1153,
  cleared at the end of the call). `unlockCallback` only runs when called by the PoolManager
  *and* while a forge is in progress (`NotPoolManager`, `NotForging`). `onERC721Received` only
  accepts a fresh mint from the PrismCrystal during a forge (`UnexpectedNFT`), so stray NFTs
  can't get stuck in it. It has no `receive`, so plain ETH sends revert.
- **Swaps go straight through the PoolManager** (`unlock` → `swap` → `settle` → `take`), with no
  Universal Router or Permit2 approvals involved; the router never holds token approvals beyond
  the exact amounts the PrismCrystal pulls during `forge` (reset to zero afterwards if anything
  were left).

## Tested

- `test/PrismForgeRouter.test.ts` (mock PoolManager with V4-style settlement checks): happy
  path, single token, slippage revert, ETH refund, partial fills, stray dust swept, unknown /
  zero tokens, input validation, a caller re-entering on the NFT and on the refund, a caller
  refusing ETH, a token re-entering mid-swap, stray `unlockCallback` calls, stray NFTs and ETH,
  constructor validation, ABI export drift.
- `test/fork/PrismForgeRouter.fork.test.ts` (`npm run test:fork`): a fork of Robinhood Chain
  Testnet at the latest block. Real swaps through the real pools into the real PrismCrystal;
  outputs match the V4Quoter exactly; slippage revert; refund; all five stocks; USDG (a real
  token with a pool, but not allowed) rejected; reentrancy on the NFT stopped; the router is
  empty after every call.

## Known limitations

1. **Price impact is the caller's problem.** The router enforces the minimums it is given; the
   app quotes with the V4Quoter and applies the chosen slippage (default 1%). Thin pools
   (OPENAI, ANTHROPIC) move quickly with size; the app warns above 3% impact.
2. **Forged event owner.** PrismCrystal's `Forged` event records the router as `owner` (it is
   the minter). The real owner is in the `Transfer` to the caller and `ownerOf`; the router also
   emits `ForgedFromETH(id, owner, …)`.
3. **Contract callers** must implement `onERC721Received` and accept ETH if they overpay;
   otherwise the call reverts (nothing is lost).
4. **Fixed list.** New test stocks need a new router deployment (it's stateless, so that is
   cheap and safe).
5. **Unaudited.** Testnet only, no real funds.
