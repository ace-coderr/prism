/**
 * The default avatar: a voxel gem generated from an address. Same address → same gem.
 * Shape (how many facets, their sizes, how spiky) and colour (one hue per address) come
 * from the address's keccak hash. It uses the crystal builder, but it is not a crystal:
 * no prices, no seams.
 */
import { hexToBytes, keccak256, type Address } from 'viem';
import type { Holding } from './crystal';

export interface Identicon {
  holdings: Holding[];
  /** 0..1 hue the gem is tinted with */
  hue: number;
}

export function identicon(address: Address): Identicon {
  const b = hexToBytes(keccak256(address.toLowerCase() as Address));
  const n = 3 + (b[0]! % 3); // 3–5 facets
  const raw = Array.from({ length: n }, (_, i) => 1 + b[1 + i]! / 64);
  const total = raw.reduce((s, x) => s + x, 0);
  const holdings = raw.map((w, i) => ({
    symbol: `id${i}`,
    weight: w / total,
    // ±1–6 "moves" only vary the lightness of each facet once tinted
    change24h: (b[8 + i]! % 2 ? 1 : -1) * (1 + (b[12 + i]! % 6)),
    volatility: 0.1 + (b[16 + i]! / 255) * 0.5,
  }));
  return { holdings, hue: b[24]! / 255 };
}
