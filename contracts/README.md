# contracts

Hardhat + TypeScript. No admin, no pause, no upgrades, no fees. See [SECURITY.md](SECURITY.md).

| Contract | What |
| --- | --- |
| `PrismReviews.sol` | Holder-only reviews with SOLD marks (not deployed yet) |
| `PrismProfiles.sol` | Usernames, bios, X handles (deployed, kept from the first PRISM) |
| `PrismCrystal.sol` | **Legacy**: the archived crystal app's NFT; kept because PrismProfiles' tests deploy it |

```bash
npm test -w @prism/contracts            # all tests
npm run test:fork -w @prism/contracts   # PrismReviews on a fork: real curve + stock buys and sells
npm run export-abi -w @prism/contracts  # after changing a contract: refresh packages/core/src/abi
```

**Deploying:** there are no private keys in this repo. Deploy from your own browser wallet on
the web app's hidden `/deploy` page, then record the address in
`packages/core/src/deployments.ts`.

**Verifying on Blockscout** (no API key needed; the network entry has no accounts):

```bash
npx hardhat verify --network robinhoodTestnet <contract address>
```

EVM target is `cancun`; `packages/core/scripts/check-evm.ts` confirms Robinhood Chain Testnet
executes PUSH0 / MCOPY / TSTORE / TLOAD.
