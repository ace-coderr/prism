# contracts

Hardhat + TypeScript. `PrismCrystal.sol` is an ERC-721 that holds its own basket of ERC-20s
and ETH: forge, add, withdraw, seal (time-locked gifts), burn, fully on-chain `tokenURI`.
No admin, no pause, no upgrades, no fees. See [SECURITY.md](SECURITY.md).

```bash
npm test -w @prism/contracts          # all tests
npm run gas -w @prism/contracts       # tests + gas report
npm run export-abi -w @prism/contracts  # after changing the contract: refresh packages/core/src/abi
```

**Deploying:** there are no private keys in this repo. Deploy from your own browser wallet on
the web app's hidden `/deploy` page, then record the address in
`packages/core/src/deployments.ts`.

**Verifying on Blockscout** (no API key needed; the network entry has no accounts):

```bash
npx hardhat verify --network robinhoodTestnet <contract address>
```

EVM target is `cancun`; `packages/core/scripts/check-evm.ts` confirms Robinhood Chain Testnet
executes PUSH0 / MCOPY / TSTORE / TLOAD and runs this contract's creation code (via eth_call).
