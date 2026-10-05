/*
 * Recording a replay in the browser: the shown canvas (picture) plus the synthesized sound,
 * through MediaRecorder. MP4 (H.264 + AAC) wherever the browser can make it, since X needs
 * MP4; otherwise WebM, which may need converting before posting to X.
 */

export interface RecordFormat {
  mime: string;
  ext: 'mp4' | 'webm';
}

const CANDIDATES: RecordFormat[] = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

/** The best format this browser can record (null = no recording at all). */
export function recordFormat(): RecordFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

export interface Recording {
  stop: () => Promise<Blob>;
  format: RecordFormat;
}

/** Start recording `canvas` (at `fps`) together with `audio`. */
export function startRecording(canvas: HTMLCanvasElement, audio: MediaStream | null, fps = 30): Recording {
  const format = recordFormat();
  if (!format) throw new Error('This browser can’t record video.');
  const stream = canvas.captureStream(fps);
  for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track);
  const pixels = canvas.width * canvas.height;
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    // ~6 Mb/s at 1080×1080, ~8 Mb/s at 1920×1080: crisp voxels, a few MB per replay
    videoBitsPerSecond: Math.round(Math.min(10_000_000, Math.max(4_000_000, pixels * 5.2))),
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(250);
  return {
    format,
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.kind === 'video' && t.stop());
          resolve(new Blob(chunks, { type: format.mime.split(';')[0] }));
        };
        recorder.stop();
      }),
  };
}
