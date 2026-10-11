/**
 * The hero's 3D prism (plain three.js, loaded on demand): a white beam goes in, the spectrum comes
 * out. `light` (0..1, live sentiment) sets how vivid the colors are; `cloud` (0..1, share of
 * reviewers who sold) fogs the glass and dims the rays. Pauses when off screen or hidden.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  AmbientLight,
  WebGLRenderer,
} from 'three';
import { PALETTE, SPECTRUM, mix } from '@prism/core';

export interface PrismScene {
  update(light: number, cloud: number): void;
  dispose(): void;
}

export function mountPrism(host: HTMLElement, light: number, cloud: number): PrismScene {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.2, 9);
  scene.add(new AmbientLight(0xffffff, 0.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 4, 6);
  scene.add(sun);

  // the prism: a triangular cylinder seen end-on, glassy, with lime edges
  const prism = new Group();
  const body = new CylinderGeometry(1.25, 1.25, 1.6, 3, 1);
  body.rotateX(Math.PI / 2);
  const glass = new MeshStandardMaterial({ color: PALETTE.lime, transparent: true, opacity: 0.16, roughness: 0.15, metalness: 0.1 });
  prism.add(new Mesh(body, glass));
  const edgeMat = new LineBasicMaterial({ color: PALETTE.lime });
  prism.add(new LineSegments(new EdgesGeometry(body), edgeMat));
  prism.rotation.z = Math.PI / 2; // point up
  scene.add(prism);

  // fog inside the glass, for sellers
  const fogMat = new MeshBasicMaterial({ color: PALETTE.mist, transparent: true, opacity: 0, depthWrite: false });
  const fog = new Mesh(new SphereGeometry(0.75, 24, 16), fogMat);
  fog.scale.set(1, 1, 0.6);
  scene.add(fog);

  // the beam in
  const beam = new Mesh(new BoxGeometry(3.4, 0.08, 0.08), new MeshBasicMaterial({ color: PALETTE.white }));
  beam.position.set(-2.55, -0.12, 0);
  beam.rotation.z = 0.05;
  scene.add(beam);

  // the rays out, fanning from the right face
  const rays = SPECTRUM.map((c, i) => {
    const mat = new MeshBasicMaterial({ color: new Color(c), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
    const ray = new Mesh(new BoxGeometry(3.6, 0.09, 0.02), mat);
    const angle = 0.32 - i * 0.1;
    ray.rotation.z = angle;
    ray.position.set(0.55 + Math.cos(angle) * 1.8, -0.05 + Math.sin(angle) * 1.8, 0);
    scene.add(ray);
    return { ray, mat, base: c };
  });

  let L = light;
  let C = cloud;
  const apply = () => {
    for (const r of rays) {
      r.mat.color.set(mix(PALETTE.mist, r.base, L * (1 - C * 0.75)));
      r.mat.opacity = (0.35 + 0.65 * L) * (1 - C * 0.55);
    }
    glass.color.set(mix(PALETTE.lime, PALETTE.mist, C * 0.8));
    edgeMat.color.set(mix(PALETTE.lime, PALETTE.mist, C * 0.8));
    fogMat.opacity = C * 0.55;
  };
  apply();

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

  let raf = 0;
  const start = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const t = (now - start) / 1000;
    prism.rotation.x = Math.sin(t * 0.5) * 0.35;
    prism.rotation.y = Math.sin(t * 0.35) * 0.25;
    rays.forEach((r, i) => {
      r.ray.scale.x = 1 + Math.sin(t * 1.6 + i) * 0.04;
    });
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    update(light2, cloud2) {
      L = light2;
      C = cloud2;
      apply();
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as { dispose?: () => void } | undefined;
        mat?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
