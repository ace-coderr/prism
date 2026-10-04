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
import { DataBadge, EthPrice, Panel } from '../components/ui';
import { ViberBillboard, ViberCredit, ViberGuide, useOwnersVibers } from '../components/Viber';
import { holdingsFromAssets, marketLookup } from '../data/crystalHoldings';
import { useTestnetTokens } from '../data/chain';
import { useAllCrystals, type PublicCrystal } from '../data/crystals';
import { CORRELATIONS, EXAMPLES, toHoldings } from '../data/mock';
import { TARGET_CHAIN } from '../wallet/config';
import { shortAddress } from '../wallet/WalletButton';

/** Below this many real crystals, an "Examples" row (sample data) is shown too. */
const MIN_REAL = 6;
const SPACING = 3.3;
const ROW_SPACING = 3.2;
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
              correlation={CORRELATIONS}
              sealed={it.sealed}
              position={it.companion ? [p[0] - 0.5, p[1], p[2]] : p}
              size={1.05}
              spin={0.12 + (i % 3) * 0.05}
            />
            {it.companion && <ViberBillboard viber={it.companion} position={[p[0] + 0.85, p[1] - 1.05, p[2] + 0.2]} height={1.25} />}
            <SceneLabel position={[p[0], p[1] - 1.45, p[2]]} center>
              <div className="pointer-events-none whitespace-nowrap rounded-full border border-white/10 bg-ink/85 px-3 py-1 text-center">
                <span className="font-display text-sm font-bold text-white">{it.label}</span>
                {it.sublabel && <span className="ml-2 font-mono text-[10px] text-mist">{it.sublabel}</span>}
              </div>
            </SceneLabel>
          </group>
        );
      })}
      {interactive && (
        <OrbitControls makeDefault enableDamping enablePan={false} minDistance={3} maxDistance={40} autoRotate={items.length > GRID_MAX} autoRotateSpeed={0.35} />
      )}
    </>
  );
}

const fmtQty = (v: bigint, d: number) =>
  Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 4 });

function RealCrystalCard({ c, totalEth }: { c: PublicCrystal; totalEth: number }) {
  const sealed = c.sealedUntil * 1000 > Date.now();
  return (
    <Panel className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-xl font-bold">Crystal #{c.id.toString()}</p>
        {totalEth > 0 && <EthPrice eth={totalEth} />}
      </div>
      <p className="mt-0.5 font-mono text-[11px] text-mist">
        owner {shortAddress(c.owner)}
        {sealed ? ' · ❄ sealed gift' : ''}
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {c.assets.map((a) => (
          <li key={a.token ?? 'eth'} className="chip">
            {fmtQty(a.amount, a.decimals)} {a.symbol}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function Gallery() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  const all = useAllCrystals();
  const live = useTestnetTokens();
  const marketOf = marketLookup(live.status === 'live' ? live.tokens : undefined);
  const real = all.data ?? [];
  const vibers = useOwnersVibers(real.map((c) => c.owner));

  const realItems: SceneItem[] = real.map((c) => ({
    key: `r${c.id}`,
    holdings: holdingsFromAssets(c.assets, marketOf).holdings,
    label: `#${c.id}`,
    sublabel: shortAddress(c.owner),
    sealed: c.sealedUntil * 1000 > Date.now(),
    companion: vibers.get(c.owner.toLowerCase()) ?? null,
  }));
  const exampleItems: SceneItem[] = EXAMPLES.map((e) => ({
    key: e.id,
    holdings: toHoldings(e.weights),
    history: e.history,
    label: e.name,
    sublabel: 'sample',
  }));
  const showExamples = !all.isLoading && real.length < MIN_REAL;

  return (
    <PageScroll className="max-w-7xl gap-8">
      <PageHeader title="Gallery" subtitle="Every crystal forged on PRISM — who owns it and what is inside. Drag to look around.">
        <DataBadge live={!!deployment && all.isSuccess} />
      </PageHeader>

      {/* ------------------------------------------------------------ real crystals */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="headline text-2xl">Forged on PRISM</h2>
          <p className="font-mono text-[11px] text-mist">
            {all.isLoading ? 'reading the chain…' : `${real.length} real crystal${real.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {all.isError && <p className="text-sm text-down">Couldn’t read crystals from the chain right now. Try again in a moment.</p>}
        {all.isSuccess && real.length === 0 && (
          <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <ViberGuide index={8}>No crystals have been forged yet. Yours could be the first one here.</ViberGuide>
            <Link to="/forge" className="btn btn-primary">
              Forge the first one
            </Link>
          </Panel>
        )}
        {real.length > 0 && (
          <>
            <div className="relative h-[380px] overflow-hidden rounded-3xl border border-white/10 sm:h-[440px]">
              <Stage className="!absolute inset-0" camera={{ position: [0, 3, 11], fov: 45 }}>
                <CrystalScene items={realItems} interactive />
              </Stage>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {real.map((c) => (
                <RealCrystalCard key={c.id.toString()} c={c} totalEth={holdingsFromAssets(c.assets, marketOf).totalEth} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* ------------------------------------------------------------ examples (sample) */}
      {showExamples && (
        <section className="space-y-4 border-t border-white/10 pt-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="headline text-2xl">Examples</h2>
                <DataBadge live={false} />
              </div>
              <p className="mt-1 text-sm text-mist">Made-up crystals that show what PRISM crystals can look like. Not real, not owned by anyone.</p>
            </div>
          </div>
          <div className="relative h-[360px] overflow-hidden rounded-3xl border border-white/10 sm:h-[420px]">
            <Stage className="!absolute inset-0" camera={{ position: [0, 3, 12], fov: 45 }}>
              <CrystalScene items={exampleItems} interactive />
            </Stage>
          </div>
        </section>
      )}
      <ViberCredit />
    </PageScroll>
  );
}
