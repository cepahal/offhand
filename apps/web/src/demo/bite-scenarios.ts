/**
 * Ten predefined bite scenarios for the dental screen.
 * Values are illustrative demonstration numbers, not measurements from a patient.
 */
export const BITE_DISCLAIMER = 'Illustrative Simulation — Not Clinical Measurement';

export interface PressureZone {
  zone: string;
  mpa: number;
}

export interface BiteScenario {
  id: string;
  title: string;
  /** FDI two-digit tooth number. */
  fdi: string;
  /** Universal numbering for the same tooth. */
  universal: number;
  biteForceN: number;
  pressure: readonly PressureZone[];
  contactAreaMm2: number;
  /** Share of contact on the patient's left, 0–100. The right share is the remainder. */
  leftPercent: number;
  cuspInterference: number;
  crownLoading: number;
  corticalBone: number;
  trabecularBone: number;
  periodontalLigament: number;
  tmjLoading: number;
  loadConcentration: number;
}

/** FDI quadrant digit to Universal. Quadrant 1 is the patient's upper right. */
export function universalFromFdi(fdi: string): number {
  const quadrant = Number(fdi[0]);
  const tooth = Number(fdi[1]);
  if (quadrant === 1) return 9 - tooth;
  if (quadrant === 2) return 8 + tooth;
  if (quadrant === 3) return 25 - tooth;
  return 24 + tooth;
}

function scenario(input: Omit<BiteScenario, 'universal'>): BiteScenario {
  return { ...input, universal: universalFromFdi(input.fdi) };
}

export const BITE_SCENARIOS: readonly BiteScenario[] = [
  scenario({ id: 'bite-01', title: 'Light centric stop', fdi: '11', biteForceN: 86, pressure: [{ zone: 'Mesial marginal ridge', mpa: 4.2 }, { zone: 'Incisal edge', mpa: 6.1 }, { zone: 'Lingual fossa', mpa: 2.4 }], contactAreaMm2: 3.8, leftPercent: 48, cuspInterference: 12, crownLoading: 22, corticalBone: 18, trabecularBone: 14, periodontalLigament: 20, tmjLoading: 16, loadConcentration: 28 }),
  scenario({ id: 'bite-02', title: 'Left molar clench', fdi: '36', biteForceN: 420, pressure: [{ zone: 'Mesiolingual cusp', mpa: 18.4 }, { zone: 'Central fossa', mpa: 11.2 }, { zone: 'Distobuccal cusp', mpa: 7.6 }], contactAreaMm2: 14.6, leftPercent: 71, cuspInterference: 34, crownLoading: 68, corticalBone: 54, trabecularBone: 47, periodontalLigament: 61, tmjLoading: 29, loadConcentration: 57 }),
  scenario({ id: 'bite-03', title: 'Impacted molar contact', fdi: '48', biteForceN: 190, pressure: [{ zone: 'Occlusal table', mpa: 9.8 }, { zone: 'Distal incline', mpa: 13.1 }], contactAreaMm2: 6.2, leftPercent: 36, cuspInterference: 72, crownLoading: 41, corticalBone: 63, trabecularBone: 58, periodontalLigament: 49, tmjLoading: 44, loadConcentration: 76 }),
  scenario({ id: 'bite-04', title: 'Right first molar', fdi: '16', biteForceN: 380, pressure: [{ zone: 'Mesiobuccal cusp', mpa: 15.2 }, { zone: 'Oblique ridge', mpa: 10.4 }, { zone: 'Distolingual cusp', mpa: 6.8 }], contactAreaMm2: 16.1, leftPercent: 33, cuspInterference: 27, crownLoading: 61, corticalBone: 48, trabecularBone: 39, periodontalLigament: 52, tmjLoading: 38, loadConcentration: 46 }),
  scenario({ id: 'bite-05', title: 'Left first molar', fdi: '26', biteForceN: 365, pressure: [{ zone: 'Mesiopalatal cusp', mpa: 16.7 }, { zone: 'Central fossa', mpa: 9.1 }, { zone: 'Distobuccal cusp', mpa: 5.5 }], contactAreaMm2: 15.4, leftPercent: 74, cuspInterference: 22, crownLoading: 58, corticalBone: 45, trabecularBone: 36, periodontalLigament: 50, tmjLoading: 41, loadConcentration: 43 }),
  scenario({ id: 'bite-06', title: 'Working-side premolar', fdi: '14', biteForceN: 150, pressure: [{ zone: 'Buccal cusp', mpa: 12.6 }, { zone: 'Lingual cusp', mpa: 4.3 }], contactAreaMm2: 5.1, leftPercent: 29, cuspInterference: 58, crownLoading: 36, corticalBone: 31, trabecularBone: 24, periodontalLigament: 44, tmjLoading: 22, loadConcentration: 63 }),
  scenario({ id: 'bite-07', title: 'Balancing premolar', fdi: '24', biteForceN: 128, pressure: [{ zone: 'Palatal cusp', mpa: 8.9 }, { zone: 'Buccal incline', mpa: 3.7 }], contactAreaMm2: 4.4, leftPercent: 66, cuspInterference: 41, crownLoading: 29, corticalBone: 26, trabecularBone: 19, periodontalLigament: 33, tmjLoading: 27, loadConcentration: 39 }),
  scenario({ id: 'bite-08', title: 'Lower right molar', fdi: '46', biteForceN: 445, pressure: [{ zone: 'Distal cusp', mpa: 19.6 }, { zone: 'Central fossa', mpa: 12.8 }, { zone: 'Mesial ridge', mpa: 8.2 }], contactAreaMm2: 17.8, leftPercent: 31, cuspInterference: 19, crownLoading: 74, corticalBone: 66, trabecularBone: 52, periodontalLigament: 69, tmjLoading: 33, loadConcentration: 61 }),
  scenario({ id: 'bite-09', title: 'Incisor protrusion', fdi: '21', biteForceN: 64, pressure: [{ zone: 'Incisal edge', mpa: 7.4 }, { zone: 'Mesial corner', mpa: 3.2 }], contactAreaMm2: 2.6, leftPercent: 57, cuspInterference: 15, crownLoading: 18, corticalBone: 12, trabecularBone: 9, periodontalLigament: 27, tmjLoading: 21, loadConcentration: 34 }),
  scenario({ id: 'bite-10', title: 'Second molar group function', fdi: '37', biteForceN: 310, pressure: [{ zone: 'Buccal cusps', mpa: 14.1 }, { zone: 'Lingual cusps', mpa: 6.9 }, { zone: 'Marginal ridge', mpa: 4.8 }], contactAreaMm2: 12.3, leftPercent: 78, cuspInterference: 47, crownLoading: 55, corticalBone: 49, trabecularBone: 42, periodontalLigament: 58, tmjLoading: 52, loadConcentration: 50 }),
];

/** The same scenario id always returns the same record. An unknown id returns nothing. */
export function biteScenario(id: string): BiteScenario | undefined {
  return BITE_SCENARIOS.find((item) => item.id === id);
}

/** Prefer a scenario whose tooth is the one named in the open training title. */
export function scenarioForTraining(title: string): BiteScenario {
  const fdi = /\b([1-4][1-8])\b/.exec(title)?.[1];
  return BITE_SCENARIOS.find((item) => item.fdi === fdi) ?? BITE_SCENARIOS[0]!;
}
