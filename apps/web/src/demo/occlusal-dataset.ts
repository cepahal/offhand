/**
 * One illustrative occlusal dataset for FDI tooth 36.
 * Every map, column, balance figure, and time sample comes from these records.
 * This is not a T-Scan recording and not a measured bite.
 */
import { biteScenario } from './bite-scenarios.js';
import { toothAnchor } from './bite-view.js';
import { BONE_THRESHOLDS } from './bite-view.js';

export const CONTACT_RAMP: ReadonlyArray<readonly [number, number, number]> = [
  [0.18, 0.42, 0.86],
  [0.22, 0.72, 0.48],
  [0.86, 0.76, 0.28],
  [0.86, 0.42, 0.18],
  [0.78, 0.22, 0.18],
];

/** Percent of the illustrative arch force. Left (FDI 3x) sums to 71. Right sums to 29. */
export const ARCH_FORCE: readonly { fdi: string; percent: number }[] = [
  { fdi: '38', percent: 6.5 },
  { fdi: '37', percent: 14 },
  { fdi: '36', percent: 24 },
  { fdi: '35', percent: 9 },
  { fdi: '34', percent: 7.5 },
  { fdi: '33', percent: 4.5 },
  { fdi: '32', percent: 3 },
  { fdi: '31', percent: 2.5 },
  { fdi: '41', percent: 0.5 },
  { fdi: '42', percent: 0.8 },
  { fdi: '43', percent: 1.6 },
  { fdi: '44', percent: 3.2 },
  { fdi: '45', percent: 4.5 },
  { fdi: '46', percent: 9.5 },
  { fdi: '47', percent: 6.5 },
  { fdi: '48', percent: 2.4 },
];

/** Upper tooth that meets this lower tooth, and the reverse. 36 meets 26. */
export function opposingFdi(fdi: string): string {
  const pair: Record<string, string> = { '1': '4', '4': '1', '2': '3', '3': '2' };
  return `${pair[fdi[0] ?? ''] ?? fdi[0]}${fdi[1] ?? ''}`;
}

export function toothForce(fdi: string): number {
  const listed = ARCH_FORCE.find((item) => item.fdi === fdi)?.percent;
  if (listed !== undefined) return listed;
  return ARCH_FORCE.find((item) => item.fdi === opposingFdi(fdi))?.percent ?? 0;
}

export type ReportFocus = '36' | '48';

/** Tooth 36 keeps the arch table. Tooth 48 takes that peak share, and tooth 36 keeps the small wisdom-tooth share. */
export function caseForce(fdi: string, focus: ReportFocus = '36'): number {
  if (focus === '48') {
    if (fdi === '48' || fdi === '18') return toothForce('36');
    if (fdi === '36' || fdi === '26') return toothForce('48');
  }
  return toothForce(fdi);
}

export function caseBalance(focus: ReportFocus = '36'): { left: number; right: number } {
  if (focus === '36') return sideBalance();
  let left = 0;
  let right = 0;
  for (const tooth of ARCH_FORCE) {
    const percent = caseForce(tooth.fdi, focus);
    if (tooth.fdi.startsWith('3')) left += percent;
    else right += percent;
  }
  return { left: Math.round(left * 10) / 10, right: Math.round(right * 10) / 10 };
}

export const UPPER_ORDER = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'] as const;
export const LOWER_ORDER = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'] as const;

export function sideBalance(): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const tooth of ARCH_FORCE) {
    if (tooth.fdi.startsWith('3')) left += tooth.percent;
    else right += tooth.percent;
  }
  return { left: Math.round(left * 10) / 10, right: Math.round(right * 10) / 10 };
}

export function centerOfForce(): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let weight = 0;
  for (const tooth of ARCH_FORCE) {
    const anchor = toothAnchor(tooth.fdi);
    x += anchor.x * tooth.percent;
    z += anchor.z * tooth.percent;
    weight += tooth.percent;
  }
  return { x: x / weight, z: z / weight };
}

/** Same height rule as the crown-fit contact colors, so tooth 36 matches that crown. */
export function crownContactT(x: number, y: number, z: number, minY: number, maxY: number): number {
  const span = Math.max(0.001, maxY - minY);
  const patch = Math.sin(x * 0.85) * Math.cos(z * 0.7) * 0.16;
  return Math.min(1, Math.max(0, (y - minY) / span + patch));
}

export function rampColor(t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, t)) * (CONTACT_RAMP.length - 1);
  const lo = Math.floor(u);
  const hi = Math.min(CONTACT_RAMP.length - 1, lo + 1);
  const f = u - lo;
  const a = CONTACT_RAMP[lo] ?? CONTACT_RAMP[0]!;
  const b = CONTACT_RAMP[hi] ?? a;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function rampHex(t: number): string {
  const [r, g, b] = rampColor(t).map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'));
  return `#${r}${g}${b}`;
}

/** Illustrative total-force curve, 0–10.5 s. 0 is rest, 100 is the peak of this demo. */
export function forceAt(second: number): number {
  const t = Math.min(10.5, Math.max(0, second));
  const smooth = (a: number, b: number) => {
    const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  if (t < 2.8) return 0;
  if (t < 4) return smooth(2.8, 4) * 42;
  if (t < 6.6) return 42 - smooth(4, 6.6) * 34;
  if (t < 9.2) return 8 + smooth(6.6, 9.2) * 92;
  if (t < 10.3) return 100 * (1 - smooth(9.2, 10.3));
  return 0;
}

export function forceSamples(step = 0.15): Array<{ second: number; total: number; tooth36: number }> {
  const share = toothForce('36') / 100;
  const samples: Array<{ second: number; total: number; tooth36: number }> = [];
  for (let second = 0; second <= 10.5 + 1e-6; second += step) {
    const total = forceAt(second);
    samples.push({ second: Math.round(second * 100) / 100, total, tooth36: total * share });
  }
  return samples;
}

export type DemoStatus = 'Normal' | 'Moderate' | 'High';

export function demoStatus(value: number, threshold: number): DemoStatus {
  if (value > threshold) return 'High';
  if (value > threshold * 0.75) return 'Moderate';
  return 'Normal';
}

export interface DemoFactor {
  name: string;
  value: string;
  bar: number;
  status: DemoStatus;
  explanation: string;
}

const scenario = biteScenario('bite-02');
if (!scenario || scenario.fdi !== '36') throw new Error('Tooth 36 scenario bite-02 is missing.');

const peak = Math.max(...scenario.pressure.map((zone) => zone.mpa));
const peakZone = scenario.pressure.reduce((best, zone) => (zone.mpa > best.mpa ? zone : best));

function factor(name: string, value: number, shown: string, threshold: number, explanation: string): DemoFactor {
  return {
    name,
    value: shown,
    bar: Math.max(4, Math.min(100, Math.round((value / threshold) * 75))),
    status: demoStatus(value, threshold),
    explanation,
  };
}

export const DEMO_FACTORS: readonly DemoFactor[] = [
  factor('Applied bite force', scenario.biteForceN, `${scenario.biteForceN} N`, 400, 'Demonstration mark is 400 N. This record sits above it.'),
  factor('Peak contact pressure', peak, `${peak.toFixed(1)} MPa`, 14, `Highest zone is the ${peakZone.zone.toLowerCase()} of tooth 36.`),
  factor('Contact area', scenario.contactAreaMm2, `${scenario.contactAreaMm2} mm²`, 18, 'Under the 18 mm² demonstration mark, and above three quarters of it.'),
  factor('Left-right balance', scenario.leftPercent, `${scenario.leftPercent}% left · ${100 - scenario.leftPercent}% right`, 70, 'Left share is the FDI 3x teeth in the arch table. Right is the remainder.'),
  factor('Cusp interference', scenario.cuspInterference, String(scenario.cuspInterference), 50, 'Under the demonstration mark of 50.'),
  factor('Crown loading', scenario.crownLoading, String(scenario.crownLoading), 55, 'Tooth 36 carries the largest arch share, 24% of this illustrative total.'),
  factor('Cortical bone loading', scenario.corticalBone, String(scenario.corticalBone), BONE_THRESHOLDS.corticalBone, `Demonstration mark is ${BONE_THRESHOLDS.corticalBone}.`),
  factor('Trabecular bone loading', scenario.trabecularBone, String(scenario.trabecularBone), BONE_THRESHOLDS.trabecularBone, `Demonstration mark is ${BONE_THRESHOLDS.trabecularBone}.`),
  factor('Periodontal ligament loading', scenario.periodontalLigament, String(scenario.periodontalLigament), BONE_THRESHOLDS.periodontalLigament, `Demonstration mark is ${BONE_THRESHOLDS.periodontalLigament}.`),
  factor('TMJ loading', scenario.tmjLoading, String(scenario.tmjLoading), BONE_THRESHOLDS.tmjLoading, `Demonstration mark is ${BONE_THRESHOLDS.tmjLoading}.`),
  factor('Load concentration', scenario.loadConcentration, String(scenario.loadConcentration), 60, 'Under the demonstration mark of 60, and above three quarters of it.'),
];

export interface DemoNote {
  title: string;
  detail: string;
}

export const DEMO_NOTES: readonly DemoNote[] = [
  {
    title: 'Crown contact on tooth 36',
    detail: `The peak zone is the ${peakZone.zone.toLowerCase()} at ${peak.toFixed(1)} MPa. That is the red end of the same contact scale used on the crown.`,
  },
  {
    title: 'Uneven arch loading',
    detail: `${scenario.leftPercent}% of the illustrative force is on the left. Tooth 36 is ${toothForce('36')}% of the arch total, larger than tooth 46 at ${toothForce('46')}%.`,
  },
  {
    title: 'Clearance and seating',
    detail: 'The crown-fit view holds a 1.6 mm illustrative occlusal clearance and a 0.42 mm margin figure. Those are planning labels, not a measured gap.',
  },
  {
    title: 'Supporting structures',
    detail: `Crown loading is ${scenario.crownLoading}, cortical bone is ${scenario.corticalBone}, and periodontal ligament loading is ${scenario.periodontalLigament}. Each is above its demonstration mark.`,
  },
];

const wisdom = biteScenario('bite-03');
if (!wisdom || wisdom.fdi !== '48') throw new Error('Tooth 48 scenario bite-03 is missing.');
const wisdomPeak = Math.max(...wisdom.pressure.map((zone) => zone.mpa));
const wisdomZone = wisdom.pressure.reduce((best, zone) => (zone.mpa > best.mpa ? zone : best));
const wisdomBalance = caseBalance('48');

export const EXTRACTION_FACTORS: readonly DemoFactor[] = [
  factor('Applied bite force', wisdom.biteForceN, `${wisdom.biteForceN} N`, 400, 'Demonstration mark is 400 N. This impacted-molar record sits under it.'),
  factor('Peak contact pressure', wisdomPeak, `${wisdomPeak.toFixed(1)} MPa`, 14, `Highest zone is the ${wisdomZone.zone.toLowerCase()} of tooth 48.`),
  factor('Contact area', wisdom.contactAreaMm2, `${wisdom.contactAreaMm2} mm²`, 18, 'Under the 18 mm² demonstration mark. The third molar meets a smaller area than tooth 36.'),
  factor('Left-right balance', wisdomBalance.right, `${wisdomBalance.left}% left · ${wisdomBalance.right}% right`, 70, 'Tooth 48 carries the 24% peak, so the right side of this arch is heavier than the tooth 36 record.'),
  factor('Cusp interference', wisdom.cuspInterference, String(wisdom.cuspInterference), 50, 'Above the demonstration mark of 50. The impacted crown meets the opposing tooth unevenly.'),
  factor('Crown loading', wisdom.crownLoading, String(wisdom.crownLoading), 55, 'Tooth 48 carries the largest arch share in this record, 24% of the illustrative total.'),
  factor('Cortical bone loading', wisdom.corticalBone, String(wisdom.corticalBone), BONE_THRESHOLDS.corticalBone, `Demonstration mark is ${BONE_THRESHOLDS.corticalBone}.`),
  factor('Trabecular bone loading', wisdom.trabecularBone, String(wisdom.trabecularBone), BONE_THRESHOLDS.trabecularBone, `Demonstration mark is ${BONE_THRESHOLDS.trabecularBone}.`),
  factor('Periodontal ligament loading', wisdom.periodontalLigament, String(wisdom.periodontalLigament), BONE_THRESHOLDS.periodontalLigament, `Demonstration mark is ${BONE_THRESHOLDS.periodontalLigament}.`),
  factor('TMJ loading', wisdom.tmjLoading, String(wisdom.tmjLoading), BONE_THRESHOLDS.tmjLoading, `Demonstration mark is ${BONE_THRESHOLDS.tmjLoading}.`),
  factor('Load concentration', wisdom.loadConcentration, String(wisdom.loadConcentration), 60, 'Above the demonstration mark of 60. The load sits on the impacted crown rather than a prepared crown.'),
];

export const EXTRACTION_NOTES: readonly DemoNote[] = [
  {
    title: 'Contact on tooth 48',
    detail: `The peak zone is the ${wisdomZone.zone.toLowerCase()} at ${wisdomPeak.toFixed(1)} MPa. The colors use the same contact scale as the root-canal report.`,
  },
  {
    title: 'Arch loading after the swap',
    detail: `${wisdomBalance.right}% of the illustrative force is on the right. Tooth 48 is ${caseForce('48', '48')}% of the arch total. Tooth 18 carries the same share.`,
  },
  {
    title: 'Extraction and the bite',
    detail: 'The section and lift above remove only tooth 48. This contact map is the bite before that tooth leaves the arch. It is not a crown seating.',
  },
  {
    title: 'Supporting structures',
    detail: `Crown loading is ${wisdom.crownLoading}, cortical bone is ${wisdom.corticalBone}, and periodontal ligament loading is ${wisdom.periodontalLigament}.`,
  },
];

export const EXTRACTION_REVIEW: readonly string[] = [
  `Review the ${wisdomZone.zone.toLowerCase()} contact on tooth 48. It is the peak at ${wisdomPeak.toFixed(1)} MPa.`,
  `Compare that contact with the left side. This record puts ${wisdomBalance.right}% of the force on the right.`,
  'The extraction sequence removes tooth 48 only. The neighboring teeth stay in the jaw.',
  `Review load around tooth 48. Periodontal ligament loading is ${wisdom.periodontalLigament} and cortical bone is ${wisdom.corticalBone}.`,
];

export const DEMO_REVIEW: readonly string[] = [
  `Review the ${peakZone.zone.toLowerCase()} contact on the tooth 36 crown. It is the peak at ${peak.toFixed(1)} MPa.`,
  `Compare that contact with the lighter right side. The arch table puts ${scenario.leftPercent}% of the force on the left.`,
  'Recheck the 1.6 mm illustrative clearance and the 0.42 mm margin label before any change to the crown shape.',
  `Review load around the tooth 36 support. Periodontal ligament loading is ${scenario.periodontalLigament} and cortical bone is ${scenario.corticalBone}, both above their demonstration marks.`,
];
