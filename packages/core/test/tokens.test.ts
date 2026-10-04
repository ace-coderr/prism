import { describe, expect, it } from 'vitest';
import { createPublicClient, erc20Abi, getAddress, http, isAddress } from 'viem';
import {
  BASKET_TOKENS,
  TESTNET_CHAIN_ID,
  TESTNET_TOKENS,
  feedPrice,
  robinhoodChainTestnet,
  tokenBySymbol,
} from '../src';

// Mainnet (4663) addresses from https://docs.robinhood.com/chain/contracts — must never leak into the testnet list.
const KNOWN_MAINNET = ['0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'];
const ALLOWED_SOURCES = ['https://docs.robinhood.com/', 'https://testnet.vibevibe.fun/', 'https://docs.chain.link/'];

describe('TESTNET_TOKENS', () => {
  it('targets chain 46630', () => {
    expect(TESTNET_CHAIN_ID).toBe(46630);
    expect(robinhoodChainTestnet.id).toBe(TESTNET_CHAIN_ID);
  });

  it('has valid, checksummed, unique addresses', () => {
    const seen = new Set<string>();
    for (const t of TESTNET_TOKENS) {
      expect(isAddress(t.address)).toBe(true);
      expect(t.address).toBe(getAddress(t.address));
      expect(seen.has(t.address.toLowerCase())).toBe(false);
      seen.add(t.address.toLowerCase());
    }
  });

  it('never contains mainnet addresses', () => {
    const lower = KNOWN_MAINNET.map((a) => a.toLowerCase());
    for (const t of TESTNET_TOKENS) expect(lower).not.toContain(t.address.toLowerCase());
  });

  it('cites a source for every token', () => {
    for (const t of TESTNET_TOKENS) {
      expect(ALLOWED_SOURCES.some((s) => t.sourceUrl.startsWith(s))).toBe(true);
    }
  });

  it('has sane metadata and price feed fields', () => {
    for (const t of TESTNET_TOKENS) {
      expect(t.symbol).toMatch(/^[A-Za-z0-9]{2,10}$/);
      expect(t.name.length).toBeGreaterThan(0);
      expect(Number.isInteger(t.decimals)).toBe(true);
      expect(t.decimals).toBeGreaterThanOrEqual(0);
      expect(t.decimals).toBeLessThanOrEqual(36);
      if (t.priceFeed !== null) expect(isAddress(t.priceFeed)).toBe(true);
    }
  });

  it('offers only stocks + ETH-like tokens to baskets', () => {
    expect(BASKET_TOKENS.every((t) => t.kind === 'stock' || t.kind === 'crypto')).toBe(true);
    expect(BASKET_TOKENS.map((t) => t.symbol)).toEqual(['WETH', 'SPCX']);
    expect(tokenBySymbol('SPCX')?.name).toBe('Seedify Mock Stock SPCX');
    expect(tokenBySymbol('NOPE')).toBeUndefined();
  });
});

describe('feedPrice', () => {
  const now = 1_800_000_000;
  it('scales by feed decimals', () => {
    expect(feedPrice(30_000_000_000n, 8, BigInt(now - 60), now)).toBe(300);
  });
  it('rejects non-positive answers, missing rounds and stale data', () => {
    expect(feedPrice(0n, 8, BigInt(now), now)).toBeNull();
    expect(feedPrice(-5n, 8, BigInt(now), now)).toBeNull();
    expect(feedPrice(100n, 8, 0n, now)).toBeNull();
    expect(feedPrice(100n, 8, BigInt(now - 10 * 24 * 3600), now)).toBeNull();
  });
});

// Hits the public testnet RPC. Opt in with RUN_RPC_TESTS=1 so offline / CI runs stay deterministic.
describe.runIf(process.env.RUN_RPC_TESTS === '1')('on-chain (Robinhood Chain Testnet RPC)', () => {
  const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http() });

  it('RPC reports chain 46630', async () => {
    expect(await client.getChainId()).toBe(46630);
  });

  for (const t of TESTNET_TOKENS) {
    it(`${t.symbol}: name/symbol/decimals/totalSupply match`, async () => {
      const [name, symbol, decimals, supply] = await Promise.all([
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'name' }),
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'decimals' }),
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'totalSupply' }),
      ]);
      expect(name).toBe(t.name);
      expect(symbol).toBe(t.symbol);
      expect(decimals).toBe(t.decimals);
      expect(supply).toBeGreaterThan(0n);
    }, 30_000);
  }
});
