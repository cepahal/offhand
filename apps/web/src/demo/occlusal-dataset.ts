/**
 * One illustrative occlusal dataset for FDI tooth 36.
 * Every map, column, balance figure, and time sample comes from these records.
 * This is not a T-Scan recording and not a measured bite.
 */
import { biteScenario } from './bite-scenarios.js';
import { toothAnchor } from './bite-view.js';

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

function plain(name: string, shown: string, explanation: string): DemoFactor {
  return { name, value: shown, bar: 0, status: 'Normal', explanation };
}

export const DEMO_FACTORS: readonly DemoFactor[] = [
  plain('Applied bite force', `${scenario.biteForceN} N`, 'Illustrative total for this record.'),
  plain('Peak contact pressure', `${peak.toFixed(1)} MPa`, `${peakZone.zone} on tooth 36.`),
  plain('Contact area', `${scenario.contactAreaMm2} mm²`, 'Illustrative contact area on tooth 36.'),
  plain('Left-right balance', `${scenario.leftPercent}% left · ${100 - scenario.leftPercent}% right`, `Tooth 36 is ${toothForce('36')}% of the arch total.`),
  plain('Cortical bone loading', String(scenario.corticalBone), 'Illustrative support loading.'),
  plain('Trabecular bone loading', String(scenario.trabecularBone), 'Illustrative support loading.'),
  plain('Periodontal ligament loading', String(scenario.periodontalLigament), 'Illustrative support loading.'),
  plain('TMJ loading', String(scenario.tmjLoading), 'Illustrative joint loading.'),
];

const wisdom = biteScenario('bite-03');
if (!wisdom || wisdom.fdi !== '48') throw new Error('Tooth 48 scenario bite-03 is missing.');
const wisdomPeak = Math.max(...wisdom.pressure.map((zone) => zone.mpa));
const wisdomZone = wisdom.pressure.reduce((best, zone) => (zone.mpa > best.mpa ? zone : best));
const wisdomBalance = caseBalance('48');

export const EXTRACTION_FACTORS: readonly DemoFactor[] = [
  plain('Applied bite force', `${wisdom.biteForceN} N`, 'Illustrative total for this record.'),
  plain('Peak contact pressure', `${wisdomPeak.toFixed(1)} MPa`, `${wisdomZone.zone} on tooth 48.`),
  plain('Contact area', `${wisdom.contactAreaMm2} mm²`, 'Illustrative contact area on tooth 48.'),
  plain('Left-right balance', `${wisdomBalance.left}% left · ${wisdomBalance.right}% right`, `Tooth 48 is ${caseForce('48', '48')}% of the arch total.`),
  plain('Cortical bone loading', String(wisdom.corticalBone), 'Illustrative support loading.'),
  plain('Trabecular bone loading', String(wisdom.trabecularBone), 'Illustrative support loading.'),
  plain('Periodontal ligament loading', String(wisdom.periodontalLigament), 'Illustrative support loading.'),
  plain('TMJ loading', String(wisdom.tmjLoading), 'Illustrative joint loading.'),
];
