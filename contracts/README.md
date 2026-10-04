# contracts

Hardhat + TypeScript. `PrismCrystal.sol` is an ERC-721 that holds its own basket of ERC-20s
and ETH: forge, add, withdraw, seal (time-locked gifts), burn, fully on-chain `tokenURI`.
No admin, no pause, no upgrades, no fees. See [SECURITY.md](SECURITY.md).

```bash
npm test -w @prism/contracts          # all tests
npm run gas -w @prism/contracts       # tests + gas report
```

Not deployed. The Hardhat config has no networks or keys on purpose.
