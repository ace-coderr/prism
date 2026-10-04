import { Suspense, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Billboard, useTexture } from '@react-three/drei';
import { useQueries, useQuery } from '@tanstack/react-query';
import * as THREE from 'three';
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import {
  VIBERS_NFT,
  readOwnedViber,
  robinhoodChainMainnet,
  viberAt,
  viberImageUrl,
  type OfficialViber,
  type OwnedViber,
} from '@prism/core';
import { testnetClient } from '../data/chain';
import { SceneLabel } from './Stage';
import { glowTexture } from './textures';

/*
 * vibe vibers are featured with vibe/vibe's permission (credit in README.md): official
 * images only, shown as-is. Their server sends CORP same-origin, so every image is
 * requested in CORS mode (crossOrigin="anonymous"), which it allows.
 */

/** An official viber image, displayed as-is. */
export function ViberImage({
  viber,
  size = 96,
  phoneSize,
  className = '',
}: {
  viber: OfficialViber;
  size?: number;
  /** a smaller size below the `sm` breakpoint */
  phoneSize?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dims = phoneSize
    ? ({ '--viber': `${size}px`, '--viber-phone': `${phoneSize}px` } as CSSProperties)
    : { width: size, height: size };
  const sized = phoneSize ? 'h-[var(--viber-phone)] w-[var(--viber-phone)] sm:h-[var(--viber)] sm:w-[var(--viber)]' : '';
  if (failed) return <span className={`inline-block rounded-2xl bg-white/5 ${sized} ${className}`} style={dims} aria-hidden />;
  return (
    <img
      src={viberImageUrl(viber.file)}
      crossOrigin="anonymous"
      alt={viber.description}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`shrink-0 select-none ${sized} ${className}`}
      style={dims}
      draggable={false}
    />
  );
}

/** A viber guide: the official image beside a short speech bubble. */
export function ViberGuide({
  index,
  children,
  size = 72,
  className = '',
}: {
  /** which official viber (rotates through the collection) */
  index: number;
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  const viber = viberAt(index);
  return (
    // phones: the viber sits above its speech bubble so the text gets the full width
    <div className={`flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-end ${className}`}>
      <ViberImage viber={viber} size={size} phoneSize={Math.min(size, 64)} />
      <div className="relative min-w-0 rounded-2xl rounded-tl-sm border border-white/10 bg-panel px-4 py-3 text-sm leading-relaxed text-white/90 sm:mb-3 sm:rounded-tl-2xl sm:rounded-bl-sm">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holder's own viber
// ---------------------------------------------------------------------------

const mainnetClient = createPublicClient({ chain: robinhoodChainMainnet, transport: http() }) as PublicClient;

/** The connected wallet's own viber (read-only, from the official NFT), or null. */
export function useOwnedViber(owner: Address | undefined) {
  return useQuery({
    queryKey: ['owned-viber', VIBERS_NFT?.chainId, VIBERS_NFT?.address, owner],
    enabled: !!owner && !!VIBERS_NFT,
    staleTime: 5 * 60_000,
    queryFn: () =>
      readOwnedViber(VIBERS_NFT?.chainId === robinhoodChainMainnet.id ? mainnetClient : testnetClient, owner!, fetch).catch(
        () => null,
      ),
  });
}

/** Vibers for many owners at once (Gallery), keyed by lower-cased owner address. */
export function useOwnersVibers(owners: Address[]): Map<string, OwnedViber> {
  const unique = [...new Set(owners.map((o) => o.toLowerCase()))] as Address[];
  const results = useQueries({
    queries: unique.map((owner) => ({
      queryKey: ['owned-viber', VIBERS_NFT?.chainId, VIBERS_NFT?.address, owner],
      enabled: !!VIBERS_NFT,
      staleTime: 5 * 60_000,
      queryFn: () =>
        readOwnedViber(VIBERS_NFT?.chainId === robinhoodChainMainnet.id ? mainnetClient : testnetClient, owner, fetch).catch(
          () => null,
        ),
    })),
  });
  const map = new Map<string, OwnedViber>();
  unique.forEach((o, i) => {
    const v = results[i]?.data;
    if (v) map.set(o, v);
  });
  return map;
}

const shadowMaterial = new THREE.MeshBasicMaterial({
  map: glowTexture(),
  color: '#000000',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

function BillboardImage({ url, height }: { url: string; height: number }) {
  const texture = useTexture(url); // three's loaders request in CORS mode ('anonymous')
  texture.colorSpace = THREE.SRGBColorSpace;
  const aspect = texture.image ? texture.image.width / texture.image.height : 1;
  const material = useMemo(
    // stays just under the bloom threshold so the art is shown as-is, not glowing
    () => new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.02, toneMapped: false, color: new THREE.Color(0.93, 0.93, 0.93) }),
    [texture],
  );
  return (
    <mesh material={material} position-y={height / 2} raycast={() => null}>
      <planeGeometry args={[height * aspect, height]} />
    </mesh>
  );
}

/**
 * A viber standing in the 3D scene: its official 2D image on a flat billboard that
 * always faces the camera, with a soft shadow at its feet and a small label.
 */
export function ViberBillboard({
  viber,
  position,
  height = 1.6,
}: {
  viber: OwnedViber;
  position: [number, number, number];
  height?: number;
}) {
  return (
    <group position={position}>
      <mesh material={shadowMaterial} rotation-x={-Math.PI / 2} position-y={0.01} raycast={() => null}>
        <planeGeometry args={[height * 0.9, height * 0.35]} />
      </mesh>
      <Suspense fallback={null}>
        <Billboard lockX lockZ>
          <BillboardImage url={viber.image} height={height} />
        </Billboard>
      </Suspense>
      <SceneLabel position={[0, -0.18, 0]} center>
        <span className="pointer-events-none whitespace-nowrap rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[10px] text-lime">
          Your viber{viber.label ? ` (${viber.label})` : ''}
        </span>
      </SceneLabel>
    </group>
  );
}
