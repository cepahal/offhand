import { describe, expect, it } from 'vitest';
import { DENTAL_TRAININGS } from '../src/demo/dental-anatomy.js';
import { DENTAL_CANDIDATE_GROUPS } from '../src/demo/CBCTWorkspace.js';

describe('dental review focuses', () => {
  it('has five focuses, each with two ToothFairy2 candidates', () => {
    expect(DENTAL_TRAININGS.map((item) => item.n)).toEqual([1, 2, 3, 4, 5]);
    for (const item of DENTAL_TRAININGS) expect(DENTAL_CANDIDATE_GROUPS[item.n]).toHaveLength(2);
  });

  it('frames a tooth layer only for the single-tooth reviews', () => {
    const byN = Object.fromEntries(DENTAL_TRAININGS.map((item) => [item.n, item]));
    expect(byN[1]!.side).toBe('right');
    expect(byN[2]!.side).toBe('left');
    expect(byN[3]!.focusLayer).toBe('tooth-36');
    expect(byN[4]!.focusLayer).toBe('tooth-11');
    expect(byN[5]!.focusLayer).toBe('tooth-48');
    expect(byN[1]!.focusLayer).toBeNull();
  });

  it('never calls an unlabelled finding a diagnosis', () => {
    const text = DENTAL_TRAININGS.map((item) => item.context).join(' ').toLowerCase();
    expect(text).not.toMatch(/diagnos(is|ed)|lesion present|disc displaced/);
  });
});
