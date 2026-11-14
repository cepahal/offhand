import { describe, expect, it } from 'vitest';
import type { CaseFinding, CaseLayer } from '@hoverscan/contracts';
import { readFileSync } from 'node:fs';
import {
  PLANE_AXIS,
  RAS_TO_THREE,
  caseBanner,
  clipHeight,
  cycleFinding,
  indexToScrub,
  layerAtTimepoint,
  nextPeel,
  orderedTimepoints,
  volumeForTimepoint,
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

describe('timepoints (longitudinal cases)', () => {
  const tps = [
    { id: 'visit-02', label: 'Visit 2', order: 2 },
    { id: 'visit-01', label: 'Visit 1', order: 1 },
    { id: 'visit-03', label: 'Visit 3', order: 3 },
  ];
  const vol = (id: string, timepointId?: string) => ({
    id,
    file: `volumes/${id}.nii.gz`,
    modality: 'MR',
    sequence: 'FLAIR',
    ...(timepointId ? { timepointId } : {}),
  });

  it('orders timepoints by their order field', () => {
    expect(orderedTimepoints({ timepoints: tps }).map((t) => t.id)).toEqual(['visit-01', 'visit-02', 'visit-03']);
    expect(orderedTimepoints({})).toEqual([]);
  });

  it('shows a visit-tied layer only at its visit; untied layers always', () => {
    const lesion = { ...layer('lesions-r1-visit-02', 1), timepointId: 'visit-02' };
    expect(layerAtTimepoint(lesion, 'visit-02')).toBe(true);
    expect(layerAtTimepoint(lesion, 'visit-01')).toBe(false);
    expect(layerAtTimepoint(layer('brain', 0), 'visit-01')).toBe(true);
    expect(layerAtTimepoint(lesion, undefined)).toBe(true);
  });

  it('picks the slice volume of the selected visit', () => {
    const m = { timepoints: tps, volumes: [vol('flair-visit-01', 'visit-01'), vol('flair-visit-02', 'visit-02')] };
    expect(volumeForTimepoint(m, 1)?.id).toBe('flair-visit-02');
    expect(volumeForTimepoint(m, 0)?.id).toBe('flair-visit-01');
    expect(volumeForTimepoint(m, 2)?.id).toBe('flair-visit-01'); // no volume for visit 3: first one
    expect(volumeForTimepoint({ volumes: [] }, 0)).toBeUndefined();
  });

  it('scrub and timepoint index round-trip, so gesture and slider agree', () => {
    for (let i = 0; i < 5; i++) expect(scrubToIndex(indexToScrub(i, 5), 5)).toBe(i);
    expect(indexToScrub(3, 1)).toBe(0);
  });

  it('slice planes step along the RAS voxel axes', () => {
    expect(PLANE_AXIS).toEqual({ sagittal: 0, coronal: 1, axial: 2 });
  });
});

describe('banners', () => {
  it('real case packs have no banner; mocks and the test pattern keep theirs', () => {
    expect(caseBanner({ app: 'neuroview' }, false)).toBeNull();
    expect(caseBanner({ app: 'mock' }, true)).toBe('MOCK — NOT ANATOMY');
    expect(caseBanner({ app: 'test-pattern' }, false)).toBe('TEST PATTERN — NOT ANATOMY');
    expect(caseBanner(null, false)).toBeNull();
  });
});

describe('neuroview app config', () => {
  it('scrubs timepoints and carries the dataset credit', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../../../config/apps/neuroview.json', import.meta.url), 'utf8'));
    const c = parseAppConfig(raw);
    expect(c.scrub.target).toBe('timepoint');
    expect(c.credit).toContain('ISBI 2015');
    expect(c.credit).toContain('not for clinical or diagnostic use');
  });
});
