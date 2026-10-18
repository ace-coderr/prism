import { describe, expect, it } from 'vitest';
import { mergeMoves, replayRun, type BalanceMove, type ReplayReview } from '../src';

const review = (block: number, heldAtPost: bigint, baseline = heldAtPost, logIndex = 5): ReplayReview => ({ block, logIndex, heldAtPost, baseline });
const move = (block: number, delta: bigint, logIndex = 1): BalanceMove => ({ block, logIndex, delta });

describe('replaying a run: sold below half and bought back', () => {
  it('a dump below half and a buy-back before anyone marks it is a dip, at the dump', () => {
    const r = replayRun([review(100, 1000n)], [move(200, -600n), move(300, 700n)], 1100n);
    expect(r).toEqual({ kind: 'dipped', at: { block: 200, logIndex: 1 } });
  });

  it('exactly half is still holding; trades that stay above half are clean', () => {
    expect(replayRun([review(100, 1000n)], [move(200, -500n), move(300, 500n)], 1000n)).toEqual({ kind: 'clean' });
    expect(replayRun([review(100, 1000n)], [move(200, -501n), move(300, 501n)], 1000n).kind).toBe('dipped');
  });

  it('uses the baseline in force at each moment: an update that raised it raises the bar from then on', () => {
    // 1000, buy to 3000, update (baseline 3000), sell to 1400: below half of 3000
    const reviews = [review(100, 1000n), review(300, 3000n, 3000n)];
    expect(replayRun(reviews, [move(200, 2000n), move(400, -1600n), move(500, 1600n)], 3000n).kind).toBe('dipped');
    // the same sale before the update was measured against 1000: 1400 is fine then
    expect(replayRun([review(100, 1000n), review(500, 3000n, 3000n)], [move(200, 2000n), move(300, -1600n), move(400, 1600n)], 3000n)).toEqual({ kind: 'clean' });
  });

  it('ignores transfers before the first review (same block: by log index)', () => {
    const r = replayRun([review(100, 1000n, 1000n, 5)], [move(90, -5000n), move(100, -900n, 4), move(150, 0n)], 1000n);
    expect(r).toEqual({ kind: 'clean' });
  });

  it('a transfer to oneself is one step, not a dip and a refund', () => {
    expect(mergeMoves([move(200, -900n, 3), move(200, 900n, 3)])).toEqual([move(200, 0n, 3)]);
    expect(replayRun([review(100, 1000n)], [move(200, -900n, 3), move(200, 900n, 3)], 1000n)).toEqual({ kind: 'clean' });
  });

  it('doesn’t accuse when the transfers don’t add up (rebasing, reflections, fee quirks)', () => {
    // the live balance disagrees with the replay
    expect(replayRun([review(100, 1000n)], [move(200, -600n), move(300, 700n)], 1234n).kind).toBe('mismatch');
    // a later review recorded a balance the transfers can't explain
    expect(replayRun([review(100, 1000n), review(400, 990n)], [move(200, -600n), move(300, 600n)], 990n).kind).toBe('mismatch');
    // more out than in
    expect(replayRun([review(100, 10n)], [move(200, -20n)], 0n).kind).toBe('mismatch');
  });
});
