/**
 * Pure viewer helpers (no three.js, no DOM) so they can be unit-tested.
 *
 * Coordinates: case packs are RAS millimetres (+x = patient Right, +y = Anterior, +z = Superior).
 * three.js is Y-up, so the patient root gets one fixed transform:
 *     three.x = -R    three.y = S    three.z = A        (rotation, det = +1)
 * With the default camera on +z (in front of the patient) the patient faces the viewer and the
 * patient's right appears on the viewer's left, like standing in front of a person.
 */
import type { CaseFinding, CaseLayer } from '@offhand/contracts';

export type Vec3 = [number, number, number];

export function rasToThree([r, a, s]: Vec3): Vec3 {
  return [0 - r, s, a]; // 0 - r, not -r: avoids -0
}

export function threeToRas([x, y, z]: Vec3): Vec3 {
  return [0 - x, z, y];
}

/** Row-major 4x4 for THREE.Matrix4.set(...). */
export const RAS_TO_THREE: readonly number[] = [-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

export type RasAxis = 'R' | 'A' | 'S';

/** Unit vector of a RAS axis in three.js world coordinates. */
export function rasAxisToThree(axis: RasAxis): Vec3 {
  const v: Vec3 = axis === 'R' ? [1, 0, 0] : axis === 'A' ? [0, 1, 0] : [0, 0, 1];
  return rasToThree(v).map((n) => (n === 0 ? 0 : n)) as Vec3; // no -0
}

/** Distinct peel orders, outermost (0) first. */
export function peelGroups(layers: Pick<CaseLayer, 'peelOrder'>[]): number[] {
  return [...new Set(layers.map((l) => l.peelOrder))].sort((a, b) => a - b);
}

/** Next group to peel away, or null when only the innermost group is left. */
export function nextPeel(groups: number[], peeled: number[]): number | null {
  const remaining = groups.filter((g) => !peeled.includes(g));
  return remaining.length > 1 ? remaining[0]! : null;
}

/** Cycle through findings (optionally only those of one timepoint). */
export function cycleFinding(
  findings: Pick<CaseFinding, 'id' | 'timepointId'>[],
  current: string | null,
  dir: 'next' | 'prev',
  timepointId?: string,
): string | null {
  const list = findings.filter((f) => !timepointId || !f.timepointId || f.timepointId === timepointId);
  if (!list.length) return null;
  const i = list.findIndex((f) => f.id === current);
  if (i < 0) return dir === 'next' ? list[0]!.id : list[list.length - 1]!.id;
  const n = list.length;
  return list[(i + (dir === 'next' ? 1 : -1) + n) % n]!.id;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Map a 0..1 scrub value onto an index 0..count-1. */
export function scrubToIndex(value: number, count: number): number {
  return count <= 1 ? 0 : Math.round(clamp(value, 0, 1) * (count - 1));
}

/** Clip height along an axis: scrub 1 shows everything, scrub 0 hides everything. */
export function clipHeight(value: number, lo: number, hi: number, margin = 1): number {
  return lo - margin + (hi - lo + 2 * margin) * clamp(value, 0, 1);
}

export const PROVENANCE_TEXT: Record<CaseFinding['provenance'], string> = {
  dataset_label: "from the dataset's labels",
  dataset_report: "from the dataset's report",
  measured: 'measured from the dataset by the offhand pipeline',
};

export const GESTURE_TEXT: Record<string, string> = {
  up: 'SWIPE UP',
  down: 'SWIPE DOWN',
  left: 'SWIPE LEFT',
  right: 'SWIPE RIGHT',
  forward: 'PUSH',
  backward: 'PULL',
  cw: 'SPIN CW',
  ccw: 'SPIN CCW',
  wave: 'WAVE',
};
