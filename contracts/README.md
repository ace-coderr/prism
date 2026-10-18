# contracts

Hardhat + TypeScript. No admin, no pause, no upgrades, no fees. See [SECURITY.md](SECURITY.md).

| Contract | What |
| --- | --- |
| `PrismReviews.sol` | Holder-only reviews with SOLD marks, v2: SOLD measured from the run's baseline (deployed: 0x9e05AF8cbAC4877CAC1B0Ef089b7e023fFB23B40; v1, retired: 0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3) |
| `PrismProfiles.sol` | Usernames, bios, X handles (deployed, kept from the first PRISM) |
| `PrismCrystal.sol` | **Legacy**: the archived crystal app's NFT; kept because PrismProfiles' tests deploy it |

```bash
npm test -w @prism/contracts            # all tests
npm run test:fork -w @prism/contracts   # PrismReviews on a fork: real curve + stock buys and sells, the v2 ladder
npm run export-abi -w @prism/contracts  # after changing a contract: refresh packages/core/src/abi
```

`scripts/seed-fork.ts` deploys v2 on a **local fork** and fills it with every case the website has to
get right (real launch and test stock buys, a trim, the update ladder, a dump bought back, a dust
position, the launch's creator reviewing, an unlisted token, a self-mark and a truth keeper mark). It
refuses any network but a local fork of the testnet: PRISM never generates activity on the real chain.

**Deploying:** there are no private keys in this repo. Deploy from your own browser wallet on
the web app's hidden `/deploy` page, then record the address in
`packages/core/src/deployments.ts`.

**Verifying on Blockscout** (no API key needed; the network entry has no accounts):

```bash
npx hardhat verify --network robinhoodTestnet <contract address>
```

EVM target is `cancun`; `packages/core/scripts/check-evm.ts` confirms Robinhood Chain Testnet
executes PUSH0 / MCOPY / TSTORE / TLOAD.
