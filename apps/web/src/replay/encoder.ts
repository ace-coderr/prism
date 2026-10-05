import type { ReplayPlan, ReplayTimeline } from '@prism/core';
import { scheduleReplaySound } from './sound';

/*
 * Frame-exact MP4 export, in the browser: every frame of the replay is rendered at an exact
 * 1/30 s step (however long each one takes, so a slower device just takes longer, never
 * stutters), encoded with WebCodecs as H.264, the sound is rendered offline from the same
 * synth and encoded as AAC, and Mediabunny muxes both into an MP4 with its index at the front
 * (what X expects). Mediabunny loads only when someone actually downloads.
 */

export const EXPORT_FPS = 30;
const bitrateFor = (w: number, h: number) => Math.round(Math.min(10_000_000, Math.max(5_000_000, w * h * 3.6)));

/** Can this browser make an H.264 + AAC MP4 itself? (Chrome, Edge, Safari: yes; others: we fall back.) */
export async function canExportMp4(width: number, height: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return false;
  try {
    const { canEncodeVideo, canEncodeAudio } = await import('mediabunny');
    const [v, a] = await Promise.all([
      canEncodeVideo('avc', { width, height, bitrate: bitrateFor(width, height) }),
      canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 128_000 }),
    ]);
    return v && a;
  } catch {
    return false;
  }
}

/** The replay's whole soundtrack, rendered offline (faster than real time). */
export function renderReplayAudio(timeline: ReplayTimeline, plan: ReplayPlan): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(48000 * plan.total), 48000);
  scheduleReplaySound(ctx, ctx.destination, timeline, plan, 0);
  return ctx.startRendering();
}

/**
 * Encode `total` seconds of `canvas` at EXPORT_FPS. `renderAt(seconds)` must leave the canvas
 * showing that moment. Resolves with the MP4.
 */
export async function exportMp4({
  canvas,
  total,
  renderAt,
  audio,
  onProgress,
}: {
  canvas: HTMLCanvasElement;
  total: number;
  renderAt: (seconds: number) => void;
  audio: AudioBuffer | null;
  onProgress?: (done: number) => void;
}): Promise<Blob> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource } = await import('mediabunny');
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: bitrateFor(canvas.width, canvas.height), keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: EXPORT_FPS });
  const sound = audio ? new AudioBufferSource({ codec: 'aac', bitrate: 128_000 }) : null;
  if (sound) output.addAudioTrack(sound);
  await output.start();
  const frames = Math.round(total * EXPORT_FPS);
  for (let i = 0; i < frames; i++) {
    const t = i / EXPORT_FPS;
    renderAt(t);
    await video.add(t, 1 / EXPORT_FPS);
    onProgress?.((i + 1) / frames);
    // let the page paint the progress now and then
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  if (sound && audio) await sound.add(audio);
  video.close();
  sound?.close();
  await output.finalize();
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}
