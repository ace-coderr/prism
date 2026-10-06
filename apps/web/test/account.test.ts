import { describe, expect, it } from 'vitest';
import { FAUCET_URL, isEmbeddedWallet, loginInfo, needsTestEth } from '../src/wallet/account';

describe('signed in with…', () => {
  it('names the way someone logged in, with the account it used', () => {
    expect(loginInfo({ email: { address: 'ace@example.com' } })).toEqual({ method: 'email', label: 'Email', detail: 'ace@example.com' });
    expect(loginInfo({ google: { email: 'ace@gmail.com' } })).toEqual({ method: 'google', label: 'Google', detail: 'ace@gmail.com' });
    expect(loginInfo({ twitter: { username: 'holdprism' } })).toEqual({ method: 'x', label: 'X', detail: '@holdprism' });
    expect(loginInfo({ twitter: { username: null } })?.detail).toBeNull();
  });

  it('a user with no email, Google or X logged in with a wallet', () => {
    expect(loginInfo({}, 'MetaMask')).toEqual({ method: 'wallet', label: 'Wallet', detail: 'MetaMask' });
    expect(loginInfo({ email: null, google: null, twitter: null })).toEqual({ method: 'wallet', label: 'Wallet', detail: null });
    expect(loginInfo(null)).toBeNull();
  });

  it('recognizes Privy embedded wallets (and nothing else) for "Export private key"', () => {
    expect(isEmbeddedWallet({ walletClientType: 'privy' })).toBe(true);
    expect(isEmbeddedWallet({ walletClientType: 'privy-v2' })).toBe(true);
    expect(isEmbeddedWallet({ walletClientType: 'metamask' })).toBe(false);
    expect(isEmbeddedWallet(undefined)).toBe(false);
  });
});

describe('test ETH', () => {
  it('asks for test ETH only when the balance is exactly 0 (not while it is still loading)', () => {
    expect(needsTestEth(0n)).toBe(true);
    expect(needsTestEth(1n)).toBe(false);
    expect(needsTestEth(undefined)).toBe(false);
    expect(needsTestEth(null)).toBe(false);
  });

  it('points to the faucet on Robinhood Chain Testnet’s own domain', () => {
    expect(new URL(FAUCET_URL).host).toBe('faucet.testnet.chain.robinhood.com');
  });
});
