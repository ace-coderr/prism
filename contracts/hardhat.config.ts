import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

// No networks with keys on purpose: nothing here can deploy. Tests run on the
// in-process Hardhat network only.
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === '1',
    offline: true,
    reportPureAndViewMethods: false,
  },
};

export default config;
