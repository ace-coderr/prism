import { replaySecondsAt, type ReplayPlan, type ReplayTimeline } from '@prism/core';

/*
 * The replay's sound, synthesized in the browser in the explainer's style (A minor, quiet):
 * a soft pad under everything, cube clicks as the crystal forges, a low crack at each real
 * drop, a bright chime when it heals in gold, an icy shimmer for the ice, sparkles at the
 * unwrap, and a bell on the end card. Scheduled ahead on the AudioContext clock, so it stays
 * in step with the picture and goes into the recording as it plays.
 */

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    let s = 1;
    for (let i = 0; i < d.length; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
  }
  return noiseBuffer;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Start the replay's sound at context time `at` (= second 0 of the video). Returns a stop function. */
export function scheduleReplaySound(ctx: BaseAudioContext, out: AudioNode, timeline: ReplayTimeline, plan: ReplayPlan, at: number): () => void {
  const nodes: AudioScheduledSourceNode[] = [];
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(out);
  const end = at + plan.total;

  const osc = (type: OscillatorType, freq: number, t0: number, t1: number, gain: number, dest: AudioNode, attack = 0.01, release = 0.4) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, Math.max(t0 + attack, t1 - release));
    g.gain.linearRampToValueAtTime(0, t1);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t1 + 0.05);
    nodes.push(o);
    return o;
  };
  const burst = (t0: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 0.8) => {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random() * 0.5, dur + 0.05);
    nodes.push(src);
  };
  const bell = (t0: number, freq: number, gain: number, dur = 1.6) => {
    for (const [mult, g] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.15],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, t0);
      e.gain.linearRampToValueAtTime(gain * g, t0 + 0.005);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / mult ** 0.3);
      o.connect(e).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
      nodes.push(o);
    }
  };

  // pad: A minor, two detuned saws per note through a soft low-pass that opens a little as it plays
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(600, at);
  lp.frequency.linearRampToValueAtTime(1300, at + plan.intro + plan.lapse);
  lp.frequency.linearRampToValueAtTime(900, end);
  lp.connect(master);
  for (const note of [45, 52, 57, 60, 64]) {
    for (const det of [-6, 6]) {
      const o = osc('sawtooth', hz(note), at, end, 0.012, lp, 1.0, 1.4);
      o.detune.value = det;
    }
  }

  // the forge: cube clicks that speed up, then the lock
  for (let i = 0; i < 18; i++) {
    const t = at + 0.15 + plan.intro * 0.8 * (1 - (1 - i / 17) ** 1.6);
    burst(t, 0.03, 0.18, 'bandpass', 2400 + (i % 5) * 300, 4);
  }
  burst(at + plan.intro, 0.08, 0.3, 'lowpass', 900);
  osc('sine', hz(45), at + plan.intro, at + plan.intro + 0.25, 0.25, master, 0.005, 0.2);

  // moments
  for (const e of timeline.events) {
    if (e.kind === 'forged') continue;
    const t = at + replaySecondsAt(timeline, plan, e.t);
    if (e.kind === 'drop') {
      burst(t, 0.45, 0.35, 'lowpass', 500);
      osc('sine', 62, t, t + 0.5, 0.35, master, 0.005, 0.45);
    } else if (e.kind === 'heal') {
      [76, 83, 88].forEach((n, i) => bell(t + i * 0.09, hz(n), 0.12));
    } else if (e.kind === 'sealed' || e.kind === 'gift') {
      burst(t, 0.9, 0.08, 'highpass', 7000);
      bell(t + 0.1, hz(93), 0.05, 1.2);
    } else if (e.kind === 'unwrap') {
      burst(t, 0.25, 0.2, 'bandpass', 3000, 2);
      [81, 84, 88, 91, 96].forEach((n, i) => bell(t + 0.2 + i * 0.07, hz(n), 0.07, 1.0));
    } else {
      burst(t, 0.06, 0.12, 'bandpass', 1800, 3);
    }
  }

  // the end card: a warm bell chord
  [69, 72, 76, 81].forEach((n, i) => bell(at + plan.intro + plan.lapse + 0.05 + i * 0.03, hz(n), 0.07, 2.4));

  master.gain.setValueAtTime(0.9, end - 0.4);
  master.gain.linearRampToValueAtTime(0, end);
  return () => {
    for (const n of nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    master.disconnect();
  };
}
