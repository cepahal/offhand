/**
 * Nearest-centroid classifier over recorded gesture samples.
 * A score under CONFIDENCE_MIN is not a gesture.
 *
 * TODO(verify): samples are the recorder's labelled events. The nine firmware names are
 * up, down, left, right, forward, backward, cw, ccw, wave. "hold" is a recorded label
 * inferred from a still hover, not a firmware gesture name.
 */
import type { GestureEvent } from '@hoverscan/contracts';

export const CONFIDENCE_MIN = 0.72;

export const CLASS_NAMES = ['up', 'down', 'left', 'right', 'forward', 'backward', 'cw', 'ccw', 'wave', 'hold'] as const;
export type ClassName = (typeof CLASS_NAMES)[number];

export interface LabelledExample {
  label: string;
  event: GestureEvent;
}

export interface GestureScore {
  label: ClassName;
  confidence: number;
  accepted: boolean;
}

export function featureOf(example: LabelledExample): number[] | null {
  const v = CLASS_NAMES.map(() => 0);
  if (example.event.t === 'g') {
    const i = CLASS_NAMES.indexOf(example.event.g);
    if (i < 0) return null;
    v[i] = 1;
    return v;
  }
  if (example.event.t === 'h' && example.label === 'hold') {
    v[CLASS_NAMES.indexOf('hold')] = 1;
    return v;
  }
  return null;
}

function dist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

export class GestureClassifier {
  private readonly centroids = new Map<ClassName, number[]>();

  train(examples: readonly LabelledExample[]): void {
    const buckets = new Map<ClassName, number[][]>();
    for (const example of examples) {
      if (!CLASS_NAMES.includes(example.label as ClassName)) continue;
      const feature = featureOf(example);
      if (!feature) continue;
      const label = example.label as ClassName;
      const list = buckets.get(label) ?? [];
      list.push(feature);
      buckets.set(label, list);
    }
    this.centroids.clear();
    for (const [label, rows] of buckets) {
      const mean = CLASS_NAMES.map((_, i) => rows.reduce((sum, row) => sum + row[i]!, 0) / rows.length);
      this.centroids.set(label, mean);
    }
  }

  get trained(): boolean {
    return this.centroids.size > 0;
  }

  score(example: LabelledExample): GestureScore | null {
    const feature = featureOf({ label: example.label, event: example.event });
    if (!feature || this.centroids.size === 0) return null;
    const ranked = [...this.centroids.entries()]
      .map(([label, centroid]) => ({ label, d: dist(feature, centroid) }))
      .sort((a, b) => a.d - b.d);
    const best = ranked[0]!;
    const second = ranked[1]?.d ?? best.d + 1;
    const confidence = second / (best.d + second);
    return { label: best.label, confidence, accepted: confidence >= CONFIDENCE_MIN };
  }

  /** Score a live board gesture. Hover is not a discrete class. */
  scoreEvent(ev: GestureEvent): GestureScore | null {
    if (ev.t !== 'g') return null;
    return this.score({ label: ev.g, event: ev });
  }

  scoreFeature(vector: readonly number[]): GestureScore | null {
    const ranked = [...this.centroids.entries()]
      .map(([label, centroid]) => ({ label, d: dist(vector, centroid) }))
      .sort((a, b) => a.d - b.d);
    if (!ranked.length) return null;
    const best = ranked[0]!;
    const second = ranked[1]?.d ?? best.d + 1;
    const confidence = second / (best.d + second);
    return { label: best.label, confidence, accepted: confidence >= CONFIDENCE_MIN };
  }
}

export interface HeldOutReport {
  accuracy: number;
  heldOut: number;
  correct: number;
  randomSeen: number;
  randomIgnored: number;
}

/** Train on the first part of each class and score the rest. Random vectors must fall under the threshold. */
export function heldOutReport(examples: readonly LabelledExample[], random: readonly number[][], hold: number): HeldOutReport {
  const byLabel = new Map<string, LabelledExample[]>();
  for (const example of examples) {
    const list = byLabel.get(example.label) ?? [];
    list.push(example);
    byLabel.set(example.label, list);
  }
  const train: LabelledExample[] = [];
  const test: LabelledExample[] = [];
  for (const list of byLabel.values()) {
    train.push(...list.slice(0, Math.max(1, list.length - hold)));
    test.push(...list.slice(Math.max(1, list.length - hold)));
  }
  const clf = new GestureClassifier();
  clf.train(train);
  let correct = 0;
  for (const example of test) {
    const scored = clf.score(example);
    if (scored && scored.accepted && scored.label === example.label) correct += 1;
  }
  let randomIgnored = 0;
  for (const vector of random) {
    const featureScore = clf.scoreFeature(vector);
    if (!featureScore || !featureScore.accepted) randomIgnored += 1;
  }
  return {
    accuracy: test.length === 0 ? 0 : correct / test.length,
    heldOut: test.length,
    correct,
    randomSeen: random.length,
    randomIgnored,
  };
}
