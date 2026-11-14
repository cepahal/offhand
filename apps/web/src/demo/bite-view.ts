/**
 * Display helpers for the bite page. Scores are the predefined scenario numbers.
 * Colors are relative bands, not a calculated stress field.
 */
import type { BiteScenario } from './bite-scenarios.js';

export const BONE_THRESHOLDS = {
  corticalBone: 50,
  trabecularBone: 45,
  periodontalLigament: 55,
  tmjLoading: 40,
} as const;

export type BoneKey = keyof typeof BONE_THRESHOLDS;
export type LoadBand = 'low' | 'moderate' | 'elevated' | 'high';

export const BAND_COLOR: Record<LoadBand, string> = {
  low: '#918f83',
  moderate: '#8ca17d',
  elevated: '#d0a75d',
  high: '#c87869',
};

/** Fixed demonstration bands so a harder scenario reads warmer than a light one. */
export function pressureBand(mpa: number): LoadBand {
  if (mpa < 6) return 'low';
  if (mpa < 10) return 'moderate';
  if (mpa < 14) return 'elevated';
  return 'high';
}

export function boneReading(score: number, threshold: number): { exceeded: boolean; severity: 'Low' | 'Moderate' | 'Elevated' | 'High' } {
  const ratio = threshold <= 0 ? 0 : score / threshold;
  const severity = ratio < 0.7 ? 'Low' : ratio < 1 ? 'Moderate' : ratio < 1.25 ? 'Elevated' : 'High';
  return { exceeded: score > threshold, severity };
}

/** Arch position for an FDI tooth. x is the patient's right when negative. z is anterior when positive. */
export function toothAnchor(fdi: string): { x: number; z: number } {
  const quadrant = Number(fdi[0]);
  const tooth = Number(fdi[1]);
  const side = quadrant === 1 || quadrant === 4 ? -1 : 1;
  return { x: side * (0.12 + tooth * 0.09), z: 0.42 - tooth * 0.09 };
}

export function contactLayout(scenario: BiteScenario): { zone: string; mpa: number; band: LoadBand; x: number; z: number }[] {
  const anchor = toothAnchor(scenario.fdi);
  return scenario.pressure.map((zone, index) => {
    const spread = (index - (scenario.pressure.length - 1) / 2) * 0.08;
    return { zone: zone.zone, mpa: zone.mpa, band: pressureBand(zone.mpa), x: anchor.x + spread, z: anchor.z };
  });
}
