import { useLayoutEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { formatUnits } from 'viem';
import { getDeployment, type CrystalHistory, type Holding, type OwnedViber } from '@prism/core';
import { Crystal } from '../components/Crystal';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { SceneLabel, Stage } from '../components/Stage';
import { EthPrice, LiveBadge } from '../components/ui';
import { LoadingStage } from '../components/LoadingStage';
import { Reveal, SectionLabel } from '../components/design';
import { ViberBillboard, ViberGuide, useOwnersVibers } from '../components/Viber';
import { holdingsFromAssets, marketLookup, realCrystalHistory } from '../data/crystalHoldings';
import { useTestnetTokens } from '../data/chain';
import { earliestForge, useGalleryCrystals, type PublicCrystal } from '../data/crystals';
import { TARGET_CHAIN } from '../wallet/config';
import { shortAddress } from '../wallet/WalletButton';

/** Below this many crystals, a viber invites people to forge one. */
const FEW = 6;
const SPACING = 3.9;
const ROW_SPACING = 3.7;
/** Up to this many crystals stand in a grid; more stand in a ring you can orbit. */
const GRID_MAX = 8;

interface SceneItem {
  key: string;
  holdings: Holding[];
  history?: CrystalHistory;
  label: string;
  sublabel?: string;
  sealed?: boolean;
  companion?: OwnedViber | null;
}

/**
 * Up to GRID_MAX crystals stand in a grid whose column count follows the box's shape
 * (one row on a wide screen, two columns on a phone); more stand in a ring you can orbit.
 */
function layout(n: number, aspect: number): Array<[number, number, number]> {
  if (n <= GRID_MAX) {
    const cols = Math.min(n, Math.max(1, Math.round(aspect * 2)));
    const rows = Math.ceil(n / cols);
    return Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? n - row * cols : cols;
      return [((i % cols) - (inRow - 1) / 2) * SPACING, ((rows - 1) / 2 - row) * ROW_SPACING, 0];
    });
  }
  const r = (n * SPACING) / (2 * Math.PI);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.sin(a) * r, Math.sin(a * 3) * 0.3, Math.cos(a) * r];
  });
}

/** Camera direction: a little above the crystals, looking at the middle of the arrangement. */
const VIEW_DIR = new THREE.Vector3(0, 0.28, 0.96).normalize();

/**
 * Moves the camera along VIEW_DIR to the closest distance where every point is on screen
 * (a binary search on the projected points), so a row or a ring fills the frame.
 */
function FitScene({ points }: { points: THREE.Vector3[] }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useLayoutEffect(() => {
    const v = new THREE.Vector3();
    const place = (d: number) => {
      camera.position.copy(VIEW_DIR).multiplyScalar(d);
      camera.lookAt(0, 0, 0);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    };
    const fits = (d: number) => {
      place(d);
      return points.every((p) => {
        v.copy(p).project(camera);
        return Math.abs(v.x) <= 0.9 && Math.abs(v.y) <= 0.88 && v.z < 1;
      });
    };
    let lo = 2;
    let hi = 80;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    place(hi);
  }, [camera, aspect, points]);
  return null;
}

/** Corners of the space one crystal (and its label, and its viber) takes up. */
function boundsAt([x, y, z]: [number, number, number], companion: boolean): THREE.Vector3[] {
  const left = x - 1;
  const right = x + (companion ? 1.6 : 1);
  const out: THREE.Vector3[] = [];
  for (const bx of [left, right]) for (const by of [y + 1, y - 1.65]) for (const bz of [z - 1, z + 1]) out.push(new THREE.Vector3(bx, by, bz));
  return out;
}

function CrystalScene({ items, interactive }: { items: SceneItem[]; interactive: boolean }) {
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const positions = useMemo(() => layout(items.length, aspect), [items.length, aspect]);
  // items is a fresh array every render; only re-fit when the layout or a viber changes
  const companionKey = items.map((i) => (i.companion ? 1 : 0)).join('');
  const points = useMemo(
    () => positions.flatMap((p, i) => boundsAt(p, companionKey[i] === '1')),
    [positions, companionKey],
  );
  return (
    <>
      <FitScene points={points} />
      {items.map((it, i) => {
        const p = positions[i]!;
        return (
          <group key={it.key}>
            <Crystal
              holdings={it.holdings}
              history={it.history}
              sealed={it.sealed}
              position={it.companion ? [p[0] - 0.5, p[1], p[2]] : p}
              size={1.05}
              spin={0.12 + (i % 3) * 0.05}
            />
            {it.companion && <ViberBillboard viber={it.companion} position={[p[0] + 0.85, p[1] - 1.05, p[2] + 0.2]} height={1.25} />}
            <SceneLabel position={[p[0], p[1] - 1.45, p[2]]} center>
              <div className="pointer-events-none whitespace-nowrap rounded-full border border-white/15 bg-ink/90 px-4 py-1.5 text-center shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]">
                <span className="font-display text-base font-bold text-white">{it.label}</span>
                {it.sublabel && <span className="ml-2 font-mono text-[11px] text-mist">{it.sublabel}</span>}
              </div>
            </SceneLabel>
          </group>
        );
      })}
      {interactive && (
        <OrbitControls makeDefault enableDamping enablePan={false} enableZoom={false} autoRotate={items.length > GRID_MAX} autoRotateSpeed={0.35} />
      )}
    </>
  );
}

const fmtQty = (v: bigint, d: number) =>
  Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 4 });

function RealCrystalCard({ c, totalEth }: { c: PublicCrystal; totalEth: number }) {
  const sealed = c.sealedUntil * 1000 > Date.now();
  return (
    <div className="card card-hover h-full p-7">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-2xl font-bold tracking-[-0.02em]">Crystal #{c.id.toString()}</p>
        {totalEth > 0 && <EthPrice eth={totalEth} />}
      </div>
      <p className="mt-2 font-mono text-[11px] text-mist">
        owner {shortAddress(c.owner)}
        {sealed ? ' · ❄ sealed gift' : ''}
      </p>
      <ul className="mt-6 flex flex-wrap gap-2">
        {c.assets.map((a) => (
          <li key={a.token ?? 'eth'} className="chip">
            {fmtQty(a.amount, a.decimals)} {a.symbol}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Gallery() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  // live read once it lands; the cached snapshot (with server-side seams) until then
  const gallery = useGalleryCrystals();
  // price history must reach back to the oldest crystal's forge block
  const live = useTestnetTokens(earliestForge(gallery.crystals ?? undefined));
  const marketOf = useMemo(() => marketLookup(live.status === 'live' ? live.tokens : undefined), [live]);
  const real = useMemo(() => gallery.crystals ?? [], [gallery.crystals]);
  const vibers = useOwnersVibers(real.map((c) => c.owner));
  // stable per crystal, so each 3D crystal is only rebuilt when its data changes
  const shapes = useMemo(
    () =>
      new Map(
        real.map((c) => [
          c.id,
          {
            holdings: holdingsFromAssets(c.assets, marketOf).holdings,
            history: realCrystalHistory(live, c) ?? gallery.snapshotHistory.get(c.id) ?? undefined,
          },
        ]),
      ),
    [real, live, marketOf, gallery.snapshotHistory],
  );

  const realItems: SceneItem[] = real.map((c) => ({
    key: `r${c.id}`,
    holdings: shapes.get(c.id)!.holdings,
    history: shapes.get(c.id)!.history,
    label: `#${c.id}`,
    sublabel: shortAddress(c.owner),
    sealed: c.sealedUntil * 1000 > Date.now(),
    companion: vibers.get(c.owner.toLowerCase()) ?? null,
  }));
  return (
    <PageScroll>
      <PageHeader
        label="Gallery"
        lead="Every crystal,"
        accent="on-chain."
        subtitle="Every crystal ever forged on PRISM: who owns it and what is inside. Drag the scene to look around."
      >
        {!!deployment && gallery.crystals && <LiveBadge>{gallery.live ? 'Live testnet data' : 'Testnet data · refreshing'}</LiveBadge>}
      </PageHeader>

      <section className="flex flex-col gap-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionLabel>Forged on PRISM</SectionLabel>
          <p className="font-mono text-xs text-mist">
            {gallery.loading ? 'reading the chain…' : `${real.length} crystal${real.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {gallery.loading && <LoadingStage label="Reading every crystal from the chain…" />}
        {gallery.error && <p className="text-sm text-down">Couldn’t read crystals from the chain right now. Try again in a moment.</p>}
        {real.length > 0 && (
          <Reveal>
            <div className="relative h-[420px] overflow-hidden rounded-[32px] border border-white/[0.08] sm:h-[520px]">
              <Stage className="!absolute inset-0" camera={{ position: [0, 3, 11], fov: 45 }}>
                <CrystalScene items={realItems} interactive />
              </Stage>
            </div>
          </Reveal>
        )}
        {real.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            {real.map((c, i) => (
              <Reveal key={c.id.toString()} delay={Math.min(i, 6) * 0.06}>
                <RealCrystalCard c={c} totalEth={holdingsFromAssets(c.assets, marketOf).totalEth} />
              </Reveal>
            ))}
          </div>
        )}
        {gallery.crystals && real.length < FEW && (
          <Reveal>
            <div className="card flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between">
              <ViberGuide index={8} size={80}>
                Be one of the first. Forge a crystal.
              </ViberGuide>
              <Link to="/forge" className="btn btn-primary btn-lg">
                Forge a crystal
              </Link>
            </div>
          </Reveal>
        )}
      </section>
    </PageScroll>
  );
}
