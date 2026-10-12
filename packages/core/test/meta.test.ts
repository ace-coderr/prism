import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from './vectors/launch-logs.json';
import {
  IpfsError,
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
