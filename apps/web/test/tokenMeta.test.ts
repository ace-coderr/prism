import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { META_CACHE_VERSION, type Launch } from '@prism/core';

// Silver Garden's real metadata (gen 2), as the scheduled job publishes it
const SILGAR_CID = 'bafkreiazwdar76if2gq3r44ynl2degcm3ueajlvi63gkt6pe5kzjplsqji';
const IMAGE_CID = 'bafkreifamrytmg2r7btw3uz6redy3fxu5hjsx4rfi3ktld4ag73hv64dpu';
const CACHED = '0x1111111111111111111111111111111111111111' as Address;
const NONE = '0x2222222222222222222222222222222222222222' as Address;
const UNKNOWN = '0x3333333333333333333333333333333333333333' as Address;
const launch = (token: Address): Launch => ({ token, name: 'T', symbol: 'T', quote: null, creator: token, curve: token, gen: 2, launchId: 1, block: 1, logIndex: 0, graduatedBlock: null });

let tokenMeta: typeof import('../server/tokenMeta').tokenMeta;
let PICTURE_CACHE: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-meta-'));
  const file = join(dir, 'launch-meta.json.gz');
  const rows = [
    [CACHED, `ipfs://${SILGAR_CID}`, 'ok', 'cid', 'A Robinhood Chain Testnet launch.', IMAGE_CID, 'image/webp', '', 'https://x.com/silgar', '', ''],
    [NONE, '', 'none', '', '', '', '', '', '', '', ''],
  ];
  writeFileSync(file, gzipSync(JSON.stringify({ version: META_CACHE_VERSION, chainId: 46630, updatedAt: 1, rows })));
  process.env.LAUNCH_META_FILE = file;
  // nothing listens here: any RPC read fails fast (the cached answers must not need one)
  process.env.PRISM_RPC_URL = 'http://127.0.0.1:9';
  ({ tokenMeta } = await import('../server/tokenMeta'));
  ({ PICTURE_CACHE } = await import('../server/img'));
});

describe('a launch’s metadata when IPFS is down', () => {
  it('answers from the published cache, without the chain or IPFS', async () => {
    const body = await tokenMeta(CACHED, launch(CACHED));
    expect(body.status).toBe('ok');
    expect(body.image).toEqual({ cid: IMAGE_CID, mimeType: 'image/webp' });
    expect(body.links).toEqual({ x: 'https://x.com/silgar' });
    expect(body.verified).toBe('cid');
    expect((await tokenMeta(NONE, launch(NONE))).status).toBe('none');
  });

  it('only says "unavailable" for a launch PRISM has never read, and never throws', async () => {
    const body = await tokenMeta(UNKNOWN, launch(UNKNOWN));
    expect(body.status).toBe('unavailable');
    expect(body.image).toBeNull();
  }, 20_000);

  it('a test stock or unknown token has no metadata', async () => {
    expect((await tokenMeta(UNKNOWN, null)).status).toBe('none');
  });

  it('resized pictures are cached as immutable', () => {
    expect(PICTURE_CACHE).toContain('immutable');
    expect(PICTURE_CACHE).toContain('s-maxage=31536000');
  });
});
