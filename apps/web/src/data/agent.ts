/**
 * The agent's read-only look at a real crystal: how its weights moved since it was
 * forged (live prices now vs. prices at the forge block) and one plain suggestion.
 * Nothing here sends a transaction.
 */

/** A holding has drifted when its share moved at least this many percentage points. */
export const DRIFT_POINTS = 5;
/** Above this share, one holding carries most of the crystal's risk. */
export const HEAVY_SHARE = 0.5;

export interface Analysis {
  /** Share of each holding now, at live prices (0..1). */
  now: Map<string, number>;
  /** Share of each holding at forge time (0..1), or null when not known. */
  forged: Map<string, number> | null;
  /** The weights the suggestion moves back to (equals `now` when nothing to change). */
  target: Map<string, number>;
  /** The holding that grew the most (percentage points), if any grew. */
  grew: { symbol: string; from: number; to: number } | null;
  suggestion: string;
  /** True when trimming back would change something. */
  actionable: boolean;
}

const pct = (w: number) => `${Math.round(w * 100)}%`;

export function analyzeCrystal(id: bigint, now: Map<string, number>, forged: Map<string, number> | null): Analysis {
  const name = `crystal #${id.toString()}`;
  const symbols = [...now.keys()];
  if (symbols.length === 1) {
    return {
      now,
      forged,
      target: now,
      grew: null,
      actionable: false,
      suggestion: `${capital(name)} holds only ${symbols[0]}, so there is nothing to rebalance. Adding a second asset would spread the risk.`,
    };
  }
  if (!forged) {
    const [top, w] = [...now.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return {
      now,
      forged,
      target: now,
      grew: null,
      actionable: false,
      suggestion:
        w > HEAVY_SHARE
          ? `${top} is ${pct(w)} of ${name}. Prices from its forge day aren’t loaded, so there’s no before-and-after yet.`
          : `Prices from the day ${name} was forged aren’t loaded yet, so there’s no before-and-after.`,
    };
  }
  let grew: Analysis['grew'] = null;
  for (const [symbol, to] of now) {
    const from = forged.get(symbol) ?? 0;
    if (to - from > 0 && (!grew || to - from > grew.to - grew.from)) grew = { symbol, from, to };
  }
  if (grew && (grew.to - grew.from) * 100 >= DRIFT_POINTS) {
    return {
      now,
      forged,
      target: forged,
      grew,
      actionable: true,
      suggestion: `${grew.symbol} grew to ${pct(grew.to)} of ${name}. Trimming back to ${pct(grew.from)} would lower your risk.`,
    };
  }
  return {
    now,
    forged,
    target: now,
    grew,
    actionable: false,
    suggestion: `${capital(name)} is close to how you forged it: no holding moved more than ${DRIFT_POINTS} points. Nothing to change right now.`,
  };
}

const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);
