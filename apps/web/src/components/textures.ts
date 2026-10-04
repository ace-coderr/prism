import * as THREE from 'three';

// Small procedural textures, generated once on the client. No image assets.

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/** White cube face with a thick black frame — gives every voxel its own outline. */
export function outlinedFaceTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  g.fillRect(6, 6, 52, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 3-step ramp for flat toon shading. */
export function toonRamp() {
  const data = new Uint8Array([110, 190, 255]);
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Soft radial falloff used for the lime glow under each crystal. */
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A dark market-screen panel with faint green/red candlesticks, seeded for variety. */
export function candlePanelTexture(seed: number) {
  const W = 512;
  const H = 288;
  const [c, g] = canvas(W, H);
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);

  g.fillStyle = '#16191c';
  g.fillRect(0, 0, W, H);
  // grid
  g.strokeStyle = 'rgba(212,240,0,0.05)';
  g.lineWidth = 1;
  for (let y = 24; y < H; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  // candles following a random walk
  let price = H * (0.35 + rand() * 0.3);
  const n = 34;
  const step = W / n;
  for (let i = 0; i < n; i++) {
    const open = price;
    price = Math.min(H - 30, Math.max(30, price + (rand() - 0.5) * 34));
    const close = price;
    const hi = Math.min(open, close) - rand() * 14;
    const lo = Math.max(open, close) + rand() * 14;
    const up = close < open; // canvas y is inverted
    g.strokeStyle = g.fillStyle = up ? 'rgba(80,220,120,0.55)' : 'rgba(240,80,80,0.4)';
    const x = i * step + step / 2;
    g.beginPath();
    g.moveTo(x, hi);
    g.lineTo(x, lo);
    g.stroke();
    g.fillRect(x - step * 0.3, Math.min(open, close), step * 0.6, Math.max(2, Math.abs(close - open)));
  }
  // frame
  g.strokeStyle = 'rgba(212,240,0,0.18)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, H - 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
