/**
 * ffmpeg / ffprobe for the video scripts: the copies Remotion ships with its compositor
 * (so nothing extra has to be installed), else whatever is on PATH.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

function compositorDir() {
  const arch = process.arch;
  const candidates =
    process.platform === 'win32'
      ? ['@remotion/compositor-win32-x64-msvc']
      : process.platform === 'darwin'
        ? [`@remotion/compositor-darwin-${arch}`]
        : [`@remotion/compositor-linux-${arch}-gnu`, `@remotion/compositor-linux-${arch}-musl`];
  for (const pkg of candidates) {
    try {
      return dirname(require.resolve(`${pkg}/package.json`));
    } catch {
      /* not installed for this platform */
    }
  }
  return null;
}

/** Absolute path of a bundled binary ('ffmpeg' | 'ffprobe'), or the bare name for PATH. */
export function binary(name) {
  const dir = compositorDir();
  if (dir && existsSync(join(dir, exe(name)))) return join(dir, exe(name));
  return name;
}

/**
 * Decode any audio (or the audio of a video) to interleaved float samples at `rate`.
 * Remotion's ffmpeg build has no raw-PCM muxer, so this asks for 16-bit WAV on stdout and
 * reads past its header (piped WAVs carry placeholder sizes, so find the "data" chunk).
 */
export function decodePcm(file, { channels = 1, rate = 48000 } = {}) {
  const wav = execFileSync(binary('ffmpeg'), ['-v', 'error', '-i', file, '-vn', '-ac', String(channels), '-ar', String(rate), '-acodec', 'pcm_s16le', '-f', 'wav', '-'], {
    maxBuffer: 1 << 30,
  });
  const data = wav.indexOf('data', 12) + 8;
  const n = Math.floor((wav.length - data) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(data + i * 2) / 32768;
  return out;
}
