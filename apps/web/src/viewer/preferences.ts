/**
 * Per-surgeon view memory. A suggestion is only a proposal; the caller shows it before applying.
 */
export type PrefMode = 'orbit' | 'scrub';
export type PrefPlane = 'axial' | 'coronal' | 'sagittal';

export interface PrefUse {
  surgeonId: string;
  mode: PrefMode;
  plane: PrefPlane;
}

export interface ViewSuggestion {
  surgeonId: string;
  mode: PrefMode;
  plane: PrefPlane;
  uses: number;
  text: string;
}

const MIN_USES = 3;

export function observe(history: readonly PrefUse[], use: PrefUse): PrefUse[] {
  return [...history, use];
}

export function suggestFor(history: readonly PrefUse[], surgeonId: string): ViewSuggestion | null {
  const counts = new Map<string, { mode: PrefMode; plane: PrefPlane; n: number }>();
  for (const row of history) {
    if (row.surgeonId !== surgeonId) continue;
    const key = `${row.mode}|${row.plane}`;
    const prev = counts.get(key);
    counts.set(key, { mode: row.mode, plane: row.plane, n: (prev?.n ?? 0) + 1 });
  }
  let best: { mode: PrefMode; plane: PrefPlane; n: number } | null = null;
  for (const row of counts.values()) {
    if (!best || row.n > best.n) best = row;
  }
  if (!best || best.n < MIN_USES) return null;
  return {
    surgeonId,
    mode: best.mode,
    plane: best.plane,
    uses: best.n,
    text: `Suggested view: ${best.mode}, ${best.plane} slices (${best.n} recent uses). Apply this view?`,
  };
}
