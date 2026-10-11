/**
 * The avatar everyone gets: a 5×5 mirrored pixel pattern generated from the address. Same
 * address → same picture, everywhere. The pattern and both colours come from the address's
 * keccak hash, so nobody picks or uploads anything.
 */
import { hexToBytes, keccak256, type Address } from 'viem';

export const IDENTICON_SIZE = 5;

export interface Identicon {
  /** 25 cells, row by row; true = filled. Columns 3–4 mirror columns 1–0. */
  cells: boolean[];
  /** Fill colour hue, 0–359. */
  hue: number;
  /** Background hue, opposite-ish to the fill so the pattern always reads. */
  bgHue: number;
}

export function identicon(address: Address): Identicon {
  const b = hexToBytes(keccak256(address.toLowerCase() as Address));
  const cells: boolean[] = [];
  for (let y = 0; y < IDENTICON_SIZE; y++) {
    const half = [0, 1, 2].map((x) => b[y * 3 + x]! % 2 === 0);
    cells.push(half[0]!, half[1]!, half[2]!, half[1]!, half[0]!);
  }
  // never blank, never a solid block: flip the centre if the pattern is either
  const filled = cells.filter(Boolean).length;
  if (filled === 0 || filled === cells.length) cells[12] = !cells[12];
  const hue = ((b[20]! << 8) | b[21]!) % 360;
  return { cells, hue, bgHue: (hue + 150 + (b[22]! % 60)) % 360 };
}
