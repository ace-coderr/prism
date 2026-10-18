/**
 * One expensive read (the chain) shared by everyone, with "fresh" requests that can't be abused:
 *
 * - a state younger than `freshMs` is served as is;
 * - a caller can ask for a state that includes `minBlock` (right after posting): one already that new
 *   is served as is; otherwise one read is made, shared by everyone asking at the time;
 * - whoever asks, reads start at most once every `minGapMs` per instance (a caller who needs a newer
 *   block waits for the gap, then gets the next read).
 */
export interface Gated {
  /** the block the state was read at */
  block: bigint;
}

export function freshGate<S extends Gated>(read: () => Promise<S>, opts: { freshMs: number; minGapMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let state: { at: number; s: S } | null = null;
  let loading: Promise<S> | null = null;
  let lastRead = -Infinity;

  const load = () =>
    (loading ??= (() => {
      lastRead = now();
      return read()
        .then((s) => {
          state = { at: now(), s };
          return s;
        })
        .finally(() => {
          loading = null;
        });
    })());

  return async function get(minBlock = 0n): Promise<S> {
    if (state && now() - state.at < opts.freshMs && state.s.block >= minBlock) return state.s;
    if (loading) {
      const s = await loading;
      if (s.block >= minBlock) return s;
    }
    const wait = lastRead + opts.minGapMs - now();
    if (state && wait > 0) {
      if (minBlock <= state.s.block) return state.s;
      await new Promise((r) => setTimeout(r, wait));
      if (state.s.block >= minBlock) return state.s;
      if (loading) return loading;
    }
    return load();
  };
}
