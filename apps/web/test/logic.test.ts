import { describe, expect, it } from 'vitest';
import type { CaseFinding, CaseLayer } from '@offhand/contracts';
import {
  RAS_TO_THREE,
  clipHeight,
  cycleFinding,
  nextPeel,
  peelGroups,
  rasAxisToThree,
  rasToThree,
  scrubToIndex,
  threeToRas,
} from '../src/viewer/logic.js';
import { parseAppConfig } from '../src/viewer/appConfig.js';

const layer = (id: string, peelOrder: number): CaseLayer => ({
  id,
  label: id,
  file: `${id}.glb`,
  color: '#ffffff',
  defaultOpacity: 1,
  peelOrder,
  kind: 'surface',
});

const finding = (id: string, timepointId?: string): CaseFinding => ({
  id,
  label: id,
  center: [0, 0, 0],
  radiusMm: 5,
  provenance: 'dataset_label',
  ...(timepointId ? { timepointId } : {}),
});

describe('RAS -> three.js', () => {
  it('maps right to -x, anterior to +z, superior to +y', () => {
    expect(rasToThree([1, 0, 0])).toEqual([-1, 0, 0]);
    expect(rasToThree([0, 1, 0])).toEqual([0, 0, 1]);
    expect(rasToThree([0, 0, 1])).toEqual([0, 1, 0]);
  });
  it('round-trips', () => {
    expect(threeToRas(rasToThree([12, -3, 40]))).toEqual([12, -3, 40]);
  });
  it('is a proper rotation (det +1), so meshes do not turn inside out', () => {
    const m = RAS_TO_THREE;
    const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]] as number[];
    const det = a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
    expect(det).toBe(1);
  });
  it('maps RAS axes for the clip plane', () => {
    expect(rasAxisToThree('S')).toEqual([0, 1, 0]);
    expect(rasAxisToThree('A')).toEqual([0, 0, 1]);
    expect(rasAxisToThree('R')).toEqual([-1, 0, 0]);
  });
});

describe('peel', () => {
  const groups = peelGroups([layer('skin', 0), layer('muscle', 1), layer('bone', 2), layer('bone2', 2)]);
  it('groups by peelOrder, outermost first', () => {
    expect(groups).toEqual([0, 1, 2]);
  });
  it('peels outermost first and never the last group', () => {
    expect(nextPeel(groups, [])).toBe(0);
    expect(nextPeel(groups, [0])).toBe(1);
    expect(nextPeel(groups, [0, 1])).toBeNull();
  });
});

describe('findings', () => {
  const fs = [finding('a'), finding('b', 't2'), finding('c')];
  it('cycles next/prev with wrap', () => {
    expect(cycleFinding(fs, null, 'next')).toBe('a');
    expect(cycleFinding(fs, 'c', 'next')).toBe('a');
    expect(cycleFinding(fs, 'a', 'prev')).toBe('c');
  });
  it('skips findings from other timepoints', () => {
    expect(cycleFinding(fs, 'a', 'next', 't1')).toBe('c');
    expect(cycleFinding(fs, 'a', 'next', 't2')).toBe('b');
  });
  it('returns null when there are none', () => {
    expect(cycleFinding([], null, 'next')).toBeNull();
  });
});

describe('scrub', () => {
  it('maps 0..1 to indices', () => {
    expect(scrubToIndex(0, 5)).toBe(0);
    expect(scrubToIndex(1, 5)).toBe(4);
    expect(scrubToIndex(0.5, 5)).toBe(2);
    expect(scrubToIndex(0.7, 1)).toBe(0);
  });
  it('sweeps the clip plane past both ends', () => {
    expect(clipHeight(0, -50, 50)).toBeLessThan(-50);
    expect(clipHeight(1, -50, 50)).toBeGreaterThan(50);
  });
});

describe('app config', () => {
  it('defaults to an axial clip sweep', () => {
    expect(parseAppConfig(undefined).scrub).toEqual({ target: 'clip', axis: 'S', label: 'Clip' });
  });
  it('reads a valid config and ignores bad fields', () => {
    const c = parseAppConfig({ title: 'X', scrub: { target: 'timepoint', axis: 'nope', label: 'Visit' } });
    expect(c.title).toBe('X');
    expect(c.scrub.target).toBe('timepoint');
    expect(c.scrub.axis).toBe('S');
    expect(c.scrub.label).toBe('Visit');
  });
});
