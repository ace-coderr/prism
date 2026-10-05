/**
 * The PRISM explainer soundtrack, made entirely in code: no samples, loops or tracks from
 * anywhere else. Every sound is synthesised here (oscillators, filtered noise, a simple
 * reverb and delay), and every effect is placed from the same timeline the picture uses
 * (src/timeline.ts, src/shape.ts), so it lands on its frame.
 *
 *   npm run audio -w @prism/video        (also runs before `studio` and `render`)
 *
 * Writes public/audio/soundtrack.wav: 48 kHz, 16-bit stereo, exactly 40 s.
 *
 * Music: A minor, 96 BPM (16 bars = 40 s). A dark pad and sub open; a filtered arpeggio
 * joins at the token cards; kick, hats and a riser build through the Forge scene; at the
 * market drop the beat stops and the harmony turns tense; when gold fills the crack it
 * lifts into a warm F major; the gift is airy; the trust lines bring the pulse back; the
 * call to action lands on a clean C major chord that rings out. Mixed quietly.
 *
 * Voiceover later: put an MP3 at apps/video/voiceover.mp3 (starting at 0:00). It is
 * decoded with Remotion's bundled ffmpeg, mixed on top, and the music ducks under it.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DROP, DURATION, EASE_BEZIER, FPS, HOLDINGS, T } from '../src/timeline';
import { crystalCells, landsAt } from '../src/shape';
// @ts-expect-error plain ESM helper without types
import { decodePcm } from './ffmpeg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/audio/soundtrack.wav');
const VOICEOVER = resolve(here, '../voiceover.mp3');

const SR = 48000;
const SECONDS = DURATION / FPS; // 40
const N = Math.round(SR * SECONDS);
const sec = (frame: number) => frame / FPS;
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const db = (d: number) => 10 ** (d / 20);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ building blocks

/** Deterministic noise (xorshift): the same file every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

class Track {
  L = new Float32Array(N);
  R = new Float32Array(N);
  add(i: number, l: number, r: number) {
    if (i < 0 || i >= N) return;
    this.L[i] += l;
    this.R[i] += r;
  }
  mix(o: Track, g = 1) {
    for (let i = 0; i < N; i++) {
      this.L[i] += o.L[i]! * g;
      this.R[i] += o.R[i]! * g;
    }
  }
  scale(g: number | ((i: number) => number)) {
    for (let i = 0; i < N; i++) {
      const k = typeof g === 'number' ? g : g(i);
      this.L[i] *= k;
      this.R[i] *= k;
    }
  }
}

/** Equal-power pan, p in -1..1. */
const panLR = (p: number): [number, number] => [Math.cos(((clamp(p, -1, 1) + 1) * Math.PI) / 4), Math.sin(((clamp(p, -1, 1) + 1) * Math.PI) / 4)];

/** RBJ biquad (low-pass / high-pass / band-pass). */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private type: 'lp' | 'hp' | 'bp',
    f = 1000,
    q = 0.707,
  ) {
    this.set(f, q);
  }
  set(f: number, q = 0.707) {
    const w = (TAU * clamp(f, 10, SR * 0.45)) / SR;
    const c = Math.cos(w);
    const a = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (this.type === 'lp') [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (this.type === 'hp') [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else [b0, b1, b2] = [a, 0, -a];
    const a0 = 1 + a;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - a) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Band-limited saw (polyBLEP). */
function polyblep(t: number, dt: number) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Piecewise-linear automation through [time, value] points. */
function curve(points: Array<[number, number]>) {
  return (t: number) => {
    if (t <= points[0]![0]) return points[0]![1];
    for (let k = 1; k < points.length; k++) {
      const [t1, v1] = points[k]!;
      if (t <= t1) {
        const [t0, v0] = points[k - 1]!;
        return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-9, t1 - t0);
      }
    }
    return points[points.length - 1]![1];
  };
}

/** The picture's easing, cubic-bezier(0.2, 0.8, 0.2, 1), and its inverse in frames. */
function bezier([x1, y1, x2, y2]: readonly [number, number, number, number]) {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < x) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}
const ease = bezier(EASE_BEZIER);
/** The frame (fractional) at which prog(f, a, b) first reaches p. */
function frameAt([a, b]: readonly [number, number], p: number) {
  let lo = a;
  let hi = b;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (ease((mid - a) / (b - a)) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Freeverb-style stereo reverb. */
function reverb(input: Track, { room = 0.86, damp = 0.35, wet = 1 } = {}) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const alls = [556, 441, 341, 225];
  const out = new Track();
  for (const [ch, spread] of [
    ['L', 0],
    ['R', 23],
  ] as const) {
    const src = input[ch];
    const dst = out[ch];
    const cb = combs.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0, store: 0 }));
    const ab = alls.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = src[n]! * 0.015;
      let s = 0;
      for (const c of cb) {
        const y = c.buf[c.i]!;
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        s += y;
      }
      for (const a of ab) {
        const b = a.buf[a.i]!;
        a.buf[a.i] = s + b * 0.5;
        s = b - s;
        a.i = (a.i + 1) % a.buf.length;
      }
      dst[n] = s * wet;
    }
  }
  return out;
}

/** Ping-pong delay (dotted eighths at 96 BPM). */
function pingPong(input: Track, time = 0.46875, feedback = 0.38, wet = 0.32) {
  const d = Math.round(time * SR);
  const out = new Track();
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const lp = new Biquad('lp', 3500);
  for (let n = 0; n < N; n++) {
    const k = n % d;
    const yl = bl[k]!;
    const yr = br[k]!;
    bl[k] = lp.run((input.L[n]! + input.R[n]!) * 0.5) + yr * feedback;
    br[k] = yl * feedback;
    out.L[n] = input.L[n]! + yl * wet;
    out.R[n] = input.R[n]! + yr * wet;
  }
  return out;
}

const rms = (t: Track, from = 0, to = N) => {
  let s = 0;
  for (let i = from; i < to; i++) s += (t.L[i]! ** 2 + t.R[i]! ** 2) / 2;
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (t: Track) => {
  let p = 0;
  for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(t.L[i]!), Math.abs(t.R[i]!));
  return p;
};
const at = (seconds: number) => Math.round(seconds * SR);

// ------------------------------------------------------------------ music

const BEAT = 60 / 96; // 0.625 s
const EIGHTH = BEAT / 2;

const CHORD = {
  Am7: { notes: [57, 60, 64, 67], root: 33 },
  Fmaj7: { notes: [53, 57, 60, 64], root: 29 },
  Cadd9: { notes: [55, 60, 62, 64], root: 36 },
  G6: { notes: [55, 59, 62, 64], root: 31 },
  tension: { notes: [58, 62, 65, 69], root: 33 }, // B♭ over an A pedal: the drop
  Fadd9: { notes: [53, 57, 60, 67], root: 29 }, // the warm lift as gold fills
  final: { notes: [48, 55, 60, 62, 64, 67], root: 36 },
};
type Chord = (typeof CHORD)[keyof typeof CHORD];

const DROP_T = sec(T.crack[0]); // 22.0 s
const LIFT_T = sec(T.heal[0]); // 24.5 s
const END_T = sec(T.end); // 36.0 s
const PROGRESSION: Array<{ t0: number; t1: number; c: Chord }> = [
  { t0: 0, t1: 5, c: CHORD.Am7 },
  { t0: 5, t1: 7.5, c: CHORD.Fmaj7 },
  { t0: 7.5, t1: 10, c: CHORD.Cadd9 },
  { t0: 10, t1: 12.5, c: CHORD.Am7 },
  { t0: 12.5, t1: 15, c: CHORD.Fmaj7 },
  { t0: 15, t1: 17.5, c: CHORD.Cadd9 },
  { t0: 17.5, t1: 20, c: CHORD.G6 },
  { t0: 20, t1: DROP_T - 0.1, c: CHORD.Am7 },
  { t0: DROP_T - 0.1, t1: LIFT_T, c: CHORD.tension },
  { t0: LIFT_T, t1: 27.5, c: CHORD.Fadd9 },
  { t0: 27.5, t1: 30, c: CHORD.Cadd9 },
  { t0: 30, t1: 32.5, c: CHORD.G6 },
  { t0: 32.5, t1: 35, c: CHORD.Fmaj7 },
  { t0: 35, t1: END_T, c: CHORD.G6 },
  { t0: END_T, t1: SECONDS, c: CHORD.final },
];

/** Dark detuned saw pad, low-passed with the arrangement's brightness curve. */
function pad() {
  const raw = new Track();
  const r = rng(11);
  const detune = [-0.07, 0, 0.07];
  const pans = [-0.55, 0, 0.55];
  for (const seg of PROGRESSION) {
    const attack = seg.t0 === 0 ? 2.2 : seg.c === CHORD.tension ? 0.15 : 0.35;
    const release = seg.c === CHORD.final ? 3.2 : 0.7;
    const i0 = at(seg.t0);
    const i1 = Math.min(N, at(seg.t1 + release));
    for (const m of seg.c.notes) {
      detune.forEach((dt, v) => {
        const f = midiHz(m + dt);
        const [pl, pr] = panLR(pans[v]!);
        let ph = r();
        const inc = f / SR;
        for (let i = i0; i < i1; i++) {
          const t = (i - i0) / SR;
          const held = seg.t1 - seg.t0;
          const env = t < attack ? t / attack : t < held ? 1 : Math.max(0, 1 - (t - held) / release);
          ph += inc;
          if (ph >= 1) ph -= 1;
          const s = (2 * ph - 1 - polyblep(ph, inc)) * env * 0.05;
          raw.add(i, s * pl, s * pr);
        }
      });
    }
  }
  const cutoff = curve([
    [0, 420], [5, 650], [8.5, 900], [12.5, 1500], [15, 2700], [20, 2100], [DROP_T - 0.15, 1900],
    [DROP_T + 0.5, 320], [LIFT_T - 0.05, 420], [LIFT_T + 0.9, 3000], [27.5, 2300], [32.5, 1900], [35.8, 2700], [40, 1300],
  ]);
  const level = curve([
    [0, 0], [2.5, 0.9], [8.5, 1], [15, 1.1], [DROP_T, 1], [DROP_T + 0.6, 0.62], [LIFT_T, 0.7], [LIFT_T + 0.9, 1.15],
    [27.5, 0.95], [END_T, 1.05], [38.6, 0.55], [39.7, 0],
  ]);
  const fl = new Biquad('lp');
  const fr = new Biquad('lp');
  const out = new Track();
  for (let i = 0; i < N; i++) {
    if (i % 32 === 0) {
      const c = cutoff(i / SR);
      fl.set(c, 0.9);
      fr.set(c, 0.9);
    }
    const g = level(i / SR);
    out.L[i] = fl.run(raw.L[i]!) * g;
    out.R[i] = fr.run(raw.R[i]!) * g;
  }
  return out;
}

/** Sub bass on each chord root; sinks a semitone under the drop. */
function sub() {
  const out = new Track();
  let ph = 0;
  const level = curve([[0, 0], [4.6, 0], [5.6, 0.85], [DROP_T, 0.9], [DROP_T + 2.2, 0.75], [LIFT_T + 0.3, 0.9], [END_T, 1], [39, 0.4], [39.7, 0]]);
  const rootAt = (t: number) => PROGRESSION.find((s) => t >= s.t0 && t < s.t1)?.c.root ?? 33;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let m = rootAt(t);
    if (t >= DROP_T && t < LIFT_T) m -= clamp((t - DROP_T) / 1.6, 0, 1); // the floor gives way
    ph += midiHz(m) / SR;
    const s = (Math.sin(TAU * ph) + 0.18 * Math.sin(2 * TAU * ph)) * 0.16 * level(t);
    out.L[i] = s;
    out.R[i] = s;
  }
  return out;
}

/** Plucked arpeggio (eighths; sixteenths at the height of the build), through a ping-pong delay. */
function arp() {
  const out = new Track();
  const r = rng(23);
  const sections: Array<{ t0: number; t1: number; gain: number; oct: number; bright: number; every?: number; sixteenths?: boolean }> = [
    { t0: 4.7, t1: 8.5, gain: 0.32, oct: 12, bright: 900 },
    { t0: 8.5, t1: 12.5, gain: 0.5, oct: 12, bright: 1500 },
    { t0: 12.5, t1: 15, gain: 0.6, oct: 12, bright: 2600, sixteenths: true },
    { t0: 15, t1: DROP_T - 0.15, gain: 0.55, oct: 12, bright: 2200 },
    { t0: LIFT_T + 0.15, t1: 27.5, gain: 0.6, oct: 24, bright: 3200 },
    { t0: 27.5, t1: 32.5, gain: 0.38, oct: 24, bright: 2600, every: 2 },
    { t0: 32.5, t1: END_T - 0.05, gain: 0.5, oct: 12, bright: 2400 },
  ];
  for (const sec_ of sections) {
    const step = sec_.sixteenths ? EIGHTH / 2 : EIGHTH;
    let k = 0;
    for (let t = Math.ceil(sec_.t0 / step) * step; t < sec_.t1; t += step, k++) {
      if (sec_.every && k % sec_.every) continue;
      const chord = PROGRESSION.find((s) => t >= s.t0 && t < s.t1)?.c ?? CHORD.Am7;
      const order = [0, 1, 2, 3, 2, 1];
      const m = chord.notes[order[k % order.length]! % chord.notes.length]! + sec_.oct;
      const f = midiHz(m);
      const [pl, pr] = panLR(k % 2 ? 0.35 : -0.35);
      const lp = new Biquad('lp');
      const i0 = at(t);
      const len = at(0.32);
      let ph = r();
      const vel = 0.8 + 0.2 * r();
      for (let n = 0; n < len; n++) {
        const tt = n / SR;
        const env = Math.min(1, tt / 0.003) * Math.exp(-tt / 0.11);
        if (n % 16 === 0) lp.set(sec_.bright * (0.6 + 2.2 * Math.exp(-tt / 0.06)), 1.4);
        ph += f / SR;
        if (ph >= 1) ph -= 1;
        const saw = 2 * ph - 1 - polyblep(ph, f / SR);
        const pulse = ph < 0.5 ? 1 : -1;
        const s = lp.run(0.6 * saw + 0.4 * pulse) * env * 0.11 * sec_.gain * vel;
        out.add(i0 + n, s * pl, s * pr);
      }
    }
  }
  return pingPong(out);
}

/** Soft four-on-the-floor kick (+ the envelope the pad and sub pump to) and off-beat hats. */
function drums() {
  const out = new Track();
  const pump = new Float32Array(N);
  const kicks: number[] = [];
  const beats = (a: number, b: number, every = 1) => {
    for (let t = Math.ceil(a / BEAT) * BEAT; t < b - 1e-6; t += BEAT * every) kicks.push(t);
  };
  beats(10, DROP_T - 0.05);
  beats(LIFT_T + 0.625, 27.5, 2); // half-time under the warm lift
  beats(32.5, END_T - 0.05);
  kicks.push(END_T); // lands with the call to action
  for (const t of kicks) {
    const i0 = at(t);
    let ph = 0;
    const r = rng(Math.round(t * 1000));
    for (let n = 0; n < at(0.42); n++) {
      const tt = n / SR;
      const f = 46 + 110 * Math.exp(-tt / 0.035);
      ph += f / SR;
      const s = Math.sin(TAU * ph) * Math.exp(-tt / 0.16) * 0.42 + (n < 140 ? (r() * 2 - 1) * 0.05 * (1 - n / 140) : 0);
      out.add(i0 + n, s, s);
      if (i0 + n < N) pump[i0 + n] = Math.max(pump[i0 + n]!, Math.exp(-tt / 0.12));
    }
  }
  const hats: number[] = [];
  const offbeats = (a: number, b: number) => {
    for (let t = Math.ceil(a / BEAT) * BEAT + EIGHTH; t < b - 1e-6; t += BEAT) hats.push(t);
  };
  offbeats(12.5, DROP_T - 0.05);
  offbeats(32.5, END_T - 0.05);
  const r = rng(5);
  for (const t of hats) {
    const hp = new Biquad('hp', 7500, 0.8);
    const i0 = at(t);
    for (let n = 0; n < at(0.06); n++) {
      const s = hp.run(r() * 2 - 1) * Math.exp(-n / SR / 0.018) * 0.05;
      out.add(i0 + n, s * 0.9, s);
    }
  }
  return { out, pump };
}

/** Noise risers into the build's peak and into the call to action. */
function risers() {
  const out = new Track();
  const r = rng(77);
  for (const [a, b, g] of [
    [12.6, 15.0, 0.12],
    [34.3, END_T, 0.09],
  ] as const) {
    const bp = new Biquad('bp');
    for (let i = at(a); i < at(b); i++) {
      const p = (i / SR - a) / (b - a);
      if (i % 32 === 0) bp.set(300 * (7000 / 300) ** p, 1.2);
      const s = bp.run(r() * 2 - 1) * p ** 2.2 * g;
      out.add(i, s * (1 - p * 0.3), s * (0.7 + p * 0.3));
    }
  }
  return out;
}

/** Under the drop: beating low drone and a breathing noise bed. */
function tension() {
  const out = new Track();
  const r = rng(99);
  const a = DROP_T - 0.1;
  const b = LIFT_T + 0.4;
  const lp = new Biquad('lp', 600, 0.9);
  const nl = new Biquad('lp', 900, 0.7);
  const ph = [0, 0, 0];
  const fs = [midiHz(45), midiHz(46.08), midiHz(33)];
  for (let i = at(a); i < at(b); i++) {
    const t = i / SR - a;
    const env = Math.min(1, t / 0.25) * clamp((b - a - t) / 0.6, 0, 1);
    let s = 0;
    fs.forEach((f, k) => {
      ph[k] = (ph[k]! + f / SR) % 1;
      s += (2 * ph[k]! - 1 - polyblep(ph[k]!, f / SR)) * (k === 2 ? 0.5 : 0.35);
    });
    const breath = nl.run(r() * 2 - 1) * (0.5 + 0.5 * Math.sin(TAU * 5.5 * t));
    const v = (lp.run(s) * 0.06 + breath * 0.05) * env;
    out.add(i, v, v);
  }
  return out;
}

// ------------------------------------------------------------------ sound effects

const sfx = new Track();
const sfxVerb = new Track();
const fxRand = rng(2024);

function place(t0: number, len: number, fn: (tt: number, n: number) => number, pan = 0, gain = 1, send = 0.15) {
  const [pl, pr] = panLR(pan);
  const i0 = at(t0);
  for (let n = 0; n < at(len); n++) {
    const s = fn(n / SR, n) * gain;
    sfx.add(i0 + n, s * pl, s * pr);
    sfxVerb.add(i0 + n, s * pl * send, s * pr * send);
  }
}

/** Filtered-noise whoosh sweeping fLo→fHi, panning p0→p1, peaking at `peakAt` of its length. */
function whoosh(t0: number, len: number, { fLo = 500, fHi = 2600, p0 = 0, p1 = 0, gain = 0.3, peakAt = 0.45, q = 1.1 } = {}) {
  const bp = new Biquad('bp');
  const r = rng(Math.round(t0 * 997));
  const i0 = at(t0);
  for (let n = 0; n < at(len); n++) {
    const p = n / at(len);
    if (n % 16 === 0) bp.set(fLo * (fHi / fLo) ** p, q);
    const env = p < peakAt ? Math.sin(((p / peakAt) * Math.PI) / 2) ** 2 : Math.cos((((p - peakAt) / (1 - peakAt)) * Math.PI) / 2) ** 2;
    const s = bp.run(r() * 2 - 1) * env * gain;
    const [pl, pr] = panLR(p0 + (p1 - p0) * p);
    sfx.add(i0 + n, s * pl, s * pr);
    sfxVerb.add(i0 + n, s * pl * 0.2, s * pr * 0.2);
  }
}

/** A small click: a bright ping with a noise tick. */
function click(t0: number, gain: number, pan: number, f = 3000) {
  place(t0, 0.03, (tt) => (Math.sin(TAU * f * tt) * Math.exp(-tt / 0.006) + (fxRand() * 2 - 1) * Math.exp(-tt / 0.0015) * 0.6) * gain, pan, 1, 0.08);
}

/** Inharmonic bell (for chimes). */
function bell(t0: number, midi: number, gain: number, pan = 0, decay = 1.4, send = 0.45) {
  const f = midiHz(midi);
  const partials: Array<[number, number, number]> = [
    [1, 1, decay],
    [2.0, 0.45, decay * 0.6],
    [3.01, 0.28, decay * 0.45],
    [4.18, 0.18, decay * 0.3],
    [5.43, 0.1, decay * 0.22],
  ];
  place(
    t0,
    decay * 3,
    (tt) => Math.min(1, tt / 0.002) * partials.reduce((s, [k, a, d]) => s + a * Math.sin(TAU * f * k * tt) * Math.exp(-tt / d), 0),
    pan,
    gain,
    send,
  );
}

// token cards slide up, one by one, left to right
for (let i = 0; i < 6; i++) whoosh(sec(T.cardIn(i)) - 0.02, 0.34, { fLo: 700, fHi: 2600, p0: -0.65 + (1.3 * i) / 5, p1: -0.65 + (1.3 * i) / 5, gain: 0.16, peakAt: 0.35 });
// the cards fly into the middle: two sweeps converging
const mergeT = sec(T.merge[0]);
const mergeLen = sec(T.merge[1] - T.merge[0]) + 0.35;
whoosh(mergeT, mergeLen, { fLo: 280, fHi: 3400, p0: -0.8, p1: 0, gain: 0.24, peakAt: 0.6 });
whoosh(mergeT + 0.05, mergeLen, { fLo: 320, fHi: 3000, p0: 0.8, p1: 0, gain: 0.24, peakAt: 0.6 });

// cubes click into place exactly when each visible cube lands
const shape = crystalCells(HOLDINGS, DROP);
const landings = shape.cells
  .filter((c) => !c.interior)
  .map((c) => ({ t: sec(frameAt(T.assemble, landsAt(c.delay))), pan: clamp(c.pos[0] / shape.radius, -1, 1) * 0.7 }))
  .sort((a, b) => a.t - b.t);
const BIN = 0.012;
for (let k = 0; k < landings.length; ) {
  const t0 = landings[k]!.t;
  let j = k;
  let pan = 0;
  while (j < landings.length && landings[j]!.t < t0 + BIN) pan += landings[j++]!.pan;
  const count = j - k;
  click(t0, Math.min(0.16, 0.045 * Math.sqrt(count)), pan / count, 2400 + fxRand() * 1600);
  k = j;
}
// …and the last one locks the crystal: a thump, a knock and a bright snap
const lockT = landings[landings.length - 1]!.t;
place(lockT, 0.4, (tt) => Math.sin(TAU * (55 + 60 * Math.exp(-tt / 0.03)) * tt) * Math.exp(-tt / 0.09), 0, 0.55, 0.1);
place(lockT, 0.08, (tt) => (fxRand() * 2 - 1) * Math.exp(-tt / 0.012), 0, 0.22, 0.2);
place(lockT + 0.004, 0.06, (tt) => Math.sin(TAU * 4200 * tt) * Math.exp(-tt / 0.012), 0, 0.2, 0.25);

// the market drop: a low crack, crackle running along the seam, and a rumble
{
  const t0 = sec(T.crack[0]);
  const run = sec(T.crack[1] - T.crack[0]);
  place(t0, 0.9, (tt) => Math.sin(TAU * (34 + 48 * Math.exp(-tt / 0.07)) * tt) * Math.exp(-tt / 0.28), 0, 0.7, 0.2);
  const lp = new Biquad('lp', 170, 0.8);
  place(t0, run + 1.2, (tt) => lp.run(fxRand() * 2 - 1) * Math.exp(-tt / 0.9) * 3.2, 0, 0.35, 0.15);
  const bp = new Biquad('bp', 1600, 2.2);
  let next = 0;
  let amp = 0;
  place(
    t0,
    run + 0.3,
    (tt) => {
      if (tt >= next) {
        amp = (0.5 + fxRand()) * Math.exp(-tt / 0.9);
        next = tt + 0.004 + fxRand() * (0.01 + tt * 0.05);
      }
      amp *= 0.93;
      return bp.run((fxRand() * 2 - 1) * amp);
    },
    -0.1,
    0.9,
    0.25,
  );
}

// gold fills the crack: a rising C-major chime as the seam heals
{
  const notes = [84, 88, 91, 96, 100];
  notes.forEach((m, k) => bell(sec(frameAt(T.heal, 0.04 + k * 0.2)), m, 0.17 - k * 0.015, -0.4 + k * 0.2, 1.6, 0.5));
  // a warm shimmer under it
  const t0 = sec(T.heal[0]);
  place(t0, 2.6, (tt) => (Math.sin(TAU * midiHz(72) * tt) + 0.6 * Math.sin(TAU * midiHz(79) * tt)) * Math.min(1, tt / 0.6) * Math.exp(-tt / 1.1) * (0.7 + 0.3 * Math.sin(TAU * 6 * tt)), 0, 0.05, 0.6);
}

// frost wraps the crystal: icy glass grains and a breath of air
{
  const a = sec(T.frost[0]);
  const b = sec(T.frost[1]);
  const icy = [96, 98, 100, 103, 105, 108, 110, 112];
  for (let k = 0; k < 70; k++) {
    const p = fxRand() ** 0.7;
    const t = a + p * (b - a + 0.5);
    const m = icy[Math.floor(fxRand() * icy.length)]!;
    const f = midiHz(m);
    const decay = 0.05 + fxRand() * 0.12;
    place(t, 0.4, (tt) => (Math.sin(TAU * f * tt) + 0.3 * Math.sin(TAU * f * 2.76 * tt)) * Math.min(1, tt / 0.004) * Math.exp(-tt / decay), fxRand() * 1.6 - 0.8, 0.035 * (0.5 + p), 0.6);
  }
  const hp = new Biquad('hp', 7000, 0.7);
  place(a, b - a + 1.0, (tt) => hp.run(fxRand() * 2 - 1) * Math.sin(Math.PI * clamp(tt / (b - a + 1.0), 0, 1)) ** 2, 0, 0.05, 0.5);
}

// the crystal flies off to a friend's wallet, which lights up on arrival
whoosh(sec(T.fly[0]), sec(T.fly[1] - T.fly[0]) + 0.2, { fLo: 450, fHi: 2200, p0: -0.1, p1: 0.75, gain: 0.22, peakAt: 0.5 });
bell(sec(T.received), 79, 0.07, 0.6, 0.6, 0.3);
bell(sec(T.received) + 0.11, 84, 0.07, 0.6, 0.8, 0.3);

// a subtle tick for each trust line
for (let i = 0; i < 3; i++) {
  const f = 1700 + i * 180;
  place(sec(T.trustLine(i)) + 1 / FPS, 0.08, (tt) => Math.sin(TAU * f * tt) * Math.exp(-tt / 0.02) + (fxRand() * 2 - 1) * Math.exp(-tt / 0.0012) * 0.5, 0, 0.2, 0.15);
}

// the call to action: a soft bell on the final chord
bell(END_T, 84, 0.11, -0.15, 2.2, 0.55);
bell(END_T + 0.06, 91, 0.08, 0.15, 2.2, 0.55);

// ------------------------------------------------------------------ mix

console.log('Rendering music…');
const music = new Track();
const padT = pad();
const subT = sub();
const { out: drumT, pump } = drums();
// pad and sub breathe with the kick
const duckPump = (i: number) => 1 - 0.32 * pump[i]!;
padT.scale(duckPump);
subT.scale(duckPump);
music.mix(padT);
music.mix(subT);
music.mix(arp());
music.mix(drumT);
music.mix(risers());
music.mix(tension());
const musicVerb = reverb(padT);
music.mix(musicVerb, 0.5);

// quiet bed: the captions stay the focus
music.scale(db(-27) / rms(music, 0, at(END_T)));
sfx.mix(reverb(sfxVerb), 0.9);
sfx.scale(db(-9) / peak(sfx));

const master = new Track();
master.mix(music);
master.mix(sfx);

if (existsSync(VOICEOVER)) {
  console.log('Mixing apps/video/voiceover.mp3 (music ducks under it)…');
  const vo: Float32Array = decodePcm(VOICEOVER, { channels: 2, rate: SR });
  const voice = new Track();
  for (let i = 0; i < N && 2 * i + 1 < vo.length; i++) {
    voice.L[i] = vo[2 * i]!;
    voice.R[i] = vo[2 * i + 1]!;
  }
  // envelope follower (fast attack, slow release) → how hard to duck
  const env = new Float32Array(N);
  let e = 0;
  for (let i = 0; i < N; i++) {
    const x = Math.abs(voice.L[i]!) + Math.abs(voice.R[i]!);
    e = x > e ? e + (x - e) * 0.004 : e * (1 - 1 / (0.35 * SR));
    env[i] = e;
  }
  const loud = Math.max(1e-6, ...Array.from({ length: 200 }, (_, k) => env[Math.floor((k / 200) * (N - 1))]!));
  master.L.fill(0);
  master.R.fill(0);
  const duck = (i: number, depth: number) => 1 - depth * clamp(env[i]! / (loud * 0.35), 0, 1);
  for (let i = 0; i < N; i++) {
    const m = duck(i, 0.7); // about -10 dB under speech
    const s = duck(i, 0.35);
    master.L[i] = music.L[i]! * m + sfx.L[i]! * s + voice.L[i]!;
    master.R[i] = music.R[i]! * m + sfx.R[i]! * s + voice.R[i]!;
  }
}

// gentle limiter, then a hard guarantee of ≤ -1 dBFS and silence at the very end
const ceiling = db(-1);
const soft = (x: number) => (Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3)));
for (let i = 0; i < N; i++) {
  master.L[i] = soft(master.L[i]!);
  master.R[i] = soft(master.R[i]!);
}
const p = peak(master);
if (p > ceiling) master.scale(ceiling / p);
const tail = at(0.12);
for (let i = 0; i < tail; i++) {
  const g = 1 - i / tail;
  master.L[N - tail + i] *= g;
  master.R[N - tail + i] *= g;
}

// ------------------------------------------------------------------ write WAV (16-bit, TPDF dither)

const dither = rng(7);
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  for (const [ch, off] of [
    [master.L, 0],
    [master.R, 2],
  ] as const) {
    const v = clamp(ch[i]! + (dither() - dither()) / 32768, -1, 1);
    data.writeInt16LE(Math.round(v * 32767), i * 4 + off);
  }
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, data]));

const dbfs = (x: number) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
console.log(`Wrote ${OUT}`);
console.log(`  ${SECONDS}s · music RMS ${dbfs(rms(music, 0, at(END_T)))} dBFS · effects peak ${dbfs(peak(sfx))} dBFS · master peak ${dbfs(peak(master))} dBFS`);
console.log(`  ${landings.length} cube landings → clicks from ${landings[0]!.t.toFixed(2)}s, lock at ${lockT.toFixed(2)}s`);
console.log(`  voiceover: ${existsSync(VOICEOVER) ? 'mixed (music ducked)' : 'none (add apps/video/voiceover.mp3 to mix one in)'}`);

// event times, for the sync check after rendering
writeFileSync(
  join(dirname(OUT), 'events.json'),
  JSON.stringify(
    {
      lock: lockT,
      crack: sec(T.crack[0]),
      trust: [0, 1, 2].map((i) => sec(T.trustLine(i)) + 1 / FPS),
      end: END_T,
      cards: [0, 1, 2, 3, 4, 5].map((i) => sec(T.cardIn(i))),
    },
    null,
    2,
  ),
);
