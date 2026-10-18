import { describe, expect, it } from 'vitest';
import { freshGate } from '../server/freshGate';

/** A fake chain: each read returns the current head; the clock is ours. */
function setup() {
  let t = 0;
  let head = 100n;
  let reads = 0;
  const get = freshGate(
    async () => {
      reads++;
      return { block: head };
    },
    { freshMs: 20_000, minGapMs: 3_000, now: () => t },
  );
  return {
    get,
    reads: () => reads,
    advance: (ms: number) => (t += ms),
    mine: (n = 1n) => (head += n),
  };
}

describe('fresh reads can’t be abused', () => {
  it('serves a young state to everyone; many fresh requests at once share one read', async () => {
    const g = setup();
    await g.get();
    expect(g.reads()).toBe(1);
    g.mine();
    const all = await Promise.all(Array.from({ length: 50 }, () => g.get(101n)));
    expect(all.every((s) => s.block === 101n)).toBe(true);
    expect(g.reads()).toBe(2);
  });

  it('a request for a block the state already includes reads nothing', async () => {
    const g = setup();
    await g.get();
    for (let i = 0; i < 100; i++) await g.get(100n);
    expect(g.reads()).toBe(1);
  });

  it('“fresh” without a block (old pages) doesn’t force reads either', async () => {
    const g = setup();
    await g.get();
    g.advance(1_000);
    for (let i = 0; i < 20; i++) await g.get(0n);
    expect(g.reads()).toBe(1);
  });

  it('posting still shows up right away: a newer block gets the next read', async () => {
    const g = setup();
    await g.get();
    g.advance(5_000);
    g.mine(3n);
    expect((await g.get(103n)).block).toBe(103n);
    expect(g.reads()).toBe(2);
  });

  it('refreshes once the state is older than 20 s', async () => {
    const g = setup();
    await g.get();
    g.advance(21_000);
    g.mine();
    expect((await g.get()).block).toBe(101n);
    expect(g.reads()).toBe(2);
  });
});
