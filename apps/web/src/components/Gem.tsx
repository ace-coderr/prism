import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GEM_GLASS, PALETTE, crackPath, facetColor, facetPoint, gemSegments, markShapes, mix, reviewPath, type GemFacet, type GemSegment } from '@prism/core';
import { facetStatus } from '../data/format';
import { atNameOrShort, useProfiles } from '../data/profiles';
import type { GemScene } from './gemScene';

/** PRISM's mark as inline SVG: a hexagonal cut gem seen from above. */
export function GemMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={className} dangerouslySetInnerHTML={{ __html: markShapes() }} />;
}

/** WebGL, enough cores and memory, no data saver and no reduced-motion preference. */
function canAnimate(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if ((nav.hardwareConcurrency ?? 4) < 4 || (nav.deviceMemory ?? 4) < 2 || nav.connection?.saveData) return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

type Card = { facet: GemFacet; x: number; y: number };

/**
 * The hero: the living gem. One crown facet per recent review (colored by rating, sized by the
 * reviewer's position, grey and cracked once SOLD, dimmer when trimmed); point at one for who said
 * what. No reviews: a clear glass gem. 3D where the device can, else the same gem as a still SVG.
 */
export function LivingGem({ facets, loading, className = '' }: { facets: GemFacet[] | undefined; loading: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<GemScene | null>(null);
  const [live, setLive] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const navigate = useNavigate();
  const segments = useMemo(() => gemSegments(facets ?? []), [facets]);
  const segRef = useRef(segments);
  segRef.current = segments;

  const show = (c: Card | null) => {
    clearTimeout(hide.current);
    if (c) setCard(c);
    else hide.current = setTimeout(() => setCard(null), 250); // time to move onto the card
  };

  useEffect(() => {
    if (!canAnimate() || !host.current) return;
    let cancelled = false;
    void import('./gemScene')
      .then(({ mountGem }) => {
        if (cancelled || !host.current) return;
        scene.current = mountGem(host.current, segRef.current, {
          onHover: (facet, x, y) => show(facet ? { facet, x, y } : null),
          onPick: (facet, x, y, pointerType) => {
            if (pointerType === 'mouse') navigate(reviewPath(facet.id));
            else show({ facet, x, y }); // touch: show the card; tap it to open the review
          },
        });
        setLive(true);
      })
      .catch(() => undefined); // stays the still gem
    return () => {
      cancelled = true;
      clearTimeout(hide.current);
      scene.current?.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    scene.current?.update(segments);
    setCard(null);
  }, [segments]);

  // a tap anywhere else closes a card opened by touch
  useEffect(() => {
    if (!card) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setCard(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [card]);

  const reviews = facets?.length ?? 0;
  const sold = facets?.filter((f) => f.state.kind === 'sold').length ?? 0;
  const label =
    reviews === 0
      ? 'A clear glass gem: no reviews yet'
      : `A gem with one facet for each of the ${reviews} latest reviews${sold ? `, ${sold} of them grey and cracked: sold` : ''}`;

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div ref={box} className="relative aspect-square w-full" role="group" aria-label={label}>
        {!live && <GemStill segments={segments} onCard={show} />}
        <div ref={host} className={`absolute inset-0 transition-opacity duration-700 ${live ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
        {card && <FacetCard card={card} width={box.current?.clientWidth ?? 0} onEnter={() => show(card)} onLeave={() => show(null)} />}
      </div>
      {!loading && reviews === 0 && <p className="text-center font-mono text-[13px] tracking-[0.04em] text-mist">No reviews yet. Be the first.</p>}
    </div>
  );
}

/** The small card for a facet: "@name · ★4 · holding 12d · $SYMBOL", linking to the review. */
function FacetCard({ card, width, onEnter, onLeave }: { card: Card; width: number; onEnter(): void; onLeave(): void }) {
  const f = card.facet;
  const profile = useProfiles([f.author]).get(f.author.toLowerCase());
  const left = Math.min(Math.max(card.x, 150), Math.max(150, width - 150));
  const below = card.y < 70;
  return (
    <Link
      to={reviewPath(f.id)}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className="absolute z-10 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-panel/95 px-3.5 py-2 font-mono text-[12px] text-white shadow-lg backdrop-blur hover:border-lime/60"
      style={{ left, top: below ? card.y + 18 : card.y - 48 }}
    >
      <span className="min-w-0 max-w-[11rem] truncate font-bold">{atNameOrShort(f.author, profile?.name)}</span>
      <span className="text-white/30">·</span>
      <span className="text-gold">★{f.rating}</span>
      <span className="text-white/30">·</span>
      <span className={f.state.kind === 'sold' ? 'text-down' : 'text-mist'}>{facetStatus(f)}</span>
      <span className="text-white/30">·</span>
      <span className="font-bold text-lime">${f.symbol}</span>
    </Link>
  );
}

const pt = (p: [number, number]) => `${p[0].toFixed(4)} ${p[1].toFixed(4)}`;

/**
 * The gem seen from above as SVG: the still picture for slow devices and reduced motion (and while
 * the 3D one loads). Same facets, same colors, same cracks; facets link to their reviews.
 */
export function GemStill({ segments, onCard }: { segments: GemSegment[]; onCard?: (c: Card | null) => void }) {
  const navigate = useNavigate();
  const touch = useRef(false);
  const any = segments.some((s) => s.facet);
  const girdle = segments.map((s) => pt(facetPoint(s, 0, -1))).join('L');
  const table = segments.map((s) => pt(facetPoint(s, 1, -1))).join('L');
  const at = (e: ReactPointerEvent | ReactMouseEvent, f: GemFacet): Card => {
    const r = (e.currentTarget as unknown as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return { facet: f, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <svg viewBox="-1.12 -1.12 2.24 2.24" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden={!any}>
      <defs>
        <clipPath id="gem-still-clip">
          <path d={`M${girdle}Z`} />
        </clipPath>
        <linearGradient id="gem-still-shine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {segments.map((seg, i) => {
        const f = seg.facet;
        // a light from the top left: facets facing it a touch brighter
        const lit = Math.cos((seg.a0 + seg.a1) / 2 + Math.PI * 0.75) * 0.14;
        const base = f ? facetColor(f) : any ? mix(GEM_GLASS, PALETTE.ink, 0.3) : GEM_GLASS;
        const fill = lit > 0 ? mix(base, PALETTE.white, lit) : mix(base, PALETTE.ink, -lit);
        const d = `M${pt(facetPoint(seg, 0, -1))}L${pt(facetPoint(seg, 0, 1))}L${pt(facetPoint(seg, 1, 1))}L${pt(facetPoint(seg, 1, -1))}Z`;
        const shape = <path d={d} fill={fill} fillOpacity={any ? 1 : 0.22} stroke={any ? PALETTE.ink : mix(PALETTE.mist, PALETTE.ink, 0.35)} strokeWidth={0.014} strokeLinejoin="round" />;
        if (!f) return <g key={`g${i}`}>{shape}</g>;
        const crack = f.state.kind === 'sold' ? `M${crackPath(f.id).map(([t, s]) => pt(facetPoint(seg, t, s))).join('L')}` : null;
        return (
          <a
            key={f.id}
            href={reviewPath(f.id)}
            aria-label={`★${f.rating} ${facetStatus(f)} $${f.symbol}`}
            className="cursor-pointer outline-none [&:focus-visible>path:first-child]:stroke-lime"
            onPointerDown={(e) => (touch.current = e.pointerType !== 'mouse')}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onCard?.(at(e, f))}
            onPointerLeave={(e) => e.pointerType === 'mouse' && onCard?.(null)}
            onFocus={(e) => {
              const el = e.currentTarget as unknown as SVGGraphicsElement;
              const r = el.getBoundingClientRect();
              const s = el.ownerSVGElement!.getBoundingClientRect();
              onCard?.({ facet: f, x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top });
            }}
            onBlur={() => onCard?.(null)}
            onClick={(e) => {
              e.preventDefault();
              if (touch.current && onCard) onCard(at(e, f));
              else navigate(reviewPath(f.id));
            }}
          >
            {shape}
            {crack && (
              <>
                <path d={crack} fill="none" stroke={PALETTE.ink} strokeWidth={0.04} strokeLinecap="round" strokeLinejoin="round" />
                <path d={crack} fill="none" stroke={mix(PALETTE.sold, PALETTE.white, 0.35)} strokeWidth={0.01} strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}
          </a>
        );
      })}
      <path d={`M${table}Z`} fill={any ? mix(GEM_GLASS, PALETTE.ink, 0.45) : GEM_GLASS} fillOpacity={any ? 1 : 0.16} stroke={any ? PALETTE.ink : mix(PALETTE.mist, PALETTE.ink, 0.35)} strokeWidth={0.014} strokeLinejoin="round" />
      <path d={`M${girdle}Z`} fill="none" stroke={any ? PALETTE.ink : mix(PALETTE.mist, PALETTE.ink, 0.2)} strokeWidth={0.02} strokeLinejoin="round" />
      {!any && (
        <g clipPath="url(#gem-still-clip)">
          <g transform="rotate(20)">
            <rect x="-2.6" y="-1.6" width="1.2" height="3.2" fill="url(#gem-still-shine)" className="gem-shimmer" />
          </g>
        </g>
      )}
    </svg>
  );
}
