/**
 * Renders the PRISM explainer into apps/web/public/media/:
 *   prism-explainer.mp4         16:9 1920×1080, H.264 + AAC   (site)
 *   prism-explainer.webm        16:9 1920×1080, VP9 + Opus    (site)
 *   prism-explainer-poster.jpg  16:9 poster frame             (site)
 *   prism-explainer-square.mp4  1:1 1080×1080, H.264 + AAC    (X)
 * First it (re)generates the soundtrack (scripts/soundtrack.ts: music + synced effects,
 * plus apps/video/voiceover.mp3 if present). Every video must stay under 8 MB: if one
 * comes out bigger it is re-encoded with a higher CRF (smaller file) until it fits. At
 * the end every file's audio is checked against the soundtrack for sync.
 *
 *   npm run video:render                 (everything)
 *   npm run video:render -- webm         (only the files whose name contains "webm")
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { checkSync } from './check-sync.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../web/public/media');
const MAX_BYTES = 8 * 1024 * 1024;
const AUDIO = { h264: { audioCodec: 'aac', audioBitrate: '128k' }, vp9: { audioCodec: 'opus', audioBitrate: '96k' } };
const POSTER_FRAME = 400; // "One crystal. Your whole basket."
const chromiumOptions = { gl: 'angle' };

mkdirSync(out, { recursive: true });
const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

console.log('Generating the soundtrack…');
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
execFileSync(process.execPath, [tsx, resolve(here, 'soundtrack.ts')], { stdio: 'inherit' });

console.log('Bundling…');
const serveUrl = await bundle({ entryPoint: resolve(here, '../src/index.ts') });

const only = process.argv[2];
const wanted = (file) => !only || file.includes(only);

async function video(id, file, codec, crfs) {
  const composition = await selectComposition({ serveUrl, id, chromiumOptions });
  const outputLocation = join(out, file);
  for (const crf of crfs) {
    const started = Date.now();
    const render = (concurrency) =>
      renderMedia({
        composition,
        serveUrl,
        codec,
        crf,
        outputLocation,
        ...AUDIO[codec],
        // standard limited-range BT.709 (the default came out full-range "yuvj420p", which
        // some browsers' hardware decoders show as a black picture)
        colorSpace: 'bt709',
        pixelFormat: 'yuv420p',
        x264Preset: codec === 'h264' ? 'slow' : undefined,
        chromiumOptions,
        concurrency,
        onProgress: ({ progress }) => process.stdout.write(`\r${file} crf ${crf}: ${Math.round(progress * 100)}%   `),
      });
    try {
      await render(null);
    } catch (e) {
      // the headless browser occasionally dies mid-render ("Target closed"); retry gently
      console.log(`\n${file}: render failed (${String(e?.message ?? e).split('\n')[0]}), retrying with 2 workers…`);
      await render(2);
    }
    const size = statSync(outputLocation).size;
    console.log(`\r${file} crf ${crf}: ${mb(size)} in ${Math.round((Date.now() - started) / 1000)}s`);
    if (size <= MAX_BYTES) return size;
  }
  throw new Error(`${file} is still over ${mb(MAX_BYTES)}`);
}

const sizes = {};
const JOBS = [
  ['Explainer', 'prism-explainer.mp4', 'h264', [26, 30, 34]],
  ['ExplainerSquare', 'prism-explainer-square.mp4', 'h264', [26, 30, 34]],
  ['Explainer', 'prism-explainer.webm', 'vp9', [36, 42, 48]],
];
for (const [id, file, codec, crfs] of JOBS) if (wanted(file)) sizes[file] = await video(id, file, codec, crfs);

if (wanted('prism-explainer-poster.jpg')) {
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
}

console.log('\nDone:');
for (const [f, s] of Object.entries(sizes)) console.log(`  ${f.padEnd(30)} ${mb(s)}`);

console.log('\nAudio/video sync:');
const rendered = ['prism-explainer.mp4', 'prism-explainer.webm', 'prism-explainer-square.mp4'].map((f) => join(out, f));
if (!checkSync(rendered)) {
  console.error('A video is out of sync (see above).');
  process.exit(1);
}
