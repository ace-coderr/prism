/**
 * After a render: checks each video's audio against the soundtrack WAV it was made from.
 * - streams: audio and video both start at 0 and last the same 40 s;
 * - sync: around every scripted effect (card whooshes, cube lock, crack, trust ticks, end
 *   chime) the decoded audio is cross-correlated with the WAV; the lag must stay under one
 *   frame (33 ms).
 *
 *   node scripts/check-sync.mjs [video …]   (render.mjs runs it automatically)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binary, decodePcm } from './ffmpeg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AUDIO = resolve(here, '../public/audio');
const MEDIA = resolve(here, '../../web/public/media');
const SR = 48000;
const FRAME_MS = 1000 / 30;

/** Mono float PCM at 48 kHz of any media file. */
const pcm = (file) => decodePcm(file, { channels: 1, rate: SR });

/** 1 ms absolute-amplitude envelope. */
function envelope(x) {
  const step = SR / 1000;
  const out = new Float32Array(Math.floor(x.length / step));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) s += Math.abs(x[i * step + k]);
    out[i] = s / step;
  }
  return out;
}

/** Best lag (ms) of `b` against `a` around `t` (s), searching ±120 ms. */
function lagAt(a, b, t) {
  const from = Math.round(t * 1000) - 250;
  const to = Math.round(t * 1000) + 350;
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -120; lag <= 120; lag++) {
    let s = 0;
    for (let i = from; i < to; i++) s += (a[i] ?? 0) * (b[i + lag] ?? 0);
    if (s > bestScore) {
      bestScore = s;
      best = lag;
    }
  }
  return best;
}

/** Streams, with each one's duration (WebM keeps it on the file, not per stream). */
function streams(file) {
  const out = execFileSync(binary('ffprobe'), [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,start_time,duration,sample_rate,bit_rate:format=duration',
    '-of', 'json', file,
  ]).toString();
  const { streams: list, format } = JSON.parse(out);
  return list.map((x) => ({ ...x, duration: Number.isFinite(Number(x.duration)) ? Number(x.duration) : Number(format.duration) }));
}

export function checkSync(files) {
  const reference = envelope(pcm(join(AUDIO, 'soundtrack.wav')));
  const ev = JSON.parse(readFileSync(join(AUDIO, 'events.json'), 'utf8'));
  const times = [...ev.cards, ev.lock, ev.crack, ...ev.trust, ev.end];
  let ok = true;
  for (const file of files) {
    const s = streams(file);
    const v = s.find((x) => x.codec_type === 'video');
    const a = s.find((x) => x.codec_type === 'audio');
    if (!a) {
      console.log(`  ${file}: NO AUDIO STREAM`);
      ok = false;
      continue;
    }
    const decoded = envelope(pcm(file));
    const lags = times.map((t) => lagAt(reference, decoded, t));
    const worst = Math.max(...lags.map(Math.abs));
    const durDiff = Math.abs(Number(a.duration) - Number(v.duration)) * 1000;
    const pass = worst < FRAME_MS && Number(a.start_time) <= 0.03 && Number(v.start_time) <= 0.03 && durDiff < FRAME_MS * 1.5;
    ok &&= pass;
    console.log(
      `  ${file.split(/[\\/]/).pop()}: ${pass ? 'in sync' : 'OUT OF SYNC'} · video ${v.codec_name} ${Number(v.duration).toFixed(2)}s from ${v.start_time}` +
        ` · audio ${a.codec_name} ${a.sample_rate} Hz ${a.bit_rate ? Math.round(a.bit_rate / 1000) + ' kb/s ' : ''}${Number(a.duration).toFixed(2)}s from ${a.start_time}` +
        ` · effect lags (ms) ${lags.join(', ')} (worst ${worst} ms)`,
    );
  }
  return ok;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  const list = files.length ? files : ['prism-explainer.mp4', 'prism-explainer.webm', 'prism-explainer-square.mp4'].map((f) => join(MEDIA, f));
  process.exit(checkSync(list) ? 0 : 1);
}
