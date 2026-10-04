import { describe, expect, it } from 'vitest';
import type { PublicClient } from 'viem';
import {
  OFFICIAL_VIBERS,
  VIBERS_CREDIT,
  VIBERS_NFT,
  readOwnedViber,
  readTokenMetadata,
  resolveMediaUrl,
  viberAt,
  viberImageUrl,
} from '../src';

describe('official vibers', () => {
  it('points at the official vibe/vibe collection images', () => {
    for (const v of OFFICIAL_VIBERS) {
      expect(viberImageUrl(v.file)).toMatch(/^https:\/\/testnet\.vibevibe\.fun\/vibers\/collection\/[a-z0-9-]+-480\.webp$/);
      expect(v.description.length).toBeGreaterThan(10);
    }
    expect(new Set(OFFICIAL_VIBERS.map((v) => v.file)).size).toBe(OFFICIAL_VIBERS.length);
  });

  it('rotates deterministically, including negative indices', () => {
    expect(viberAt(0)).toBe(OFFICIAL_VIBERS[0]);
    expect(viberAt(OFFICIAL_VIBERS.length + 2)).toBe(OFFICIAL_VIBERS[2]);
    expect(viberAt(-1)).toBe(OFFICIAL_VIBERS[OFFICIAL_VIBERS.length - 1]);
  });

  it('carries the permission credit line', () => {
    expect(VIBERS_CREDIT).toBe('vibe vibers © vibe/vibe, featured with permission.');
  });
});

describe('holder viber (read-only)', () => {
  it('has no contract configured until vibe/vibe publishes one', async () => {
    expect(VIBERS_NFT).toBeNull();
    const client = {} as PublicClient;
    expect(await readOwnedViber(client, '0x0000000000000000000000000000000000000001', fetch)).toBeNull();
  });

  it('resolves ipfs and arweave media URLs', () => {
    expect(resolveMediaUrl('ipfs://bafy/1.png')).toBe('https://ipfs.io/ipfs/bafy/1.png');
    expect(resolveMediaUrl('ipfs://ipfs/bafy/1.png')).toBe('https://ipfs.io/ipfs/bafy/1.png');
    expect(resolveMediaUrl('ar://abc')).toBe('https://arweave.net/abc');
    expect(resolveMediaUrl('https://x/y.webp')).toBe('https://x/y.webp');
  });

  it('reads on-chain (data:) and remote metadata', async () => {
    const json = JSON.stringify({ name: 'Viber #7', image: 'ipfs://cid/7.webp' });
    expect(await readTokenMetadata(`data:application/json;base64,${btoa(json)}`, fetch)).toEqual(JSON.parse(json));
    expect(await readTokenMetadata(`data:application/json,${encodeURIComponent(json)}`, fetch)).toEqual(JSON.parse(json));
    const fake = (async (url: string) => {
      expect(url).toBe('https://ipfs.io/ipfs/meta/7');
      return { ok: true, json: async () => ({ image: 'https://img' }) };
    }) as unknown as typeof fetch;
    expect(await readTokenMetadata('ipfs://meta/7', fake)).toEqual({ image: 'https://img' });
  });

  it('returns the owner’s first viber with its metadata image', async () => {
    const calls: string[] = [];
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        calls.push(functionName);
        if (functionName === 'balanceOf') return 2n;
        if (functionName === 'tokenOfOwnerByIndex') return 7n;
        if (functionName === 'tokenURI') return `data:application/json;base64,${btoa(JSON.stringify({ name: 'Viber #7', image: 'ipfs://cid/7.webp' }))}`;
        throw new Error(functionName);
      },
    } as unknown as PublicClient;
    const v = await readOwnedViber(client, '0x0000000000000000000000000000000000000001', fetch, {
      chainId: 4663,
      address: '0x0000000000000000000000000000000000000002',
      label: 'mainnet',
    });
    expect(v).toEqual({ tokenId: 7n, name: 'Viber #7', image: 'https://ipfs.io/ipfs/cid/7.webp', chainId: 4663, label: 'mainnet' });
    expect(calls).toEqual(['balanceOf', 'tokenOfOwnerByIndex', 'tokenURI']);
  });

  it('returns null for wallets without a viber', async () => {
    const client = { readContract: async () => 0n } as unknown as PublicClient;
    expect(
      await readOwnedViber(client, '0x0000000000000000000000000000000000000001', fetch, {
        chainId: 46630,
        address: '0x0000000000000000000000000000000000000002',
      }),
    ).toBeNull();
  });
});
