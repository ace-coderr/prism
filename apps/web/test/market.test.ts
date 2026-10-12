import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { formatChange, formatEth, formatUsd, noScoreText } from '../src/data/format';
import { coverSquare, encodePng } from '../server/png';

describe('the no-score line', () => {
  it('uses the real holder count, and says how many reviewed when 1–2 have', () => {
    expect(noScoreText(0, 'FUN', 73)).toBe('No reviews yet from its 73 holders. The score appears once 3 current holders review.');
    expect(noScoreText(1, 'FUN', 73)).toBe('1 of its 73 holders has reviewed $FUN. The score appears once 3 current holders review.');
    expect(noScoreText(2, 'FUN', 73)).toBe('2 of its 73 holders have reviewed $FUN. The score appears once 3 current holders review.');
    expect(noScoreText(0, 'FUN', 1)).toBe('No reviews yet from its 1 holder. The score appears once 3 current holders review.');
    expect(noScoreText(0, 'FUN', null)).toBe('No reviews yet. The score appears once 3 current holders review.');
  });
});

describe('market numbers', () => {
  it('formats ETH, testnet USD and changes', () => {
    expect(formatEth(8.4123)).toBe('8.41 ETH');
    expect(formatEth(5600)).toBe('5.6K ETH');
    expect(formatEth(0.00001)).toBe('<0.0001 ETH');
    expect(formatEth(null)).toBe('–');
    expect(formatUsd(8.4, 743)).toBe('$6.2K');
    expect(formatUsd(1, null)).toBeNull();
    expect(formatChange(1.32)).toBe('+132%');
    expect(formatChange(-0.031)).toBe('−3.1%');
    expect(formatChange(0)).toBe('0%');
    expect(formatChange(null)).toBe('–');
  });
});

describe('token pictures', () => {
  it('crops the centre square, resizes and encodes a valid PNG', () => {
    // 4×2: left half red, right half blue; the centre square is the middle two columns
    const data = new Uint8Array(4 * 2 * 4);
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 4; x++) data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4);
    const sq = coverSquare({ data, width: 4, height: 2 }, 2);
    expect([...sq.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...sq.data.slice(4, 8)]).toEqual([0, 0, 255, 255]);
    const png = encodePng(sq);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idat = png.indexOf(0x49, 33); // 'I' of IDAT
    const len = new DataView(png.buffer).getUint32(idat - 4);
    const raw = inflateSync(png.slice(idat + 4, idat + 4 + len));
    expect(raw.length).toBe(2 * (2 * 4 + 1));
  });
});
