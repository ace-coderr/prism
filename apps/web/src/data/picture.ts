/**
 * A token's picture, ready to show: fetched from whichever IPFS gateway answers first, checked
 * against its CID, centre-cropped and shrunk to the size it is shown at. This is what the server's
 * image route used to do for every visitor; now each visitor's own browser does it, once per picture
 * and size, and the result is kept for the session.
 *
 * At most FETCHES gateway reads run at once, so a page of twenty tokens doesn't ask the public
 * gateways for twenty pictures (times four) in the same second.
 */
import { MAX_IMAGE_BYTES, fetchIpfs } from '@prism/core';

const FETCHES = 4;
let running = 0;
const waiting: Array<() => void> = [];
async function turn<T>(job: () => Promise<T>): Promise<T> {
  if (running >= FETCHES) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Verified file bytes by CID, so each size of a token's picture reuses one fetch. */
const files = new Map<string, Promise<Uint8Array>>();
function file(cid: string): Promise<Uint8Array> {
  let p = files.get(cid);
  if (!p) {
    p = turn(() => fetchIpfs(cid, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 20_000, staggerMs: 1_200 })).then((f) => f.bytes);
    p.catch(() => files.delete(cid));
    files.set(cid, p);
    if (files.size > 60) files.delete(files.keys().next().value!);
  }
  return p;
}

const urls = new Map<string, Promise<string>>();

/** An object URL for `cid` as a square of `px` pixels. Rejects when no gateway serves a file that matches its CID. */
export function pictureUrl(cid: string, mimeType: string, px: number): Promise<string> {
  const key = `${cid}:${px}`;
  let p = urls.get(key);
  if (!p) {
    p = (async () => {
      const bytes = await file(cid);
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }));
      try {
        const side = Math.min(bitmap.width, bitmap.height);
        if (!side) throw new Error('Not an image.');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = px;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No canvas.');
        ctx.imageSmoothingQuality = 'high';
        // the middle square of the picture, as the server's resize did
        ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px);
        const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 0.85));
        if (!blob) throw new Error('Could not draw it.');
        return URL.createObjectURL(blob);
      } finally {
        bitmap.close();
      }
    })();
    p.catch(() => urls.delete(key));
    urls.set(key, p);
  }
  return p;
}
