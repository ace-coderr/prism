import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { viberAt, viberImageUrl } from '@prism/core';
import { C, DISPLAY, MONO } from './theme';
import { VoxelCrystal, makeShape } from './VoxelCrystal';
import { DROP, DURATION, EASE_BEZIER, FPS, HOLDINGS, S, T, TOKENS } from './timeline';

export { DURATION, FPS };

/*
 * PRISM in 40 seconds (30 fps, 1200 frames). Short, big captions that read on a phone,
 * over a quiet original soundtrack with synced sound effects (scripts/soundtrack.ts,
 * generated from the same timeline). Works at 16:9 (1920×1080) and 1:1 (1080×1080).
 * Scene boundaries and the moments sounds follow live in timeline.ts.
 */

const ease = Easing.bezier(...EASE_BEZIER);

/** Camera for the crystal scenes, and the world → screen mapping overlays use to line up. */
const CAM = { z: 9, fov: 32 };
const halfHeight = CAM.z * Math.tan(((CAM.fov / 2) * Math.PI) / 180);
function toScreen(x: number, y: number, width: number, height: number) {
  const halfWidth = halfHeight * (width / height);
  return { left: width / 2 + (x / halfWidth) * (width / 2), top: height / 2 - (y / halfHeight) * (height / 2) };
}
/** Where the gifted crystal flies to (world units): the friend's wallet. */
const giftTarget = (square: boolean) => (square ? { x: 1.3, y: 1.2 } : { x: 3.2, y: 0.32 });
const fade = (f: number, [a, b]: readonly [number, number], edge = 12) =>
  interpolate(f, [a, a + edge, b - edge, b], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
const prog = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

function useLayout() {
  const { width, height } = useVideoConfig();
  const square = Math.abs(width - height) < 2;
  // caption size readable on a phone: ~5% of the short side
  const u = Math.min(width, height) / 1080;
  return { width, height, square, u, caption: (square ? 76 : 92) * u };
}

/** A caption whose words rise in one by one; `lime` words are highlighted. */
function Caption({ words, start, size, style }: { words: Array<{ w: string; lime?: boolean }>; start: number; size: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 1.02, letterSpacing: '-0.04em', color: C.white, ...style }}>
      {words.map(({ w, lime }, i) => {
        const s = spring({ frame: f - start - i * 3, fps, config: { damping: 200 }, durationInFrames: 22 });
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - s) * 105}%)`, color: lime ? C.lime : undefined }}>{w}</span>
            {i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </div>
  );
}

const words = (text: string, lime: string[] = []) => text.split(' ').map((w) => ({ w, lime: lime.includes(w) }));

function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { u } = useLayout();
  return (
    <div style={{ fontFamily: MONO, fontSize: 22 * u, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7d858c', ...style }}>{children}</div>
  );
}

// ------------------------------------------------------------------ backdrop

function Backdrop() {
  const f = useCurrentFrame();
  const { width, height } = useLayout();
  const drift = (f / DURATION) * 60;
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)`,
          backgroundSize: `${width / 16}px ${width / 16}px`,
          backgroundPosition: `0 ${drift}px`,
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% ${height * 0.06}px, rgba(212,240,0,0.06), transparent 60%)` }} />
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ scene 1

function Ask() {
  const f = useCurrentFrame();
  const { caption, square } = useLayout();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: square ? '0 90px' : '0 200px', opacity: fade(f, S.ask) }}>
      <Caption
        start={8}
        size={caption * 1.08}
        words={[...words('What if your stock basket was'), ...words('something you could hold?', ['something', 'you', 'could', 'hold?'])]}
      />
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ scene 2-3: token cards

function TokenCard({ t, style }: { t: (typeof TOKENS)[number]; style: CSSProperties }) {
  const { u } = useLayout();
  return (
    <div
      style={{
        position: 'absolute',
        width: 250 * u,
        padding: `${26 * u}px ${24 * u}px`,
        borderRadius: 28 * u,
        border: '1px solid rgba(255,255,255,0.1)',
        background: C.panel,
        boxShadow: '0 30px 60px -30px rgba(0,0,0,0.8)',
        ...style,
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (t.symbol.length > 6 ? 34 : 44) * u, letterSpacing: '-0.03em', color: C.white }}>{t.symbol}</div>
      <div style={{ fontFamily: MONO, fontSize: 20 * u, color: C.mist, marginTop: 8 * u }}>{t.name}</div>
      <div
        style={{
          marginTop: 22 * u,
          height: 8 * u,
          borderRadius: 99,
          background: t.change >= 0 ? C.up : C.down,
          width: `${40 + Math.min(55, Math.abs(t.change) * 6)}%`,
        }}
      />
    </div>
  );
}

function Cards() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height, square, u, caption } = useLayout();
  const cols = square ? 3 : 6;
  const gap = 28 * u;
  const cw = 250 * u;
  const rows = Math.ceil(TOKENS.length / cols);
  const totalW = cols * cw + (cols - 1) * gap;
  const cardH = 190 * u;
  const top0 = height / 2 - (rows * cardH + (rows - 1) * gap) / 2 + (square ? 40 : 30) * u;
  const merge = prog(f, ...T.merge);
  const visible = f < S.fuse[0] + 50;
  return (
    <AbsoluteFill style={{ opacity: f < S.pick[0] + 6 ? 0 : 1 }}>
      <AbsoluteFill style={{ padding: square ? '110px 90px' : '120px 200px', opacity: fade(f, [S.pick[0], S.fuse[0] + 10], 10) }}>
        <Label>01 / Pick</Label>
        <Caption start={S.pick[0] + 4} size={caption * 0.78} style={{ marginTop: 18 * u }} words={words('Pick a few test stocks and some ETH.', ['ETH.'])} />
      </AbsoluteFill>
      {visible &&
        TOKENS.map((t, i) => {
          const s = spring({ frame: f - T.cardIn(i), fps, config: { damping: 18, stiffness: 120 } });
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = width / 2 - totalW / 2 + col * (cw + gap);
          const y = top0 + row * (cardH + gap);
          // fly to the centre and shrink into the crystal
          const cx = width / 2 - cw / 2;
          const cy = height / 2 - cardH / 2;
          return (
            <TokenCard
              key={t.symbol}
              t={t}
              style={{
                left: x + (cx - x) * merge,
                top: y + (1 - s) * 200 * u + (cy - y) * merge,
                opacity: s * (1 - merge),
                transform: `scale(${1 - 0.8 * merge}) rotate(${(i - 2.5) * 6 * merge}deg)`,
              }}
            />
          );
        })}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ scenes 3-6: the crystal

function CrystalLayer() {
  const f = useCurrentFrame();
  const { width, height, square } = useLayout();
  const shape = useMemo(() => makeShape(HOLDINGS, DROP), []);
  if (f < S.fuse[0] + 10 || f > S.trust[0] + 12) return null;

  const assemble = prog(f, ...T.assemble);
  const crack = prog(f, ...T.crack);
  const heal = prog(f, ...T.heal);
  const frost = prog(f, ...T.frost);
  // gentle sway around the seam-facing angle; a slow half turn while reading
  const readTurn = interpolate(f, [S.read[0], S.read[1]], [0, Math.PI * 0.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const backTurn = interpolate(f, [S.read[1], S.read[1] + 30], [0, -Math.PI * 0.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const yaw = Math.sin(f / 45) * 0.28 + readTurn + backTurn;
  // gift: the crystal flies off to a friend (right; down on square)
  const fly = prog(f, ...T.fly);
  const target = giftTarget(square);
  const shrink = 1 - 0.55 * fly;
  const seamShift = square ? 0 : prog(f, S.seam[0], S.seam[0] + 25) * -1.5 * (1 - prog(f, S.gift[0], S.gift[0] + 25));
  const lift = square ? 0.25 : 0.32;
  // square: step down under the price line during the gold-seam scene
  const seamDrop = square ? -0.55 * prog(f, S.seam[0], S.seam[0] + 25) * (1 - prog(f, S.gift[0], S.gift[0] + 25)) : 0;
  const opacity = interpolate(f, [S.trust[0] - 8, S.trust[0] + 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity }}>
      <ThreeCanvas width={width} height={height} camera={{ position: [0, 0, CAM.z], fov: CAM.fov }} gl={{ antialias: true }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 7, 5]} intensity={0.8} />
        <directionalLight position={[-5, -2, -3]} intensity={0.25} color="#d4f000" />
        <VoxelCrystal
          shape={shape}
          size={(square ? 1.35 : 1.45) * shrink}
          position={[seamShift + target.x * fly, lift + seamDrop + (target.y - lift) * fly + Math.sin(f / 30) * 0.05, 0]}
          state={{ assemble, crack, heal, frost, yaw }}
        />
      </ThreeCanvas>
    </AbsoluteFill>
  );
}

function Fuse() {
  const f = useCurrentFrame();
  const { caption, square, u } = useLayout();
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: square ? '0 70px 90px' : '0 0 90px', opacity: fade(f, S.fuse) }}>
      <Caption start={S.fuse[0] + 70} size={caption * 0.82} style={{ textAlign: 'center' }} words={[...words('One crystal.', ['One', 'crystal.']), ...words('Your whole basket.')]} />
      <Label style={{ marginTop: 18 * u }}>02 / Forge</Label>
    </AbsoluteFill>
  );
}

function Read() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height, square, u, caption } = useLayout();
  const items = [
    { k: 'Size', v: 'how much', color: C.white },
    { k: 'Green / red', v: 'today’s move', color: C.up },
    { k: 'Spikes', v: 'how jumpy', color: C.white },
  ];
  return (
    <AbsoluteFill style={{ opacity: fade(f, S.read) }}>
      <div style={{ position: 'absolute', left: square ? 70 * u : 200 * u, top: square ? 90 * u : 120 * u }}>
        <Label>03 / Read it</Label>
      </div>
      {items.map((it, i) => {
        const s = spring({ frame: f - S.read[0] - 15 - i * 30, fps, config: { damping: 200 }, durationInFrames: 25 });
        const left = square ? 70 * u : i === 1 ? width * 0.655 : width * 0.08;
        const top = square ? height * (0.7 + i * 0.075) : height * (0.32 + i * 0.18);
        return (
          <div key={it.k} style={{ position: 'absolute', left, top, whiteSpace: 'nowrap', opacity: s, transform: `translateX(${(1 - s) * (i === 1 && !square ? 40 : -40)}px)` }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: caption * (square ? 0.52 : 0.58), letterSpacing: '-0.03em', color: it.k === 'Green / red' ? C.up : C.lime }}>
              {it.k === 'Green / red' ? (
                <>
                  <span style={{ color: C.up }}>Green</span> <span style={{ color: C.mist }}>/</span> <span style={{ color: C.down }}>red</span>
                </>
              ) : (
                it.k
              )}
            </span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: caption * (square ? 0.52 : 0.58), letterSpacing: '-0.03em', color: C.white }}> = {it.v}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function Seam() {
  const f = useCurrentFrame();
  const { width, height, square, u, caption } = useLayout();
  // a price line: steady, drops 12%, climbs back above its peak
  const W = (square ? 760 : 620) * u;
  const H = (square ? 170 : 300) * u;
  const pts = [0, 0.04, 0.02, 0.06, 0.05, 0.3, 0.55, 0.62, 0.5, 0.35, 0.12, 0.04, -0.02, -0.04];
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H * 0.25 + v * H * 0.9}`).join(' ');
  // linear, so the dip lands as the crack opens and the climb back as it turns gold
  const draw = interpolate(f, [S.seam[0] + 10, S.seam[0] + 155], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const healed = prog(f, ...T.heal);
  const left = square ? (width - W) / 2 : width * 0.6;
  const top = square ? 70 * u : height * 0.2;
  return (
    <AbsoluteFill style={{ opacity: fade(f, S.seam) }}>
      <div style={{ position: 'absolute', left: square ? 70 * u : 200 * u, top: square ? 60 * u : 120 * u }}>{!square && <Label>04 / Gold seams</Label>}</div>
      <svg style={{ position: 'absolute', left, top }} width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1={0} x2={W} y1={H * 0.25} y2={H * 0.25} stroke="rgba(255,255,255,0.18)" strokeDasharray="6 8" />
        <polyline
          points={path}
          fill="none"
          stroke={healed > 0.5 ? C.gold : C.down}
          strokeWidth={6 * u}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
        />
        <text x={W * 0.56} y={Math.min(H - 8 * u, H * 0.25 + 0.62 * H * 0.9 + 30 * u)} fill={C.down} fontFamily={MONO} fontSize={26 * u} opacity={prog(f, S.seam[0] + 60, S.seam[0] + 75)}>
          −12%
        </text>
        <text x={W - 170 * u} y={H * 0.25 - 18 * u} fill={C.gold} fontFamily={MONO} fontSize={24 * u} opacity={healed}>
          recovered
        </text>
      </svg>
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: square ? 'center' : 'flex-start', padding: square ? '0 70px 80px' : `0 0 ${height * 0.2}px ${width * 0.6}px` }}>
        <Caption
          start={S.seam[0] + 125}
          size={caption * (square ? 0.72 : 0.7)}
          style={{ textAlign: square ? 'center' : 'left', maxWidth: square ? undefined : width * 0.34 }}
          words={[...words('Gold seams', ['Gold', 'seams']), ...words('= drops your basket survived.')]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Gift() {
  const f = useCurrentFrame();
  const { width, height, square, u, caption } = useLayout();
  const sealed = prog(f, S.gift[0] + 10, S.gift[0] + 30);
  const friend = prog(f, S.gift[0] + 45, S.gift[0] + 65);
  const t = giftTarget(square);
  const ring = toScreen(t.x, t.y, width, height);
  const got = prog(f, T.received, T.received + 15);
  return (
    <AbsoluteFill style={{ opacity: fade(f, S.gift) }}>
      <div
        style={{
          position: 'absolute',
          left: square ? 70 * u : width * 0.42 - 20 * u,
          top: square ? height * 0.1 : height * 0.2,
          padding: `${10 * u}px ${20 * u}px`,
          borderRadius: 99,
          border: `1px solid ${C.frost}`,
          color: C.frost,
          fontFamily: MONO,
          fontSize: 24 * u,
          letterSpacing: '0.14em',
          opacity: sealed * (1 - got),
        }}
      >
        ❄ SEALED GIFT
      </div>
      {/* the friend's wallet: an open ring the crystal flies into */}
      <div
        style={{
          position: 'absolute',
          left: ring.left - 170 * u,
          top: ring.top - 170 * u,
          width: 340 * u,
          opacity: friend,
          transform: `scale(${0.9 + 0.1 * friend})`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 340 * u,
            height: 340 * u,
            borderRadius: '50%',
            border: `${3 * u}px dashed ${got > 0.5 ? C.lime : 'rgba(255,255,255,0.22)'}`,
            boxShadow: got > 0.5 ? `0 0 ${80 * u}px rgba(212,240,0,0.25), inset 0 0 ${60 * u}px rgba(212,240,0,0.12)` : 'none',
          }}
        />
        <div style={{ fontFamily: MONO, fontSize: 24 * u, color: got > 0.5 ? C.lime : C.mist, marginTop: 18 * u, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          {got > 0.5 ? 'a friend’s wallet ✓' : 'a friend’s wallet'}
        </div>
      </div>
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: square ? '0 60px 80px' : '0 0 100px' }}>
        <Caption
          start={S.gift[0] + 12}
          size={caption * (square ? 0.7 : 0.78)}
          style={{ textAlign: 'center' }}
          words={[...words('Seal it. Gift it.', ['Seal', 'it.', 'Gift']), ...words('The basket goes with it.')]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Trust() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { caption, square, u } = useLayout();
  const lines = ['No admin.', 'Only you can withdraw.', 'Verified on-chain.'];
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: square ? '0 90px' : '0 240px', opacity: fade(f, S.trust) }}>
      <Label style={{ marginBottom: 30 * u }}>05 / Built to be trusted</Label>
      {lines.map((l, i) => {
        const s = spring({ frame: f - T.trustLine(i), fps, config: { damping: 200 }, durationInFrames: 20 });
        return (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 28 * u, opacity: s, transform: `translateY(${(1 - s) * 40}px)`, marginTop: 10 * u }}>
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: caption * 0.8,
                height: caption * 0.8,
                borderRadius: '50%',
                background: 'rgba(212,240,0,0.12)',
                border: `2px solid ${C.lime}`,
                color: C.lime,
                fontSize: caption * 0.45,
                fontFamily: DISPLAY,
              }}
            >
              ✓
            </span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: caption * 0.9, letterSpacing: '-0.04em', color: i === 1 ? C.lime : C.white }}>{l}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ end card

const GEM = ['..AAA..', '.ABBBA.', 'ABBGBBA', '.CCCCC.', '..CCC..', '...C...'];
const SHADES: Record<string, string> = { A: '#e6ff5c', B: '#d4f000', C: '#8fa300', G: '#f6c143' };

function Logo({ size }: { size: number }) {
  return (
    <svg viewBox="-1 -1 23 20" width={size} height={size}>
      {GEM.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === '.' ? null : <rect key={`${x}-${y}`} x={x * 3} y={y * 3} width={3} height={3} fill={SHADES[ch]} stroke="#000" strokeWidth={0.7} />,
        ),
      )}
    </svg>
  );
}

function End() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { square, u, caption } = useLayout();
  const s = spring({ frame: f - T.end, fps, config: { damping: 200 }, durationInFrames: 24 });
  const v = spring({ frame: f - S.end[0] - 12, fps, config: { damping: 16 } });
  const viber = viberAt(0);
  return (
    <AbsoluteFill style={{ opacity: interpolate(f, [S.end[0], S.end[0] + 10], [0, 1], { extrapolateRight: 'clamp' }) }}>
      <AbsoluteFill
        style={{
          flexDirection: square ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: (square ? 50 : 110) * u,
          padding: '0 80px',
        }}
      >
        <div style={{ opacity: s, transform: `translateY(${(1 - s) * 30}px)`, textAlign: square ? 'center' : 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 * u, justifyContent: square ? 'center' : 'flex-start' }}>
            <Logo size={88 * u} />
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 84 * u, letterSpacing: '-0.04em', color: C.white }}>PRISM</span>
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: caption * 0.82, letterSpacing: '-0.04em', color: C.lime, marginTop: 34 * u }}>
            prism-crystal.vercel.app
          </div>
          <div style={{ fontFamily: MONO, fontSize: 26 * u, color: C.mist, marginTop: 22 * u, letterSpacing: '0.04em' }}>
            Built for vibe/vibe on Robinhood Chain Testnet
          </div>
        </div>
        <div style={{ opacity: v, transform: `scale(${0.85 + 0.15 * v})`, textAlign: 'center' }}>
          <Img
            src={viberImageUrl(viber.file)}
            crossOrigin="anonymous"
            style={{ width: (square ? 260 : 340) * u, height: (square ? 260 : 340) * u, borderRadius: 28 * u, display: 'block' }}
          />
          <div style={{ fontFamily: MONO, fontSize: 16 * u, color: 'rgba(154,162,169,0.7)', marginTop: 12 * u }}>vibe viber © vibe/vibe</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ composition

export function Explainer() {
  return (
    <AbsoluteFill>
      {/* generated by scripts/soundtrack.ts (music + effects, plus apps/video/voiceover.mp3 if present) */}
      <Audio src={staticFile('audio/soundtrack.wav')} />
      <Backdrop />
      <Sequence durationInFrames={S.ask[1]} layout="none">
        <Ask />
      </Sequence>
      <Cards />
      <CrystalLayer />
      <Fuse />
      <Read />
      <Seam />
      <Gift />
      <Trust />
      <End />
    </AbsoluteFill>
  );
}
