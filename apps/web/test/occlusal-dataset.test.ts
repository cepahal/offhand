import { describe, expect, it } from 'vitest';
import { biteScenario } from '../src/demo/bite-scenarios.js';
import {
  ARCH_FORCE,
  DEMO_FACTORS,
  DEMO_REVIEW,
  centerOfForce,
  crownContactT,
  forceAt,
  forceSamples,
  sideBalance,
  toothForce,
} from '../src/demo/occlusal-dataset.js';

describe('tooth 36 occlusal dataset', () => {
  it('uses one arch table for balance, the highlighted tooth, and the center of force', () => {
    const total = ARCH_FORCE.reduce((sum, tooth) => sum + tooth.percent, 0);
    const balance = sideBalance();
    expect(total).toBeCloseTo(100, 5);
    expect(balance).toEqual({ left: 71, right: 29 });
    expect(toothForce('36')).toBe(Math.max(...ARCH_FORCE.map((tooth) => tooth.percent)));
    expect(toothForce('26')).toBe(toothForce('36'));
    expect(toothForce('16')).toBe(toothForce('46'));
    const scenario = biteScenario('bite-02');
    expect(scenario?.leftPercent).toBe(balance.left);
    const center = centerOfForce();
    expect(center.x).toBeGreaterThan(0);
    expect(forceSamples()[0]).toMatchObject({ total: toothForce('36') * 0 });
  });

  it('follows one bite curve from rest to peak to rest, with tooth 36 as a fixed share', () => {
    expect(forceAt(0)).toBe(0);
    expect(forceAt(10.5)).toBe(0);
    expect(forceAt(3.6)).toBeGreaterThan(forceAt(2));
    expect(forceAt(9.2)).toBeCloseTo(100, 5);
    const samples = forceSamples();
    const peak = samples.reduce((best, sample) => (sample.total > best.total ? sample : best));
    expect(peak.tooth36).toBeCloseTo(peak.total * (toothForce('36') / 100), 5);
    expect(peak.second).toBeGreaterThan(8);
  });

  it('lists the eleven factors and ties the review notes to those figures', () => {
    expect(DEMO_FACTORS).toHaveLength(11);
    expect(DEMO_FACTORS.map((item) => item.status).every((status) => ['Normal', 'Moderate', 'High'].includes(status))).toBe(true);
    expect(DEMO_FACTORS.find((item) => item.name === 'Peak contact pressure')?.value).toBe('18.4 MPa');
    expect(DEMO_FACTORS.find((item) => item.name === 'Left-right balance')?.value).toContain('71% left');
    expect(DEMO_REVIEW.join(' ')).toContain('18.4');
    expect(DEMO_REVIEW.join(' ')).toContain('71%');
    expect(DEMO_REVIEW.join(' ')).toContain('1.6 mm');
    const high = crownContactT(0, 10, 0, 0, 10);
    const low = crownContactT(0, 0, 0, 0, 10);
    expect(high).toBeGreaterThan(low);
    expect(crownContactT(1, 2, 3, 0, 4)).toBe(crownContactT(1, 2, 3, 0, 4));
  });
});
