/**
 * Generates PRISM's brand images into apps/web/public from the shared mark (packages/core/src/brand.ts)
 * and the share-card art (server/svg.ts). Re-run after changing either:
 *
 *   npm run brand -w @prism/web
 *
 * - favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png (180), icon-192.png, icon-512.png
 * - og.jpg (1200×630, JPEG for the apps whose previews mishandle transparency): the site's share card
 * - brand/x/prism-x-avatar.png (400×400): the mark, well inside X's circle crop
 * - brand/x/prism-x-banner.png (1500×500): the X header, clear of the bottom-left avatar area
 * - brand/privy-logo.png (360×180): the logo in Privy's login modal and login emails
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PALETTE, markShapes, markSvg } from '@prism/core';
import { renderPng, renderRgba } from '../server/render';
import { GROTESK, MONO, siteCardSvg } from '../server/svg';

const out = join(dirname(fileURLToPath(import.meta.url)), '../public');
const write = (path: string, data: Uint8Array | string) => {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), data);
  console.log('wrote', path);
};
const { ink: INK, panel: PANEL, white: WHITE, lime: LIME, mist: MIST } = PALETTE;

/** An ICO holding PNG images (supported everywhere that matters). */
function ico(images: Array<{ size: number; png: Uint8Array }>): Uint8Array {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => Buffer.from(i.png))]);
}

const tile = (size: number) => markSvg(size, { tile: true });

// tab icons: the gem on its own (its dark outline reads on light and dark tab bars); app icons: on a tile
write('favicon.svg', markSvg(64));
write('favicon.ico', ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await renderPng(markSvg(size)) })))));
write('apple-touch-icon.png', await renderPng(tile(180)));
write('icon-192.png', await renderPng(tile(192)));
write('icon-512.png', await renderPng(tile(512)));

const card = await renderRgba(siteCardSvg());
write('og.jpg', jpeg.encode({ data: Buffer.from(card.data), width: card.width, height: card.height }, 88).data);

write(
  'brand/x/prism-x-avatar.png',
  await renderPng(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="${INK}"/>
<svg x="70" y="70" width="260" height="260" viewBox="0 0 64 64">${markShapes()}</svg>
</svg>`),
);

write(
  'brand/x/prism-x-banner.png',
  await renderPng(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500">
<rect width="1500" height="500" fill="${INK}"/>
<svg x="1150" y="100" width="300" height="300" viewBox="0 0 64 64">${markShapes()}</svg>
<text x="480" y="200" font-family="${GROTESK}" font-weight="700" font-size="70" letter-spacing="-2.5" fill="${WHITE}">See every launch’s</text>
<text x="480" y="284" font-family="${GROTESK}" font-weight="700" font-size="70" letter-spacing="-2.5" fill="${LIME}">true colors</text>
<text x="482" y="340" font-family="${MONO}" font-size="24" fill="${MIST}">Holder-only reviews · seeprism.xyz</text>
</svg>`),
);

write(
  'brand/privy-logo.png',
  await renderPng(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180" viewBox="0 0 360 180">
<rect width="360" height="180" rx="28" fill="${PANEL}"/>
<svg x="42" y="50" width="80" height="80" viewBox="0 0 64 64">${markShapes()}</svg>
<text x="136" y="108" font-family="${GROTESK}" font-weight="700" font-size="56" letter-spacing="-1.5" fill="${WHITE}">PRISM</text>
</svg>`),
);
