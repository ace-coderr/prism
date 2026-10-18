import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from './vectors/launch-logs.json';
import {
  IPFS_GATEWAYS,
  IpfsError,
  readLaunchMetadata,
  decodeLaunchMetadataRef,
  discordLink,
  fetchIpfs,
  ipfsCid,
  parseTokenMetadata,
  rawCidSha256,
  safeUrl,
  telegramLink,
  verifyIpfsBytes,
  xLink,
  type RawLog,
} from '../src';

// Silver Garden ($SILGAR, gen 2): its launch event's URI and digest, and the exact file on IPFS
const SILGAR_CID = 'bafkreiazwdar76if2gq3r44ynl2degcm3ueajlvi63gkt6pe5kzjplsqji';
const SILGAR_DIGEST = '0xb3000a974d3e51d5461091c750b1da13db1378a7f23244d6f966bd080c4c9a40';
const silgar = new Uint8Array(readFileSync(new URL('./vectors/metadata-silgar.json', import.meta.url)));

const log = (v: (typeof vectors)['gen0']): RawLog => ({ ...(v as unknown as RawLog), blockNumber: BigInt(v.blockNumber), logIndex: Number(v.logIndex) });

describe('where a launch keeps its metadata', () => {
  it('every factory generation puts an IPFS URI in its launch event (gen 0/1/2 also a digest)', () => {
    for (const k of ['gen0', 'gen1', 'gen2', 'gen2quote'] as const) {
      const ref = decodeLaunchMetadataRef(log(vectors[k]))!;
      expect(ipfsCid(ref.uri)).toMatch(/^bafkrei/);
      expect(ref.digest).toMatch(/^0x[0-9a-f]{64}$/);
    }
    for (const k of ['v6eth', 'v6nvda'] as const) {
      const ref = decodeLaunchMetadataRef(log(vectors[k]))!;
      expect(ipfsCid(ref.uri)).toMatch(/^bafkrei/);
      expect(ref.digest).toBeNull();
    }
    expect(decodeLaunchMetadataRef(log(vectors.gradGen0))).toBeNull();
  });

  it('reads CIDs only from ipfs:// (and /ipfs/) URIs', () => {
    expect(ipfsCid(`ipfs://${SILGAR_CID}`)).toBe(SILGAR_CID);
    expect(ipfsCid(`https://gateway.example/ipfs/${SILGAR_CID}`)).toBe(SILGAR_CID);
    expect(ipfsCid('ipfs://bafkreifakeplaceholderforbottestnet000000000000000000000000000')).toBeNull();
    expect(ipfsCid('https://evil.example/x.json')).toBeNull();
  });
});

describe('verifying a file against the chain', () => {
  it('a raw CID is the SHA-256 of the bytes; the gen 0/1/2 digest is their keccak256', async () => {
    expect(rawCidSha256(SILGAR_CID)).toBe('19b0c11ff905d1a1b8f3986af432184cdd0804aea8f6cca9f9e4eab297ae504a');
    expect(await verifyIpfsBytes(silgar, SILGAR_CID, SILGAR_DIGEST)).toBe('cid');
    expect(await verifyIpfsBytes(silgar, SILGAR_CID)).toBe('cid');
  });

  it('rejects a changed file, and a digest that disagrees', async () => {
    const tampered = silgar.slice();
    tampered[10] = tampered[10]! ^ 1;
    expect(await verifyIpfsBytes(tampered, SILGAR_CID)).toBeNull();
    expect(await verifyIpfsBytes(silgar, SILGAR_CID, `0x${'11'.repeat(32)}`)).toBeNull();
  });

  it('races gateways and keeps only bytes that verify', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://bad/')) return new Response(new Uint8Array([1, 2, 3]));
      if (url.startsWith('https://down/')) return new Response('no', { status: 429 });
      return new Response(silgar);
    }) as unknown as typeof fetch;
    const got = await fetchIpfs(SILGAR_CID, { maxBytes: 64 * 1024, fetchImpl: fake, gateways: ['https://bad/', 'https://down/', 'https://good/'] });
    expect(got.verified).toBe('cid');
    expect(new TextDecoder().decode(got.bytes)).toContain('Silver Garden');
    await expect(fetchIpfs(SILGAR_CID, { maxBytes: 64 * 1024, fetchImpl: fake, gateways: ['https://bad/', 'https://bad/'] })).rejects.toThrow(IpfsError);
    await expect(fetchIpfs(SILGAR_CID, { maxBytes: 10, fetchImpl: fake, gateways: ['https://good/'] })).rejects.toThrow('larger');
  }, 15_000);

  it('asks every gateway at once: a hung gateway first in line costs nothing', async () => {
    const asked: string[] = [];
    let aborted = 0;
    const fake = ((url: string, init?: RequestInit) => {
      asked.push(url);
      if (url.startsWith('https://hung/'))
        return new Promise<Response>((_, no) => init?.signal?.addEventListener('abort', () => (aborted++, no(new Error('aborted')))));
      return Promise.resolve(new Response(silgar));
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    const got = await fetchIpfs(SILGAR_CID, { maxBytes: 64 * 1024, fetchImpl: fake, gateways: ['https://hung/', 'https://hung/', 'https://good/'] });
    expect(got.verified).toBe('cid');
    expect(Date.now() - t0).toBeLessThan(500);
    expect(asked).toHaveLength(3);
    expect(aborted).toBe(2); // the losers are cancelled
  });

  it('bulk reads (staggered): one request when the first gateway serves it, the next joins at once if it fails', async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      return url.startsWith('https://busy/') ? new Response('slow down', { status: 429 }) : new Response(silgar);
    }) as unknown as typeof fetch;
    await fetchIpfs(SILGAR_CID, { maxBytes: 64 * 1024, fetchImpl: fake, gateways: ['https://good/', 'https://other/'], staggerMs: 5000 });
    expect(asked).toEqual([`https://good/${SILGAR_CID}`]);
    asked.length = 0;
    const t0 = Date.now();
    await fetchIpfs(SILGAR_CID, { maxBytes: 64 * 1024, fetchImpl: fake, gateways: ['https://busy/', 'https://good/'], staggerMs: 5000 });
    expect(asked).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('Pinata is one of the gateways, raced with public ones', () => {
    expect(IPFS_GATEWAYS[0]).toBe('https://gateway.pinata.cloud/ipfs/');
    expect(IPFS_GATEWAYS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(IPFS_GATEWAYS).size).toBe(IPFS_GATEWAYS.length);
  });
});

describe('reading a launch’s metadata', () => {
  const ref = { uri: `ipfs://${SILGAR_CID}`, digest: SILGAR_DIGEST as `0x${string}` };
  const serve = (body: Uint8Array<ArrayBuffer> | null) => (async () => (body ? new Response(body) : new Response('busy', { status: 429 }))) as unknown as typeof fetch;

  it('ok: verified and reduced to what PRISM shows', async () => {
    const r = await readLaunchMetadata(ref, { fetchImpl: serve(silgar), gateways: ['https://a/'] });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.verified).toBe('cid');
    expect(r.meta.image?.mimeType).toBe('image/webp');
  });

  it('none is final: no URI, not IPFS, or a file that doesn’t match the chain', async () => {
    expect(await readLaunchMetadata(null)).toEqual({ status: 'none', uri: null });
    expect(await readLaunchMetadata({ uri: 'https://evil.example/x.json', digest: null })).toEqual({ status: 'none', uri: 'https://evil.example/x.json' });
    const wrong = await readLaunchMetadata(ref, { fetchImpl: serve(new Uint8Array([1, 2, 3])), gateways: ['https://a/', 'https://b/'] });
    expect(wrong.status).toBe('none');
  });

  it('unavailable when no gateway answers (not final: asked again later)', async () => {
    const r = await readLaunchMetadata(ref, { fetchImpl: serve(null), gateways: ['https://a/', 'https://b/'] });
    expect(r).toEqual({ status: 'unavailable', uri: ref.uri });
  });
});

describe('what PRISM shows from metadata', () => {
  it('description, picture and links from the real file', () => {
    const m = parseTokenMetadata(JSON.parse(new TextDecoder().decode(silgar)));
    expect(m.description).toBe('A Robinhood Chain Testnet launch created for protocol testing and feedback.');
    expect(m.image).toEqual({ cid: 'bafkreifamrytmg2r7btw3uz6redy3fxu5hjsx4rfi3ktld4ag73hv64dpu', mimeType: 'image/webp' });
    expect(m.links).toEqual({});
  });

  it('keeps only safe links and plain text', () => {
    const m = parseTokenMetadata({
      description: 'hi‮ there\u0000\n\n\n\nbye',
      image: { uri: 'https://example.com/a.png', mimeType: 'image/png' },
      socials: { website: 'javascript:alert(1)', x: '@prism_fan', telegram: 't.me/prismchat', discord: 'discord.gg/abc123' },
    });
    expect(m.description).toBe('hi there\n\nbye');
    expect(m.image).toBeNull(); // not an IPFS raw CID: can't be checked
    expect(m.links).toEqual({ x: 'https://x.com/prism_fan', telegram: 'https://t.me/prismchat', discord: 'https://discord.gg/abc123' });
    expect(safeUrl('example.com/p')).toBe('https://example.com/p');
    expect(safeUrl('https://user:pw@example.com')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(xLink('https://twitter.com/holdprism/status/1')).toBe('https://x.com/holdprism');
    expect(xLink('https://evil.com/holdprism')).toBeNull();
    expect(telegramLink('https://t.me/+AbCdEf123')).toBe('https://t.me/+AbCdEf123');
    expect(discordLink('https://discord.com/invite/xyz99')).toBe('https://discord.gg/xyz99');
    expect(discordLink('https://discord.com/channels/1')).toBeNull();
  });
});
