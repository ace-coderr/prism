/**
 * SVG for the live score badge and the share images (rendered to PNG by og.ts and by
 * scripts/make-brand-assets.ts). Text is set in Space Grotesk / Space Mono (server/fonts):
 * Space Mono is monospaced, so long text wraps exactly.
 */
import { PALETTE, SITE_HOST, escapeXml, formatScore, markShapes, scoreColor, starPath, type ScoreSummary } from '@prism/core';

/** The static Bold cut Google Fonts serves names its family "Space Grotesk Light" (variable-font artefact). */
export const GROTESK = 'Space Grotesk Light';
export const MONO = 'Space Mono';
const { ink: INK, panel: PANEL, line: LINE, mist: MIST, white: WHITE, lime: LIME, down: DOWN, gold: GOLD } = PALETTE;

/** Text the fonts can draw: no emoji or control characters. */
export const drawable = (s: string) => s.replace(/\p{Extended_Pictographic}|[\u{1F000}-\u{1FFFF}]|️|‍|[\u0000-\u001f]/gu, '').trim();

/** Wrap monospace text into at most `lines` lines of `width` characters (… when cut). */
export function wrap(text: string, width: number, lines: number): string[] {
  const words = drawable(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= width) cur = next;
    else {
      if (cur) out.push(cur);
      cur = w.length > width ? `${w.slice(0, width - 1)}…` : w;
    }
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = `${out[lines - 1]!.slice(0, width - 1).trimEnd()}…`;
  return out;
}

const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A shields-style badge: "PRISM true colors | 4.2 · 12 holders". */
export function badgeSvg(symbol: string, score: ScoreSummary): string {
  const label = 'PRISM true colors';
  const value = score.score === null ? `${score.reviewers}/3 holders reviewed` : `${formatScore(score.score)} · ${score.reviewers} holder${score.reviewers === 1 ? '' : 's'}`;
  const color = score.score === null ? MIST : scoreColor(score.score);
  const lw = 22 + label.length * 6.6;
  const vw = 16 + value.length * 7;
  const w = Math.round(lw + vw);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="22" viewBox="0 0 ${w} 22" role="img" aria-label="${escapeXml(`$${symbol} on PRISM: ${value}`)}">
<title>${escapeXml(`$${symbol} true colors on PRISM: ${value}`)}</title>
<rect width="${w}" height="22" rx="5" fill="${INK}"/><rect x="${lw}" width="${vw}" height="22" rx="5" fill="${color}"/><rect x="${lw}" width="6" height="22" fill="${color}"/>
<svg x="4" y="3" width="16" height="16" viewBox="0 0 64 64">${markShapes()}</svg>
<g font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" font-weight="700">
<text x="22" y="15" fill="${WHITE}">${label}</text>
<text x="${lw + vw / 2}" y="15" fill="${INK}" text-anchor="middle">${escapeXml(value)}</text>
</g></svg>`;
}

const frame = (inner: string, path: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${INK}"/>
<rect x="24" y="24" width="1152" height="582" rx="36" fill="${PANEL}" stroke="${LINE}" stroke-width="2"/>
<svg x="64" y="58" width="64" height="64" viewBox="0 0 64 64">${markShapes()}</svg>
<text x="142" y="104" font-family="${GROTESK}" font-weight="700" font-size="40" letter-spacing="-1" fill="${WHITE}">PRISM</text>
<text x="1136" y="100" text-anchor="end" font-family="${MONO}" font-size="22" letter-spacing="2" fill="${MIST}">SEE EVERY LAUNCH’S TRUE COLORS</text>
${inner}
<text x="64" y="566" font-family="${MONO}" font-size="24" fill="${LIME}">${escapeXml(`${SITE_HOST}${path}`)}</text>
</svg>`;

const pill = (x: number, y: number, text: string, fill: string, color: string) => {
  const w = 28 + text.length * 13.2;
  return { w, svg: `<rect x="${x}" y="${y}" width="${w}" height="44" rx="22" fill="${fill}"/><text x="${x + w / 2}" y="${y + 29}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="22" fill="${color}">${escapeXml(text)}</text>` };
};

export interface LaunchCard {
  token: string;
  symbol: string;
  name: string;
  pair: string;
  status: 'curve' | 'graduated' | null;
  progress: number | null;
  score: ScoreSummary;
  /** the token's picture as a data: URI (PNG), or null */
  image?: string | null;
}

export function launchCardSvg(c: LaunchCard): string {
  const pills: string[] = [];
  let x = 64;
  for (const [text, fill, color] of [
    [c.status === null ? 'test stock' : `paired with ${c.pair}`, LINE, WHITE],
    ...(c.status === 'graduated' ? [['graduated', LINE, LIME]] : c.status === 'curve' ? [[`on curve${c.progress === null ? '' : ` ${Math.round(c.progress * 100)}%`}`, LINE, GOLD]] : []),
  ] as Array<[string, string, string]>) {
    const p = pill(x, 410, text, fill, color);
    pills.push(p.svg);
    x += p.w + 14;
  }
  const s = c.score;
  const right =
    s.score === null
      ? `<text x="1136" y="300" text-anchor="end" font-family="${GROTESK}" font-weight="700" font-size="54" fill="${MIST}">Not enough</text>
<text x="1136" y="360" text-anchor="end" font-family="${GROTESK}" font-weight="700" font-size="54" fill="${MIST}">reviews yet</text>
<text x="1136" y="410" text-anchor="end" font-family="${MONO}" font-size="24" fill="${MIST}">${s.reviewers} of 3 holders so far</text>`
      : `<text x="1136" y="330" text-anchor="end" font-family="${GROTESK}" font-weight="700" font-size="190" letter-spacing="-6" fill="${scoreColor(s.score)}">${formatScore(s.score)}</text>
<text x="1136" y="384" text-anchor="end" font-family="${MONO}" font-size="24" fill="${WHITE}">TRUE COLORS · from ${s.reviewers} holder${s.reviewers === 1 ? '' : 's'} still in</text>`;
  const sym = fit(`$${drawable(c.symbol)}`, 11);
  const symSize = sym.length <= 7 ? 88 : sym.length <= 9 ? 68 : 56;
  const picture = c.image
    ? `<clipPath id="pic"><rect x="64" y="160" width="156" height="156" rx="36"/></clipPath><rect x="64" y="160" width="156" height="156" rx="36" fill="${LINE}"/><image x="64" y="160" width="156" height="156" preserveAspectRatio="xMidYMid slice" clip-path="url(#pic)" href="${c.image}"/><rect x="64" y="160" width="156" height="156" rx="36" fill="none" stroke="${LINE}" stroke-width="3"/>`
    : '';
  const tx = c.image ? 252 : 64;
  return frame(
    `${picture}
<text x="${tx}" y="${c.image ? 248 : 270}" font-family="${GROTESK}" font-weight="700" font-size="${c.image ? symSize : c.symbol.length > 9 ? 76 : 104}" letter-spacing="-3" fill="${WHITE}">${escapeXml(c.image ? sym : fit(`$${drawable(c.symbol)}`, 13))}</text>
<text x="${tx}" y="${c.image ? 300 : 334}" font-family="${MONO}" font-size="30" fill="${MIST}">${escapeXml(fit(drawable(c.name), c.image ? 22 : 30))}</text>
${pills.join('')}
${right}`,
    `/t/${short(c.token)}`,
  );
}

export interface ReviewCard {
  id: number;
  author: string;
  name: string | null;
  symbol: string;
  rating: number;
  text: string;
  state: { kind: 'holding' | 'trimmed' | 'sold' | 'replaced'; percent?: number };
  days: number;
}

export function reviewCardSvg(c: ReviewCard): string {
  const who = c.name ? `@${c.name}` : short(c.author);
  const sold = c.state.kind === 'sold';
  const verb = sold ? 'sold' : c.state.kind === 'replaced' ? 'reviewed' : 'holds';
  const stars = Array.from({ length: 5 }, (_, i) => `<path d="${starPath(64 + i * 50, 206, 42)}" fill="${i < c.rating ? GOLD : LINE}"/>`).join('');
  const lines = wrap(c.text || '(rating only)', 46, 4)
    .map((l, i) => `<text x="64" y="${318 + i * 44}" font-family="${MONO}" font-size="32" fill="${sold ? MIST : WHITE}">${escapeXml(l)}</text>`)
    .join('');
  const days = c.days === 0 ? null : `${c.days} day${c.days === 1 ? '' : 's'}`;
  const status =
    c.state.kind === 'sold'
      ? pill(0, 0, days ? `SOLD ${days} after reviewing` : 'SOLD within a day of reviewing', DOWN, INK)
      : c.state.kind === 'trimmed'
        ? pill(0, 0, `TRIMMED ${c.state.percent}%${days ? ` · ${days} held` : ''}`, GOLD, INK)
        : c.state.kind === 'replaced'
          ? pill(0, 0, 'REPLACED BY A NEWER REVIEW', LINE, MIST)
          : pill(0, 0, days ? `HOLDING · ${days}` : 'HOLDING', LIME, INK);
  return frame(
    `<text x="64" y="186" font-family="${GROTESK}" font-weight="700" font-size="44" fill="${WHITE}">${escapeXml(fit(drawable(who), 22))} <tspan fill="${MIST}">${verb}</tspan> ${escapeXml(fit(`$${drawable(c.symbol)}`, 14))}</text>
${stars}
${lines}
<g transform="translate(${1136 - status.w} 520)">${status.svg}</g>`,
    `/r/${c.id}`,
  );
}

/** The site's own share card (og.jpg) and X images. */
export function siteCardSvg(width = 1200, height = 630): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${INK}"/>
<svg x="760" y="120" width="390" height="390" viewBox="0 0 64 64">${markShapes()}</svg>
<text x="72" y="150" font-family="${GROTESK}" font-weight="700" font-size="56" letter-spacing="-1.5" fill="${WHITE}">PRISM</text>
<text x="72" y="290" font-family="${GROTESK}" font-weight="700" font-size="76" letter-spacing="-2.5" fill="${WHITE}">See every launch’s</text>
<text x="72" y="380" font-family="${GROTESK}" font-weight="700" font-size="76" letter-spacing="-2.5" fill="${LIME}">true colors</text>
<text x="72" y="450" font-family="${MONO}" font-size="24" fill="${MIST}">Reviews from real holders. Sell after praising,</text>
<text x="72" y="486" font-family="${MONO}" font-size="24" fill="${MIST}">and everyone sees.</text>
<text x="72" y="566" font-family="${MONO}" font-size="24" fill="${LIME}">${SITE_HOST}</text>
</svg>`;
}
