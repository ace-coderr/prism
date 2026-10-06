/*
 * Who is signed in, and how (pure helpers, so they can be tested without Privy).
 */

/** Robinhood Chain Testnet's faucet (Robinhood's own testnet domain, like the RPC and explorer). */
export const FAUCET_URL = 'https://faucet.testnet.chain.robinhood.com';

/** Privy's embedded wallets ("privy" and the newer "privy-v2"). */
export const isEmbeddedWallet = (w: { walletClientType?: string } | null | undefined) =>
  w?.walletClientType === 'privy' || w?.walletClientType === 'privy-v2';

export interface LoginInfo {
  method: 'email' | 'google' | 'x' | 'wallet';
  /** "Email", "Google", "X", "Wallet" */
  label: string;
  /** the email, @handle or wallet name */
  detail: string | null;
}

/** The bits of a Privy user this needs (structural, so tests can pass plain objects). */
export interface LoginUser {
  email?: { address: string } | null;
  google?: { email: string } | null;
  twitter?: { username: string | null } | null;
}

/**
 * How someone signed in, for the wallet menu. PRISM only offers logging in (not linking more
 * accounts), so the account they have is the one they logged in with; a user with none of
 * email, Google or X logged in with a wallet.
 */
export function loginInfo(user: LoginUser | null | undefined, walletName?: string | null): LoginInfo | null {
  if (!user) return null;
  if (user.twitter) return { method: 'x', label: 'X', detail: user.twitter.username ? `@${user.twitter.username}` : null };
  if (user.google) return { method: 'google', label: 'Google', detail: user.google.email };
  if (user.email) return { method: 'email', label: 'Email', detail: user.email.address };
  return { method: 'wallet', label: 'Wallet', detail: walletName ?? null };
}

/** New users start with no test ETH: nothing on PRISM works until they get a little. */
export const needsTestEth = (balance: bigint | null | undefined) => balance === 0n;
