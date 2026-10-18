import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cachedMeta, decodeMetaCache, emptyMetaCache, encodeMetaCache, metaRow, parseTokenMetadata, type MetaRow } from '../src';

// Silver Garden ($SILGAR, gen 2): the real metadata file
const SILGAR_CID = 'bafkreiazwdar76if2gq3r44ynl2degcm3ueajlvi63gkt6pe5kzjplsqji';
const SILGAR_TOKEN = '0x1111111111111111111111111111111111111111';
const silgar = parseTokenMetadata(JSON.parse(readFileSync(new URL('./vectors/metadata-silgar.json', import.meta.url), 'utf8')));

describe('the permanent metadata cache', () => {
  it('keeps final answers and round-trips them through the published file', () => {
    const cache = emptyMetaCache(46630);
    const ok = metaRow(SILGAR_TOKEN, { status: 'ok', uri: `ipfs://${SILGAR_CID}`, verified: 'cid', meta: { ...silgar, links: { x: 'https://x.com/silgar' } } })!;
    const none = metaRow('0x2222222222222222222222222222222222222222', { status: 'none', uri: null })!;
    cache.rows.set(ok[0], ok);
    cache.rows.set(none[0], none);
    const back = decodeMetaCache(JSON.parse(JSON.stringify(encodeMetaCache(cache))))!;
    expect(back.chainId).toBe(46630);
    expect(back.rows.size).toBe(2);
    const got = cachedMeta(back.rows.get(SILGAR_TOKEN)!)!;
    expect(got.status).toBe('ok');
    if (got.status !== 'ok') return;
    expect(got.meta.description).toBe(silgar.description);
    expect(got.meta.image).toEqual(silgar.image);
    expect(got.meta.links).toEqual({ x: 'https://x.com/silgar' });
    expect(cachedMeta(back.rows.get('0x2222222222222222222222222222222222222222')!)).toEqual({ status: 'none', uri: null });
  });

  it('never keeps "unavailable" (that answer is asked again)', () => {
    expect(metaRow(SILGAR_TOKEN, { status: 'unavailable', uri: `ipfs://${SILGAR_CID}` })).toBeNull();
  });

  it('checks every field again on the way in', () => {
    const row: MetaRow = [SILGAR_TOKEN, `ipfs://${SILGAR_CID}`, 'ok', 'cid', 'hi‮ there', 'not-a-cid', 'image/webp', 'javascript:alert(1)', '@ok_handle', 'https://evil.example/x', 'https://discord.gg/abc12'];
    const got = cachedMeta(row)!;
    expect(got.status).toBe('ok');
    if (got.status !== 'ok') return;
    expect(got.meta.description).toBe('hi there');
    expect(got.meta.image).toBeNull();
    expect(got.meta.links).toEqual({ x: 'https://x.com/ok_handle', discord: 'https://discord.gg/abc12' });
    // an 'ok' row must name an IPFS file and how it was verified
    expect(cachedMeta([SILGAR_TOKEN, 'https://evil.example/m.json', 'ok', 'cid', '', '', '', '', '', '', ''])).toBeNull();
    expect(cachedMeta([SILGAR_TOKEN, `ipfs://${SILGAR_CID}`, 'ok', '', '', '', '', '', '', '', ''])).toBeNull();
  });

  it('reads only its own format, dropping malformed rows', () => {
    expect(decodeMetaCache(null)).toBeNull();
    expect(decodeMetaCache({ version: 99, chainId: 46630, rows: [] })).toBeNull();
    const c = decodeMetaCache({
      version: 1,
      chainId: 46630,
      updatedAt: 1,
      rows: [[SILGAR_TOKEN, '', 'none', '', '', '', '', '', '', '', ''], ['0xnope', '', 'none', '', '', '', '', '', '', '', ''], [SILGAR_TOKEN, 1], 'junk'],
    })!;
    expect([...c.rows.keys()]).toEqual([SILGAR_TOKEN]);
  });
});
