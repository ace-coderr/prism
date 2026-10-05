import type { Address } from 'viem';
import { replaySecondsAt, replayTimeAt, type ReplayEvent, type ReplayPlan, type ReplayTimeline } from '@prism/core';

/*
 * Everything drawn over the 3D crystal in a replay, on the 2D canvas that is shown and
 * recorded: the PRISM mark and crystal, a date/time ticker, the value in ETH with a small
 * value line, a caption for each moment (a crack, a gold seam, the gift…), and the end card.
 */

const BG = '#101214';
const LIME = '#d4f000';
const GOLD = '#f6c143';
const DOWN = '#f0544f';
const INK = '#f2f3f0';
const MIST = '#9aa2a9';
const DISPLAY = '"Space Grotesk", ui-sans-serif, sans-serif';
const MONO = '"Space Mono", ui-monospace, monospace';
const GEM = ['..AAA..', '.ABBBA.', 'ABBGBBA', '.CCCCC.', '..CCC..', '...C...'];
const GEM_SHADE: Record<string, string> = { A: '#e6ff5c', B: LIME, C: '#8fa300', G: GOLD };
/** How long a caption stays (seconds of video). */
const CAPTION = 1.9;

export interface OverlayInfo {
  id: bigint;
  /** "@name" or a short address */
  owner: string;
  /** how to show someone (a gift's recipient) */
  nameOf: (a: Address) => string;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ease = (t: number) => 1 - (1 - clamp01(t)) ** 3;

function gem(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  GEM.forEach((row, gy) =>
    [...row].forEach((ch, gx) => {
      if (ch === '.') return;
      ctx.fillStyle = GEM_SHADE[ch]!;
      ctx.fillRect(x + gx * cell, y + gy * cell, cell, cell);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, cell * 0.12);
      ctx.strokeRect(x + gx * cell, y + gy * cell, cell, cell);
    }),
  );
}

const fmtEth = (v: number) => `${v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(4)} ETH`;

export function captionOf(e: ReplayEvent, info: OverlayInfo): { text: string; color: string } {
  switch (e.kind) {
    case 'forged':
      return { text: 'Forged', color: LIME };
    case 'added':
      return { text: 'More went in', color: INK };
    case 'withdrawn':
      return { text: 'Some came out', color: INK };
    case 'drop':
      return { text: `${e.symbol} −${e.depth}% · a crack`, color: DOWN };
    case 'heal':
      return { text: `${e.symbol} climbed back · a gold seam`, color: GOLD };
    case 'sealed':
      return { text: `Sealed until ${new Date((e.until ?? 0) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, color: '#bfe6ff' };
    case 'gift':
      return { text: `A gift to ${e.to ? info.nameOf(e.to) : 'a friend'}`, color: '#bfe6ff' };
    case 'unwrap':
      return { text: 'Unwrapped', color: '#bfe6ff' };
  }
}

/** Draw one replay frame: the 3D frame (`scene`), then everything over it. */
export function drawFrame(ctx: CanvasRenderingContext2D, scene: CanvasImageSource | null, timeline: ReplayTimeline, plan: ReplayPlan, seconds: number, info: OverlayInfo) {
  const { width: W, height: H } = ctx.canvas;
  const u = Math.min(W, H) / 1080;
  const pad = 56 * u;
  const { t, phase, progress } = replayTimeAt(timeline, plan, seconds);
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  if (scene) ctx.drawImage(scene, 0, 0, W, H);

  // legibility: soft dark bands top and bottom
  const top = ctx.createLinearGradient(0, 0, 0, 200 * u);
  top.addColorStop(0, 'rgba(16,18,20,0.85)');
  top.addColorStop(1, 'rgba(16,18,20,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 200 * u);
  const bottom = ctx.createLinearGradient(0, H - 330 * u, 0, H);
  bottom.addColorStop(0, 'rgba(16,18,20,0)');
  bottom.addColorStop(1, 'rgba(16,18,20,0.92)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H - 330 * u, W, 330 * u);

  // the mark and the crystal
  gem(ctx, pad, pad, 7 * u);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = `700 ${34 * u}px ${DISPLAY}`;
  ctx.fillText('PRISM', pad + 62 * u, pad + 36 * u);
  ctx.fillStyle = MIST;
  ctx.font = `400 ${22 * u}px ${MONO}`;
  ctx.fillText(`Crystal #${info.id} · ${info.owner}`, pad, pad + 84 * u);

  // the ticker: when we are in its life
  const date = new Date(t * 1000);
  ctx.fillStyle = MIST;
  ctx.font = `400 ${22 * u}px ${MONO}`;
  ctx.fillText(date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(), pad, H - pad - 70 * u);
  ctx.fillStyle = INK;
  ctx.font = `700 ${60 * u}px ${DISPLAY}`;
  ctx.fillText(date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), pad, H - pad);

  // the value now, and how it moved since the start
  const values = timeline.values;
  const vNow = valueAt(values, t);
  const v0 = values.find((v) => v.eth !== null)?.eth ?? null;
  ctx.textAlign = 'right';
  if (vNow !== null) {
    ctx.fillStyle = INK;
    ctx.font = `700 ${46 * u}px ${DISPLAY}`;
    ctx.fillText(fmtEth(vNow), W - pad, H - pad);
    if (v0) {
      const ch = (vNow / v0 - 1) * 100;
      ctx.fillStyle = ch >= 0 ? '#4cd07a' : DOWN;
      ctx.font = `400 ${22 * u}px ${MONO}`;
      ctx.fillText(`${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(1)}% since the start`, W - pad, H - pad - 70 * u);
    }
  }
  ctx.textAlign = 'left';

  // the value line: the whole run faint, the part played so far bright
  const lx = pad;
  const lw = W - pad * 2;
  const ly = H - pad - 150 * u;
  const lh = 64 * u;
  const priced = values.filter((v) => v.eth !== null) as Array<{ t: number; eth: number }>;
  if (priced.length > 1) {
    const lo = Math.min(...priced.map((v) => v.eth));
    const hi = Math.max(...priced.map((v) => v.eth));
    const X = (tt: number) => lx + ((tt - timeline.start) / Math.max(1, timeline.end - timeline.start)) * lw;
    const Y = (e: number) => ly - (hi - lo < 1e-12 ? 0.5 : (e - lo) / (hi - lo)) * lh;
    const path = (until: number) => {
      ctx.beginPath();
      let first = true;
      for (const v of priced) {
        if (v.t > until) break;
        if (first) ctx.moveTo(X(v.t), Y(v.eth));
        else ctx.lineTo(X(v.t), Y(v.eth));
        first = false;
      }
      if (vNow !== null && until < timeline.end) ctx.lineTo(X(until), Y(vNow));
    };
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    path(timeline.end);
    ctx.stroke();
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 4 * u;
    path(t);
    ctx.stroke();
    // drops and gold seams along it
    for (const e of timeline.events) {
      if ((e.kind !== 'drop' && e.kind !== 'heal') || e.t > t) continue;
      const v = valueAt(values, e.t);
      if (v === null) continue;
      ctx.fillStyle = e.kind === 'drop' ? DOWN : GOLD;
      ctx.beginPath();
      ctx.arc(X(e.t), Y(v), 6 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    if (vNow !== null) {
      ctx.fillStyle = LIME;
      ctx.beginPath();
      ctx.arc(X(t), Y(vNow), 7 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // captions: one per moment, for a couple of seconds
  if (phase !== 'outro') {
    const live = timeline.events
      .map((e) => ({ e, at: e.kind === 'forged' ? 0.15 : replaySecondsAt(timeline, plan, e.t) }))
      .filter(({ at }) => seconds >= at && seconds < at + CAPTION);
    const last = live[live.length - 1];
    if (last) {
      const { text, color } = captionOf(last.e, info);
      const a = clamp01((seconds - last.at) / 0.2) * clamp01((last.at + CAPTION - seconds) / 0.3);
      ctx.globalAlpha = a;
      ctx.font = `700 ${30 * u}px ${MONO}`;
      const w = ctx.measureText(text).width + 44 * u;
      const cx = W / 2 - w / 2;
      const cy = pad + 120 * u;
      ctx.fillStyle = 'rgba(16,18,20,0.9)';
      roundRect(ctx, cx, cy, w, 58 * u, 29 * u);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(text, W / 2, cy + 39 * u);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }

  // the end card
  if (phase === 'outro') {
    const a = ease(progress / 0.35);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(16,18,20,0.82)';
    ctx.fillRect(0, 0, W, H);
    const cy = H / 2;
    ctx.textAlign = 'center';
    gem(ctx, W / 2 - 49 * u, cy - 250 * u, 14 * u);
    ctx.fillStyle = INK;
    ctx.font = `700 ${92 * u}px ${DISPLAY}`;
    ctx.fillText(`Crystal #${info.id}`, W / 2, cy - 40 * u);
    ctx.fillStyle = MIST;
    ctx.font = `400 ${30 * u}px ${MONO}`;
    ctx.fillText(info.owner, W / 2, cy + 14 * u);
    ctx.font = `700 ${48 * u}px ${DISPLAY}`;
    const l1 = 'A stock basket ';
    const l2 = 'you can hold';
    const w1 = ctx.measureText(l1).width;
    const w2 = ctx.measureText(l2).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText(l1, W / 2 - (w1 + w2) / 2, cy + 110 * u);
    ctx.fillStyle = LIME;
    ctx.fillText(l2, W / 2 - (w1 + w2) / 2 + w1, cy + 110 * u);
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = `700 ${30 * u}px ${MONO}`;
    ctx.fillText('prism-crystal.vercel.app', W / 2, cy + 190 * u);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  } else if (phase === 'intro') {
    // fade in from the page background
    ctx.fillStyle = `rgba(16,18,20,${1 - ease(progress / 0.5)})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** The value line's value at `t` (the last sample at or before it). */
function valueAt(values: ReplayTimeline['values'], t: number): number | null {
  let out: number | null = null;
  for (const v of values) {
    if (v.t > t) break;
    if (v.eth !== null) out = v.eth;
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
