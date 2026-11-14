import { describe, expect, it } from 'vitest';
import type { GestureEvent, GestureName } from '@hoverscan/contracts';
import { CLASS_NAMES, CONFIDENCE_MIN, GestureClassifier, heldOutReport, type LabelledExample } from '../src/gesture/classifier.js';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function example(name: GestureName | 'hold', seq: number): LabelledExample {
  if (name === 'hold') {
    return { label: 'hold', event: { t: 'h', x: 0.5, y: 0.5, z: 0.4, seq, ms: seq } };
  }
  const ev: GestureEvent = { t: 'g', g: name, seq, ms: seq };
  return { label: name, event: ev };
}

describe('learned gesture classifier', () => {
  it('recognises held-out examples above the threshold and ignores random movement', () => {
    const rng = mulberry32(7);
    const examples: LabelledExample[] = [];
    let seq = 1;
    for (const name of CLASS_NAMES) {
      for (let n = 0; n < 6; n++) examples.push(example(name, seq++));
    }
    const random = Array.from({ length: 30 }, () => CLASS_NAMES.map(() => 0.25 + rng() * 0.5));
    const report = heldOutReport(examples, random, 2);
    expect(report.correct).toBe(report.heldOut);
    expect(report.accuracy).toBe(1);
    expect(report.randomIgnored).toBe(report.randomSeen);

    const clf = new GestureClassifier();
    clf.train(examples);
    for (const name of CLASS_NAMES) {
      const scored = clf.score(example(name, 99));
      expect(scored?.label).toBe(name);
      expect(scored?.confidence).toBeGreaterThanOrEqual(CONFIDENCE_MIN);
      expect(scored?.accepted).toBe(true);
    }
    const noise = clf.scoreFeature(CLASS_NAMES.map(() => 0.5));
    expect(noise?.accepted).toBe(false);
  });
});