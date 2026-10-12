/**
 * The hero's living gem in 3D (plain three.js, loaded on demand): a low-poly cut gem, flat shaded
 * with thin dark outlines, turning slowly. Each crown facet is one review (see @prism/core gem.ts):
 * colored by rating, sized by position, grey and cracked when SOLD, dimmer when trimmed. Facets
 * without a review are clear glass with a soft shimmer. Pauses when off screen or hidden.
 */
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GEM_GLASS, GEM_TABLE, PALETTE, crackPath, facetColor, mix, type GemFacet, type GemSegment } from '@prism/core';

export interface GemScene {
  update(segments: GemSegment[]): void;
  dispose(): void;
}

export interface GemHandlers {
  /** the pointer is over a review facet (null: over none); x, y relative to the host */
  onHover(facet: GemFacet | null, x: number, y: number): void;
  /** a review facet was clicked or tapped */
  onPick(facet: GemFacet, x: number, y: number, pointerType: string): void;
}

const R = 1.5; // girdle radius
const CROWN = 0.72; // table height above the girdle
const BAND = 0.1; // girdle thickness
const CULET = -1.6; // pavilion point
const GLASS_EDGE = mix(PALETTE.mist, PALETTE.ink, 0.35);

type V = [number, number, number];
const ring = (a: number, r: number, y: number): V => [Math.cos(a) * r, y, Math.sin(a) * r];
const lerp = (p: V, q: V, t: number): V => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

/** Triangles facing outward from the gem's centre, flat (one normal per face). */
function faces(tris: V[][]): BufferGeometry {
  const pos: number[] = [];
  for (const [a, b, c] of tris as Array<[V, V, V]>) {
    const ab = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = ab.cross(ac);
    const out = n.dot(new Vector3((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 + 0.3, (a[2] + b[2] + c[2]) / 3)) >= 0;
    pos.push(...a, ...(out ? b : c), ...(out ? c : b));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The outlines: every polygon edge (once) as a thin square tube, so it reads at any pixel density. */
function edges(loops: V[][], r: number): BufferGeometry {
  const seen = new Set<string>();
  const key = (p: V) => p.map((v) => v.toFixed(3)).join();
  const pos: number[] = [];
  for (const loop of loops) {
    loop.forEach((p, i) => {
      const q = loop[(i + 1) % loop.length]!;
      const k = [key(p), key(q)].sort().join('|');
      if (seen.has(k)) return;
      seen.add(k);
      const a = new Vector3(...p);
      const b = new Vector3(...q);
      const d = new Vector3().subVectors(b, a).normalize();
      const u = new Vector3(0, 1, 0).cross(d);
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(d);
      u.normalize().multiplyScalar(r);
      const w = new Vector3().crossVectors(d, u).normalize().multiplyScalar(r);
      const ring4 = [u.clone().add(w), u.clone().sub(w), u.clone().negate().sub(w), u.clone().negate().add(w)];
      for (let j = 0; j < 4; j++) {
        const o1 = ring4[j]!;
        const o2 = ring4[(j + 1) % 4]!;
        const [a1, a2, b1, b2] = [a.clone().add(o1), a.clone().add(o2), b.clone().add(o1), b.clone().add(o2)];
        pos.push(...a1.toArray(), ...b1.toArray(), ...a2.toArray(), ...a2.toArray(), ...b1.toArray(), ...b2.toArray());
      }
    });
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** A thin flat strip along a polyline lying on a face (normal n), lifted a hair off it. */
function strip(points: V[], n: Vector3, width: number, lift0: number): BufferGeometry {
  const tris: number[] = [];
  const lift = n.clone().multiplyScalar(lift0);
  for (let i = 0; i < points.length - 1; i++) {
    const p = new Vector3(...points[i]!).add(lift);
    const q = new Vector3(...points[i + 1]!).add(lift);
    const w = width * (1 - (i / points.length) * 0.6);
    const side = new Vector3().subVectors(q, p).cross(n).normalize().multiplyScalar(w / 2);
    const [a, b, c, d] = [p.clone().add(side), p.clone().sub(side), q.clone().add(side), q.clone().sub(side)];
    tris.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...b.toArray(), ...d.toArray(), ...c.toArray());
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tris, 3));
  return g;
}

interface Facet {
  mesh: Mesh;
  mat: MeshLambertMaterial;
  facet: GemFacet | null;
  mid: number;
}

export function mountGem(host: HTMLElement, segments: GemSegment[], handlers: GemHandlers): GemScene {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 2.3, 6.3);
  camera.lookAt(0, -0.4, 0);
  scene.add(new AmbientLight(0xffffff, 1.1));
  const sun = new DirectionalLight(0xffffff, 1.9);
  sun.position.set(-2.5, 5, 3);
  scene.add(sun);
  const fill = new DirectionalLight(0xffffff, 0.9); // from below the front, so the pavilion shows
  fill.position.set(1.5, -3, 4);
  scene.add(fill);

  const gem = new Group();
  gem.rotation.x = 0.12;
  scene.add(gem);
  let crown: Facet[] = [];

  const build = (segs: GemSegment[]) => {
    for (const o of [...gem.children]) {
      gem.remove(o);
      const m = o as Mesh;
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
    crown = [];
    const any = segs.some((s) => s.facet);
    const pavilion: V[][] = [];
    const pavilionColors: number[] = [];
    const loops: V[][] = [];
    for (const seg of segs) {
      const g0 = ring(seg.a0, R, 0);
      const g1 = ring(seg.a1, R, 0);
      const t0 = ring(seg.a0, R * GEM_TABLE, CROWN);
      const t1 = ring(seg.a1, R * GEM_TABLE, CROWN);
      const b0 = ring(seg.a0, R, -BAND);
      const b1 = ring(seg.a1, R, -BAND);
      const f = seg.facet;
      const color = f ? facetColor(f) : GEM_GLASS;
      // with reviews the gem is solid and empty facets are pale glass; with none it's all clear glass
      const mat = new MeshLambertMaterial({
        color: f || !any ? color : mix(GEM_GLASS, PALETTE.ink, 0.3),
        emissive: new Color(color).multiplyScalar(f ? 0.28 : 0.1),
        transparent: !any,
        opacity: any ? 1 : 0.32,
        side: any ? FrontSide : DoubleSide,
        depthWrite: any,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new Mesh(faces([[g0, g1, t1], [g0, t1, t0]]), mat);
      mesh.userData.facet = f;
      gem.add(mesh);
      crown.push({ mesh, mat, facet: f, mid: (seg.a0 + seg.a1) / 2 });
      loops.push([g0, g1, t1, t0]);
      // the girdle band and the pavilion below carry the facet's color, darker (its depth)
      const deep = f ? mix(color, PALETTE.ink, 0.42) : mix(GEM_GLASS, PALETTE.ink, 0.45);
      const culet: V = [0, CULET, 0];
      pavilion.push([g0, g1, b1], [g0, b1, b0], [b0, b1, culet]);
      for (let k = 0; k < 9; k++) pavilionColors.push(...new Color(deep).toArray());
      loops.push([b0, b1, culet], [g0, g1, b1, b0]);
      if (f?.state.kind === 'sold') {
        const n = new Vector3()
          .subVectors(new Vector3(...g1), new Vector3(...g0))
          .cross(new Vector3().subVectors(new Vector3(...t0), new Vector3(...g0)))
          .normalize();
        if (n.y < 0) n.negate();
        const pts = crackPath(f.id).map(([t, s]) => {
          const u = (s + 1) / 2;
          return lerp(lerp(g0, g1, u), lerp(t0, t1, u), t);
        });
        gem.add(new Mesh(strip(pts, n, 0.075, 0.006), new MeshBasicMaterial({ color: PALETTE.ink, side: DoubleSide })));
        gem.add(new Mesh(strip(pts, n, 0.02, 0.011), new MeshBasicMaterial({ color: mix(PALETTE.sold, PALETTE.white, 0.4), side: DoubleSide })));
      }
    }
    // the table
    const table: V[] = segs.map((s) => ring(s.a0, R * GEM_TABLE, CROWN));
    const tableTris = table.map((p, i): V[] => [[0, CROWN, 0], p, table[(i + 1) % table.length]!]);
    const tableMat = new MeshLambertMaterial({
      color: any ? mix(GEM_GLASS, PALETTE.ink, 0.45) : GEM_GLASS,
      emissive: new Color(GEM_GLASS).multiplyScalar(0.12),
      transparent: !any,
      opacity: any ? 1 : 0.32,
      side: any ? FrontSide : DoubleSide,
      depthWrite: any,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    gem.add(new Mesh(faces(tableTris), tableMat));
    loops.push(table);

    const body = faces(pavilion);
    body.setAttribute('color', new Float32BufferAttribute(pavilionColors, 3));
    gem.add(
      new Mesh(
        body,
        new MeshLambertMaterial({ vertexColors: true, transparent: !any, opacity: any ? 1 : 0.3, depthWrite: any, side: any ? FrontSide : DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      ),
    );
    gem.add(new Mesh(edges(loops, any ? 0.018 : 0.012), new MeshBasicMaterial({ color: any ? PALETTE.ink : GLASS_EDGE, transparent: !any, opacity: any ? 1 : 0.75, side: DoubleSide })));
  };
  build(segments);

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let visible = true;
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
  });
  io.observe(host);

  // pointing at facets
  const ray = new Raycaster();
  const ndc = new Vector2();
  let hovered: Facet | null = null;
  const hit = (e: PointerEvent | MouseEvent): { f: Facet | null; x: number; y: number } => {
    const r = renderer.domElement.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // crown facets only (front faces), so outlines and cracks don't get in the way
    const first = ray.intersectObjects(crown.map((c) => c.mesh), false)[0];
    const f = first ? (crown.find((c) => c.mesh === first.object && c.facet) ?? null) : null;
    return { f, x, y };
  };
  const setHovered = (f: Facet | null) => {
    if (hovered === f) return;
    hovered = f;
    renderer.domElement.style.cursor = f ? 'pointer' : '';
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const { f, x, y } = hit(e);
    setHovered(f);
    handlers.onHover(f?.facet ?? null, x, y);
  };
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    setHovered(null);
    handlers.onHover(null, 0, 0);
  };
  let pointerType = 'mouse';
  const onDown = (e: PointerEvent) => {
    pointerType = e.pointerType;
  };
  const onClick = (e: MouseEvent) => {
    const { f, x, y } = hit(e);
    if (f?.facet) handlers.onPick(f.facet, x, y, pointerType);
    if (pointerType !== 'mouse') setHovered(f);
  };
  const el = renderer.domElement;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('click', onClick);

  let raf = 0;
  let last = performance.now();
  let speed = 0.22; // rad/s: about one turn in 30 s
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden) return;
    const t = now / 1000;
    // slow to a stop on a facet you're pointing at, so its card stays put
    speed += ((hovered ? 0 : 0.22) - speed) * Math.min(1, dt * 4);
    gem.rotation.y -= speed * dt;
    gem.position.y = Math.sin(t * 0.8) * 0.04;
    for (const c of crown) {
      if (c.facet) c.mat.emissiveIntensity = c === hovered ? 2.2 : 1;
      // glass: a soft band of light sweeping round
      else c.mat.emissive.set(GEM_GLASS).multiplyScalar(0.1 + 0.45 * Math.pow(Math.max(0, Math.sin(t * 0.9 + c.mid)), 8));
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    update(segs) {
      setHovered(null);
      build(segs);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick);
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        (m.material as { dispose?: () => void } | undefined)?.dispose?.();
      });
      renderer.dispose();
      el.remove();
    },
  };
}
