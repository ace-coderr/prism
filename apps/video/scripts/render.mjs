/**
 * Renders the PRISM explainer into apps/web/public/media/:
 *   prism-explainer.mp4         16:9 1920×1080, H.264  (site)
 *   prism-explainer.webm        16:9 1920×1080, VP9    (site)
 *   prism-explainer-poster.jpg  16:9 poster frame      (site)
 *   prism-explainer-square.mp4  1:1 1080×1080, H.264   (X)
 * Every video must stay under 6 MB: if one comes out bigger it is re-encoded with a
 * higher CRF (smaller file) until it fits.
 *
 *   npm run video:render
 */
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../web/public/media');
const MAX_BYTES = 6 * 1024 * 1024;
const POSTER_FRAME = 400; // "One crystal. Your whole basket."
const chromiumOptions = { gl: 'angle' };

mkdirSync(out, { recursive: true });
const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

console.log('Bundling…');
const serveUrl = await bundle({ entryPoint: resolve(here, '../src/index.ts') });

async function video(id, file, codec, crfs) {
  const composition = await selectComposition({ serveUrl, id, chromiumOptions });
  const outputLocation = join(out, file);
  for (const crf of crfs) {
    const started = Date.now();
    await renderMedia({
      composition,
      serveUrl,
      codec,
      crf,
      outputLocation,
      muted: true,
      pixelFormat: codec === 'h264' ? 'yuv420p' : undefined,
      x264Preset: codec === 'h264' ? 'slow' : undefined,
      chromiumOptions,
      onProgress: ({ progress }) => process.stdout.write(`\r${file} crf ${crf}: ${Math.round(progress * 100)}%   `),
    });
    const size = statSync(outputLocation).size;
    console.log(`\r${file} crf ${crf}: ${mb(size)} in ${Math.round((Date.now() - started) / 1000)}s`);
    if (size <= MAX_BYTES) return size;
  }
  throw new Error(`${file} is still over ${mb(MAX_BYTES)}`);
}

const sizes = {};
sizes['prism-explainer.mp4'] = await video('Explainer', 'prism-explainer.mp4', 'h264', [26, 30, 34]);
sizes['prism-explainer-square.mp4'] = await video('ExplainerSquare', 'prism-explainer-square.mp4', 'h264', [26, 30, 34]);
sizes['prism-explainer.webm'] = await video('Explainer', 'prism-explainer.webm', 'vp9', [36, 42, 48]);

const poster = await selectComposition({ serveUrl, id: 'Explainer', chromiumOptions });
await renderStill({
  composition: poster,
  serveUrl,
  frame: POSTER_FRAME,
  output: join(out, 'prism-explainer-poster.jpg'),
  imageFormat: 'jpeg',
  jpegQuality: 82,
  chromiumOptions,
});
sizes['prism-explainer-poster.jpg'] = statSync(join(out, 'prism-explainer-poster.jpg')).size;

console.log('\nDone:');
for (const [f, s] of Object.entries(sizes)) console.log(`  ${f.padEnd(30)} ${mb(s)}`);
