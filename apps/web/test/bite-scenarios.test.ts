import { describe, expect, it } from 'vitest';
import { BITE_SCENARIOS, biteScenario, universalFromFdi } from '../src/demo/bite-scenarios.js';
import { biteFactors, biteFindings, resolveTooth } from '../src/demo/bite-analysis.js';
import { boneReading, contactLayout, pressureBand } from '../src/demo/bite-view.js';

describe('bite scenarios', () => {
  it('returns the same ten demonstration records for the same ids', () => {
    expect(BITE_SCENARIOS).toHaveLength(10);
    expect(new Set(BITE_SCENARIOS.map((item) => item.id)).size).toBe(10);
    const first = biteScenario('bite-02');
    const second = biteScenario('bite-02');
    expect(first).toEqual(second);
    expect(first).toMatchObject({ fdi: '36', universal: 19, biteForceN: 420 });
    expect(biteScenario('missing')).toBeUndefined();
  });

  it('uses FDI and Universal for the same tooth', () => {
    expect(universalFromFdi('11')).toBe(8);
    expect(universalFromFdi('16')).toBe(3);
    expect(universalFromFdi('26')).toBe(14);
    expect(universalFromFdi('36')).toBe(19);
    expect(universalFromFdi('46')).toBe(30);
    expect(universalFromFdi('48')).toBe(32);
    for (const item of BITE_SCENARIOS) expect(item.universal).toBe(universalFromFdi(item.fdi));
  });

  it('bands contact pressure and bone scores from the predefined numbers', () => {
    expect(pressureBand(4.2)).toBe('low');
    expect(pressureBand(8)).toBe('moderate');
    expect(pressureBand(12)).toBe('elevated');
    expect(pressureBand(18.4)).toBe('high');
    const light = biteScenario('bite-01')!;
    const heavy = biteScenario('bite-02')!;
    expect(contactLayout(light).map((point) => point.band)).toEqual(['low', 'moderate', 'low']);
    expect(contactLayout(heavy).map((point) => point.band)).toEqual(['high', 'elevated', 'moderate']);
    expect(boneReading(light.corticalBone, 50)).toEqual({ exceeded: false, severity: 'Low' });
    expect(boneReading(heavy.corticalBone, 50)).toEqual({ exceeded: true, severity: 'Elevated' });
  });

  it('resolves a tooth only when one scenario matches and reads its rules', () => {
    expect(resolveTooth('19')).toMatchObject({ ok: true, scenario: { fdi: '36', universal: 19 } });
    expect(resolveTooth('99').ok).toBe(false);
    expect(resolveTooth('14').ok).toBe(false);
    const factors = biteFactors(biteScenario('bite-02')!);
    expect(factors).toHaveLength(11);
    expect(biteFindings(biteScenario('bite-02')!).some((item) => item.title.includes('FDI 36'))).toBe(false);
    expect(biteFindings(biteScenario('bite-02')!).some((item) => /bone loading/i.test(item.title))).toBe(true);
    expect(biteFindings(biteScenario('bite-01')!)).toEqual([]);
  });
});
