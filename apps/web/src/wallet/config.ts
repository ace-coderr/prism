import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { PrivyClientConfig } from '@privy-io/react-auth';
import { createConfig as createPrivyConfig } from '@privy-io/wagmi';
import { robinhoodChainTestnet } from '@prism/core';

/**
 * Privy's app ID (public, client-side only; set as VITE_PRIVY_APP_ID in Vercel's
 * environment variables). With it, people log in with email, Google, X or a wallet, and
 * those without a wallet get an embedded one. Without it (e.g. a local build without the
 * variable), the app falls back to browser wallets only (MetaMask, Rabby, …).
 *
 * PRISM never sees or stores keys: every transaction is signed in the user's wallet, and an
 * embedded wallet's key stays inside Privy (exportable only through Privy's own screen).
 */
export const PRIVY_APP_ID: string | undefined = import.meta.env.VITE_PRIVY_APP_ID || undefined;

export const TARGET_CHAIN = robinhoodChainTestnet;

// the public RPC rejects JSON-RPC batches of ~50+ calls; keep them small
const transports = { [robinhoodChainTestnet.id]: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: { batchSize: 20 } }) };

export const wagmiConfig = PRIVY_APP_ID
  ? // Privy picks the connector (the embedded wallet or the external wallet the user logged in with)
    createPrivyConfig({ chains: [robinhoodChainTestnet], transports })
  : // injected wallets only, discovered via EIP-6963
    createConfig({ chains: [robinhoodChainTestnet], connectors: [injected()], multiInjectedProviderDiscovery: true, transports });

/** PRISM's look for Privy's modals (login, wallet confirmations, key export). */
export const PRIVY_CONFIG: PrivyClientConfig = {
  loginMethods: ['email', 'google', 'twitter', 'wallet'],
  appearance: {
    theme: '#16191c', // PRISM's panel
    accentColor: '#d4f000', // lime
    logo: '/brand/privy-logo.png',
    landingHeader: 'Log in to PRISM',
    loginMessage: 'No wallet? Log in with email, Google or X and PRISM makes one for you.',
    showWalletLoginFirst: false,
    // detected browser wallets (MetaMask, Rabby, …) first
    walletList: ['detected_ethereum_wallets', 'metamask', 'coinbase_wallet', 'wallet_connect'],
    walletChainType: 'ethereum-only',
  },
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
    // Privy's own confirmation screen for every embedded-wallet transaction (PRISM fills in what it does)
    showWalletUIs: true,
    // test ETH has no price: show amounts in ETH only
    priceDisplay: { primary: 'native-token', secondary: null },
  },
  defaultChain: robinhoodChainTestnet,
  supportedChains: [robinhoodChainTestnet],
};

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
