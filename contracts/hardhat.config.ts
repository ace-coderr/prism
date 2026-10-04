import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

// No private keys anywhere. The robinhoodTestnet network has an RPC URL only (no
// accounts), so it can be used for read-only tasks like source verification but can
// never sign or deploy. Deployment happens from the user's browser wallet (/deploy).
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    // FORK=1 runs the local network as a fork of Robinhood Chain Testnet at its latest
    // block (the public RPC isn't archival; it keeps recent state only), so fork tests can
    // swap through the real Uniswap V4 pools and forge into the real PrismCrystal.
    hardhat: process.env.FORK === '1'
      ? { forking: { url: 'https://rpc.testnet.chain.robinhood.com' }, chainId: 46630, hardfork: 'cancun' }
      : {},
    robinhoodTestnet: {
      url: 'https://rpc.testnet.chain.robinhood.com',
      chainId: 46630,
      accounts: [],
    },
  },
  // Blockscout exposes an Etherscan-compatible API; it doesn't need a real key.
  etherscan: {
    apiKey: { robinhoodTestnet: 'blockscout' },
    customChains: [
      {
        network: 'robinhoodTestnet',
        chainId: 46630,
        urls: {
          apiURL: 'https://explorer.testnet.chain.robinhood.com/api',
          browserURL: 'https://explorer.testnet.chain.robinhood.com',
        },
      },
    ],
  },
  sourcify: { enabled: false },
  gasReporter: {
    enabled: process.env.REPORT_GAS === '1',
    offline: true,
    reportPureAndViewMethods: false,
  },
};

export default config;
