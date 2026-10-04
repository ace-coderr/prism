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
