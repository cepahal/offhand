/**
 * Rule-based reading of a predefined bite scenario.
 * These are demonstration labels, not a diagnosis or a measured analysis.
 */
import { BITE_SCENARIOS, type BiteScenario } from './bite-scenarios.js';
import { BONE_THRESHOLDS } from './bite-view.js';

export type FactorStatus = 'Normal' | 'Elevated' | 'Exceeds Demo Threshold';

export interface BiteFactor {
  name: string;
  value: string;
  threshold: string;
  /** 0–100 fill for the gauge. */
  gauge: number;
  status: FactorStatus;
}

export interface BiteFinding {
  title: string;
  suggestion: string;
}

const STATUS_RANK: Record<FactorStatus, number> = { Normal: 0, Elevated: 1, 'Exceeds Demo Threshold': 2 };

/** High values are the concerning direction. At or under 75% of the threshold is Normal. */
export function highStatus(value: number, threshold: number): FactorStatus {
  if (value > threshold) return 'Exceeds Demo Threshold';
  if (value > threshold * 0.75) return 'Elevated';
  return 'Normal';
}

function gauge(value: number, threshold: number): number {
  return Math.max(0, Math.min(100, Math.round((value / threshold) * 75)));
}

export function resolveTooth(token: string): { ok: true; scenario: BiteScenario } | { ok: false; question: string } {
  const digits = token.replace(/\D/g, '');
  if (!digits) return { ok: false, question: 'Which tooth should I simulate? Use an FDI or Universal number from the ten scenarios.' };
  const number = Number(digits);
  const byFdi = BITE_SCENARIOS.filter((item) => Number(item.fdi) === number);
  const byUniversal = BITE_SCENARIOS.filter((item) => item.universal === number);
  const matches = [...byFdi, ...byUniversal.filter((item) => !byFdi.includes(item))];
  if (matches.length === 1) return { ok: true, scenario: matches[0]! };
  if (matches.length === 0) return { ok: false, question: `Tooth ${digits} is not one of the ten demonstration scenarios. Say the FDI or Universal number again.` };
  const names = matches.map((item) => `FDI ${item.fdi} (Universal ${item.universal})`).join(' or ');
  return { ok: false, question: `Tooth ${digits} matches more than one scenario: ${names}. Which one should I use?` };
}

export function biteFactors(scenario: BiteScenario): BiteFactor[] {
  const peak = Math.max(...scenario.pressure.map((zone) => zone.mpa));
  const dominant = Math.max(scenario.leftPercent, 100 - scenario.leftPercent);
  const rows: { name: string; value: number; shown: string; threshold: number; thresholdText: string }[] = [
    { name: 'Simulated bite force', value: scenario.biteForceN, shown: `${scenario.biteForceN} N`, threshold: 400, thresholdText: '400 N' },
    { name: 'Peak contact pressure', value: peak, shown: `${peak.toFixed(1)} MPa`, threshold: 14, thresholdText: '14 MPa' },
    { name: 'Occlusal contact area', value: scenario.contactAreaMm2, shown: `${scenario.contactAreaMm2} mm²`, threshold: 18, thresholdText: '18 mm²' },
    { name: 'Left-right balance', value: dominant, shown: `${scenario.leftPercent}% left · ${100 - scenario.leftPercent}% right`, threshold: 70, thresholdText: '70% on one side' },
    { name: 'Cusp interference', value: scenario.cuspInterference, shown: String(scenario.cuspInterference), threshold: 50, thresholdText: '50' },
    { name: 'Crown loading', value: scenario.crownLoading, shown: String(scenario.crownLoading), threshold: 55, thresholdText: '55' },
    { name: 'Cortical bone loading', value: scenario.corticalBone, shown: String(scenario.corticalBone), threshold: BONE_THRESHOLDS.corticalBone, thresholdText: String(BONE_THRESHOLDS.corticalBone) },
    { name: 'Trabecular bone loading', value: scenario.trabecularBone, shown: String(scenario.trabecularBone), threshold: BONE_THRESHOLDS.trabecularBone, thresholdText: String(BONE_THRESHOLDS.trabecularBone) },
    { name: 'Periodontal ligament loading', value: scenario.periodontalLigament, shown: String(scenario.periodontalLigament), threshold: BONE_THRESHOLDS.periodontalLigament, thresholdText: String(BONE_THRESHOLDS.periodontalLigament) },
    { name: 'TMJ loading', value: scenario.tmjLoading, shown: String(scenario.tmjLoading), threshold: BONE_THRESHOLDS.tmjLoading, thresholdText: String(BONE_THRESHOLDS.tmjLoading) },
    { name: 'Load concentration', value: scenario.loadConcentration, shown: String(scenario.loadConcentration), threshold: 60, thresholdText: '60' },
  ];
  return rows.map((row) => ({
    name: row.name,
    value: row.shown,
    threshold: row.thresholdText,
    gauge: gauge(row.value, row.threshold),
    status: highStatus(row.value, row.threshold),
  }));
}

export function overallClass(factors: readonly BiteFactor[]): FactorStatus {
  return factors.reduce<FactorStatus>((best, factor) => (STATUS_RANK[factor.status] > STATUS_RANK[best] ? factor.status : best), 'Normal');
}

export function biteFindings(scenario: BiteScenario): BiteFinding[] {
  const findings: BiteFinding[] = [];
  if (scenario.loadConcentration > 60) {
    findings.push({
      title: `Concentrated loading on FDI ${scenario.fdi}`,
      suggestion: 'Review the highlighted occlusal contact point.',
    });
  }
  const dominant = Math.max(scenario.leftPercent, 100 - scenario.leftPercent);
  if (dominant > 70) {
    const side = scenario.leftPercent >= 50 ? 'left' : 'right';
    findings.push({
      title: `Uneven left-right bite distribution (${dominant}% ${side})`,
      suggestion: 'Review restoration contact distribution.',
    });
  }
  if (scenario.cuspInterference > 50) {
    findings.push({ title: 'Potential cusp interference', suggestion: 'Assess potential cusp interference.' });
  }
  if (scenario.crownLoading > 55) {
    findings.push({ title: 'Elevated restoration loading', suggestion: 'Review restoration contact distribution.' });
  }
  const bone = [
    ['Cortical bone', scenario.corticalBone, BONE_THRESHOLDS.corticalBone],
    ['Trabecular bone', scenario.trabecularBone, BONE_THRESHOLDS.trabecularBone],
    ['Periodontal ligament', scenario.periodontalLigament, BONE_THRESHOLDS.periodontalLigament],
  ].filter(([, score, threshold]) => Number(score) > Number(threshold));
  if (bone.length > 0) {
    findings.push({
      title: `Elevated relative bone loading (${bone.map((item) => item[0]).join(', ')})`,
      suggestion: 'Consider further evaluation of the affected bone region.',
    });
  }
  if (scenario.tmjLoading > BONE_THRESHOLDS.tmjLoading) {
    findings.push({
      title: 'Increased relative TMJ loading',
      suggestion: 'Review the relationship between occlusion and TMJ loading.',
    });
  }
  return findings;
}
