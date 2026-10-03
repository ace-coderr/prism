// Minimal vector / quaternion / color helpers. Plain tuples so the output stays
// serializable and free of any three.js dependency.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l < 1e-9 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const distance = (a: Vec3, b: Vec3) => length([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);

/** Two unit vectors orthogonal to `n` (and each other). */
export function tangentBasis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = normalize(cross(helper, n));
  const b = cross(n, t);
  return [t, b];
}

/** Rotate unit vector `dir` away from itself by `angle` toward azimuth `phi` (around dir). */
export function tilt(dir: Vec3, angle: number, phi: number): Vec3 {
  const [t, b] = tangentBasis(dir);
  const s = Math.sin(angle);
  const off = add(scale(t, Math.cos(phi) * s), scale(b, Math.sin(phi) * s));
  return normalize(add(scale(dir, Math.cos(angle)), off));
}

/** Quaternion rotating +Y onto `dir`, then twisting by `twist` radians around `dir`. */
export function quatFromUp(dir: Vec3, twist = 0): Quat {
  const up: Vec3 = [0, 1, 0];
  const d = normalize(dir);
  const c = dot(up, d);
  let q: Quat;
  if (c < -0.999999) {
    q = [1, 0, 0, 0]; // 180° about X
  } else {
    const ax = cross(up, d);
    q = normalizeQuat([ax[0], ax[1], ax[2], 1 + c]);
  }
  // twist about the local Y axis: q * qTwist
  const h = twist / 2;
  const tq: Quat = [0, Math.sin(h), 0, Math.cos(h)];
  return mulQuat(q, tq);
}

function normalizeQuat(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function mulQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Evenly distributed directions on a unit sphere (Fibonacci lattice). */
export function fibonacciSphere(n: number): Vec3[] {
  if (n <= 0) return [];
  if (n === 1) return [[0, 1, 0]];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    out.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return out;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hslToHex(h: number, s: number, l: number): string {
  // h in degrees, s/l in [0,1]
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(clamp(x, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export function hexToRgb(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a: string, b: string, t = 0.5): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const h = (x: number) => Math.round(x).toString(16).padStart(2, '0');
  return `#${h(lerp(ca[0], cb[0], t))}${h(lerp(ca[1], cb[1], t))}${h(lerp(ca[2], cb[2], t))}`;
}
