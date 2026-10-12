/**
 * GET /img/t/<address>.png?s=96 (rewritten to /api/img?token=…&s=…): a token's picture, small
 * and square. The picture is the one in the launch's own metadata (from /api/meta, CDN-cached),
 * fetched from IPFS and checked against its CID, then centre-cropped, resized and served as PNG.
 * No picture, a broken file or anything that isn't an image: the token's identicon instead.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getAddress, isAddress, type Address } from 'viem';
import { IpfsError, MAX_IMAGE_BYTES, fetchIpfs, identiconSvg } from '@prism/core';
import { originOf } from './og';
import { coverSquare, encodePng, type Rgba } from './png';
import { renderPng, renderRgba } from './render';
import type { MetaBody } from './tokenMeta';

export const IMAGE_SIZES = [48, 96, 192, 384] as const;
const here = dirname(fileURLToPath(import.meta.url));

let webp: Promise<(b: ArrayBuffer) => Promise<Rgba>> | null = null;
/** libwebp's decoder (WebAssembly): the wasm sits next to the bundled function, or in node_modules in development. */
function webpDecoder() {
  webp ??= (async () => {
    (globalThis as { ImageData?: unknown }).ImageData ??= class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    };
    const { default: decode, init } = await import('@jsquash/webp/decode.js');
    const local = join(here, 'webp_dec.wasm');
    const wasm = existsSync(local) ? local : createRequire(import.meta.url).resolve('@jsquash/webp/codec/dec/webp_dec.wasm');
    await init(await WebAssembly.compile(readFileSync(wasm)));
    return decode as unknown as (b: ArrayBuffer) => Promise<Rgba>;
  })();
  return webp;
}

/** The picture's pixels, whatever the format (WebP via libwebp; PNG, JPEG and GIF via resvg). */
async function decode(bytes: Uint8Array, mimeType: string): Promise<Rgba> {
  if (mimeType === 'image/webp') return (await webpDecoder())(bytes.slice().buffer);
  // resvg draws PNG / JPEG / GIF inside an SVG; render it at its own size, then crop and resize like the rest
  const b64 = Buffer.from(bytes).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><image width="512" height="512" preserveAspectRatio="xMidYMid slice" href="data:${mimeType};base64,${b64}"/></svg>`;
  return renderRgba(svg);
}

async function getMeta(origin: string, token: Address): Promise<MetaBody | null> {
  try {
    const res = await fetch(`${origin}/api/meta?token=${token}`, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? ((await res.json()) as MetaBody) : null;
  } catch {
    return null;
  }
}

/** The PNG to serve and how long it may be cached. */
export async function tokenPicture(origin: string, token: Address, size: number): Promise<{ png: Uint8Array; cache: string; source: 'metadata' | 'identicon' }> {
  const identicon = async (cache: string) => ({ png: await renderPng(identiconSvg(token, size)), cache, source: 'identicon' as const });
  const meta = await getMeta(origin, token);
  if (!meta || meta.status === 'unavailable') return identicon('public, max-age=60, s-maxage=120');
  if (!meta.image) return identicon('public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  try {
    const file = await fetchIpfs(meta.image.cid, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 15_000 });
    const pixels = await decode(file.bytes, meta.image.mimeType);
    if (!pixels.width || !pixels.height) throw new IpfsError('Not an image.', true);
    // content-addressed and checked against its CID: it never changes
    return { png: encodePng(coverSquare(pixels, size)), cache: 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=31536000', source: 'metadata' };
  } catch (e) {
    const permanent = !(e instanceof IpfsError) || e.permanent;
    return identicon(permanent ? 'public, max-age=3600, s-maxage=86400' : 'public, max-age=60, s-maxage=120');
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const raw = url.searchParams.get('token') ?? /^\/img\/t\/(0x[0-9a-fA-F]{40})\.png$/.exec(url.pathname)?.[1] ?? '';
  if (!isAddress(raw, { strict: false })) {
    res.statusCode = 400;
    res.end('token must be a 0x address');
    return;
  }
  const want = Number.parseInt(url.searchParams.get('s') ?? '96', 10);
  const size = IMAGE_SIZES.find((s) => s >= want) ?? IMAGE_SIZES.at(-1)!;
  const token = getAddress(raw.toLowerCase());
  const pic = await tokenPicture(originOf(req), token, size).catch(async () => ({
    png: await renderPng(identiconSvg(token, size)),
    cache: 'public, max-age=60, s-maxage=120',
    source: 'identicon' as const,
  }));
  res.statusCode = 200;
  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', pic.cache);
  res.setHeader('x-prism-image', pic.source);
  res.end(req.method === 'HEAD' ? undefined : Buffer.from(pic.png));
}
