/**
 * Illustrative extraction sequence for FDI tooth 48.
 * Surface distances use the segmented meshes. Angles, coverage, and the
 * pathway are planning guides, not a surgical recommendation.
 */

export const EXTRACTION_STAGES = [
  { id: 'isolate', label: 'Isolate tooth 48' },
  { id: 'bone', label: 'Transparent bone' },
  { id: 'expose', label: 'Expose roots and canal' },
  { id: 'access', label: 'Surgical access' },
  { id: 'section', label: 'Section tooth' },
  { id: 'extract', label: 'Extraction path' },
  { id: 'site', label: 'Extraction site' },
] as const;

export interface ExtractPose {
  boneOpacity: number;
  canal: number;
  access: number;
  section: number;
  lift: number;
}

export type FactorStatus = 'Normal' | 'Moderate' | 'High' | 'Unavailable';

export interface ExtractionFactor {
  name: string;
  value: string;
  status: FactorStatus;
  bar: number;
  explanation: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Approach {
  distance: number;
  from: Vec3;
  to: Vec3;
}

export interface ExtractionMeasures {
  canalSegmented: boolean;
  nerve: Approach | null;
  neighbor: Approach | null;
  angleDeg: number;
  axis: Vec3;
  depthMm: number;
  curvatureDeg: number;
  boneCoveragePct: number;
  pathwayMm: number | null;
  pathwayDir: Vec3;
}

const DEMO = {
  nerveModerateMm: 3,
  nerveHighMm: 1.5,
  angleModerateDeg: 25,
  angleHighDeg: 45,
  depthModerateMm: 2,
  depthHighMm: 5,
  curveModerateDeg: 15,
  curveHighDeg: 30,
  coverageModeratePct: 40,
  coverageHighPct: 70,
  neighborModerateMm: 2,
  neighborHighMm: 0.8,
  pathwayModerateMm: 3,
  pathwayHighMm: 1.5,
} as const;

export function stageIndex(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  if (t >= 1) return EXTRACTION_STAGES.length - 1;
  return Math.min(EXTRACTION_STAGES.length - 1, Math.floor(t * EXTRACTION_STAGES.length));
}

export function progressForStage(index: number): number {
  const i = Math.min(EXTRACTION_STAGES.length - 1, Math.max(0, index));
  return Math.min(0.995, (i + 0.82) / EXTRACTION_STAGES.length);
}

function blend(from: number, to: number, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return from + (to - from) * (t * t * (3 - 2 * t));
}

export function poseAt(progress: number): ExtractPose {
  const index = stageIndex(progress);
  const scaled = Math.min(0.999, Math.max(0, progress)) * EXTRACTION_STAGES.length;
  const u = scaled - Math.floor(scaled);
  if (index === 0) return { boneOpacity: 0.7, canal: 0, access: 0, section: 0, lift: 0 };
  if (index === 1) return { boneOpacity: blend(0.7, 0.24, u), canal: u * 0.35, access: 0, section: 0, lift: 0 };
  if (index === 2) return { boneOpacity: 0.28, canal: blend(0.35, 1, u), access: u * 0.2, section: 0, lift: 0 };
  if (index === 3) return { boneOpacity: 0.28, canal: 1, access: blend(0.2, 1, u), section: u * 0.15, lift: 0 };
  if (index === 4) return { boneOpacity: 0.28, canal: 1, access: 1, section: blend(0.15, 1, u), lift: 0 };
  if (index === 5) return { boneOpacity: 0.32, canal: 1, access: 0.55, section: 1, lift: blend(0, 1, u) };
  return { boneOpacity: 0.42, canal: 1, access: 0.25, section: 1, lift: 1 };
}

export function sampleStride(count: number, target = 700): number {
  return Math.max(1, Math.floor(count / target));
}

export function closestApproach(from: Vec3[], to: Vec3[]): Approach | null {
  if (from.length === 0 || to.length === 0) return null;
  let best = Infinity;
  let a = from[0]!;
  let b = to[0]!;
  for (const left of from) {
    for (const right of to) {
      const dx = left.x - right.x;
      const dy = left.y - right.y;
      const dz = left.z - right.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < best) {
        best = distance;
        a = left;
        b = right;
      }
    }
  }
  return { distance: best, from: a, to: b };
}

function centroid(points: Vec3[]): Vec3 {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y, z: acc.z + point.z }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function scale(vector: Vec3, amount: number): Vec3 {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function longAxis(points: Vec3[]): { direction: Vec3; angleFromVerticalDeg: number } {
  if (points.length < 2) return { direction: { x: 0, y: 1, z: 0 }, angleFromVerticalDeg: 0 };
  const center = centroid(points);
  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    const z = point.z - center.z;
    xx += x * x;
    yy += y * y;
    zz += z * z;
    xy += x * y;
    xz += x * z;
    yz += y * z;
  }
  let axis = { x: 0, y: 1, z: 0 };
  for (let step = 0; step < 12; step++) {
    axis = normalize({
      x: xx * axis.x + xy * axis.y + xz * axis.z,
      y: xy * axis.x + yy * axis.y + yz * axis.z,
      z: xz * axis.x + yz * axis.y + zz * axis.z,
    });
  }
  if (axis.y < 0) axis = scale(axis, -1);
  const angleFromVerticalDeg = Math.acos(Math.min(1, Math.max(-1, axis.y))) * (180 / Math.PI);
  return { direction: axis, angleFromVerticalDeg };
}

export function rootCurvatureDeg(points: Vec3[]): number {
  if (points.length < 6) return 0;
  const ordered = [...points].sort((a, b) => a.y - b.y);
  const third = Math.max(2, Math.floor(ordered.length / 3));
  const root = centroid(ordered.slice(0, third));
  const middle = centroid(ordered.slice(third, third * 2));
  const crown = centroid(ordered.slice(third * 2));
  const up = normalize({ x: crown.x - middle.x, y: crown.y - middle.y, z: crown.z - middle.z });
  const down = normalize({ x: middle.x - root.x, y: middle.y - root.y, z: middle.z - root.z });
  const dot = Math.min(1, Math.max(-1, up.x * down.x + up.y * down.y + up.z * down.z));
  return Math.acos(dot) * (180 / Math.PI);
}

export function coverageBelow(points: Vec3[], planeY: number): number {
  if (points.length === 0) return 0;
  const below = points.filter((point) => point.y < planeY).length;
  return Math.round((below / points.length) * 1000) / 10;
}

export function extractionDirection(axis: Vec3, awayFromCanal: Vec3 | null): Vec3 {
  const up = axis.y >= 0 ? axis : scale(axis, -1);
  const lifted = { x: up.x * 0.3, y: Math.abs(up.y) + 1, z: up.z * 0.3 };
  if (!awayFromCanal) return normalize(lifted);
  const away = normalize(awayFromCanal);
  const blended = normalize({ x: lifted.x + away.x * 0.35, y: lifted.y, z: lifted.z + away.z * 0.35 });
  return blended.y >= 0 ? blended : scale(blended, -1);
}

export function pathwayClearance(origin: Vec3, direction: Vec3, canal: Vec3[], length = 14): number | null {
  if (canal.length === 0) return null;
  let best = Infinity;
  for (let step = 1; step <= 8; step++) {
    const point = add(origin, scale(direction, (length * step) / 8));
    for (const sample of canal) {
      best = Math.min(best, Math.hypot(point.x - sample.x, point.y - sample.y, point.z - sample.z));
    }
  }
  return best;
}

function lowerIsWorse(value: number, moderate: number, high: number): FactorStatus {
  if (value < high) return 'High';
  if (value < moderate) return 'Moderate';
  return 'Normal';
}

function higherIsWorse(value: number, moderate: number, high: number): FactorStatus {
  if (value > high) return 'High';
  if (value > moderate) return 'Moderate';
  return 'Normal';
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function extractionFactors(measures: ExtractionMeasures): ExtractionFactor[] {
  const nerveStatus = measures.nerve ? lowerIsWorse(measures.nerve.distance, DEMO.nerveModerateMm, DEMO.nerveHighMm) : 'Unavailable';
  const neighborStatus = measures.neighbor ? lowerIsWorse(measures.neighbor.distance, DEMO.neighborModerateMm, DEMO.neighborHighMm) : 'Unavailable';
  const pathwayStatus = measures.pathwayMm === null ? 'Unavailable' : lowerIsWorse(measures.pathwayMm, DEMO.pathwayModerateMm, DEMO.pathwayHighMm);
  const angleStatus = higherIsWorse(measures.angleDeg, DEMO.angleModerateDeg, DEMO.angleHighDeg);
  const depthStatus = higherIsWorse(measures.depthMm, DEMO.depthModerateMm, DEMO.depthHighMm);
  const curveStatus = higherIsWorse(measures.curvatureDeg, DEMO.curveModerateDeg, DEMO.curveHighDeg);
  const coverageStatus = higherIsWorse(measures.boneCoveragePct, DEMO.coverageModeratePct, DEMO.coverageHighPct);
  const ranked = [nerveStatus, angleStatus, depthStatus, curveStatus, coverageStatus, neighborStatus, pathwayStatus];
  const score = ranked.reduce((sum, status) => sum + (status === 'High' ? 2 : status === 'Moderate' ? 1 : 0), 0);
  const complexity: FactorStatus = score >= 4 ? 'High' : score >= 2 ? 'Moderate' : 'Normal';
  return [
    {
      name: 'Nerve proximity',
      value: measures.nerve ? `${round1(measures.nerve.distance)} mm` : 'Not segmented',
      status: nerveStatus,
      bar: measures.nerve ? Math.max(8, Math.min(100, (1 - measures.nerve.distance / 6) * 100)) : 0,
      explanation: measures.canalSegmented
        ? 'Closest gap between the tooth 48 surface and the segmented right inferior alveolar canal. Demonstration marks: under 1.5 mm is High. Not a clinical measurement.'
        : 'This candidate has no right inferior alveolar canal layer, so no nerve distance is shown.',
    },
    {
      name: 'Impaction angulation',
      value: `${round1(measures.angleDeg)}°`,
      status: angleStatus,
      bar: Math.min(100, (measures.angleDeg / 60) * 100),
      explanation: 'Long axis of the segmented tooth 48, measured from vertical. Over 45° is High on this demonstration scale.',
    },
    {
      name: 'Impaction depth',
      value: measures.depthMm >= 0 ? `${round1(measures.depthMm)} mm below` : `${round1(-measures.depthMm)} mm above`,
      status: depthStatus,
      bar: Math.min(100, Math.max(0, measures.depthMm / 8) * 100),
      explanation: 'How far the top of tooth 48 sits below the top of tooth 47. Over 5 mm is High on this demonstration scale.',
    },
    {
      name: 'Root morphology',
      value: `${round1(measures.curvatureDeg)}° curve`,
      status: curveStatus,
      bar: Math.min(100, (measures.curvatureDeg / 45) * 100),
      explanation: 'Change in direction between the root third and the crown third of the segmented tooth. Over 30° is High here. Not a classified root form.',
    },
    {
      name: 'Surrounding bone coverage',
      value: `${round1(measures.boneCoveragePct)}%`,
      status: coverageStatus,
      bar: measures.boneCoveragePct,
      explanation: 'Share of tooth 48 samples below the occlusal height of tooth 47. This is a height comparison, not measured bone thickness.',
    },
    {
      name: 'Adjacent second-molar proximity',
      value: measures.neighbor ? `${round1(measures.neighbor.distance)} mm` : 'Tooth 47 missing',
      status: neighborStatus,
      bar: measures.neighbor ? Math.max(8, Math.min(100, (1 - measures.neighbor.distance / 4) * 100)) : 0,
      explanation: 'Closest gap between the segmented surfaces of tooth 48 and tooth 47. Under 0.8 mm is High on this demonstration scale.',
    },
    {
      name: 'Extraction pathway clearance',
      value: measures.pathwayMm === null ? 'Not segmented' : `${round1(measures.pathwayMm)} mm`,
      status: pathwayStatus,
      bar: measures.pathwayMm === null ? 0 : Math.max(8, Math.min(100, (measures.pathwayMm / 6) * 100)),
      explanation: 'Smallest gap between the illustrative removal path and the segmented canal. The path is a guide drawn away from the canal and upward. It is not a chosen surgical route.',
    },
    {
      name: 'Anatomical complexity',
      value: complexity,
      status: complexity,
      bar: Math.min(100, score * 12),
      explanation: 'Count of the demonstration marks above. It does not predict surgical risk and does not choose a technique.',
    },
  ];
}

export function extractionNotes(measures: ExtractionMeasures): Array<{ title: string; detail: string }> {
  const nerve = measures.nerve
    ? `The segmented right inferior alveolar canal comes within ${round1(measures.nerve.distance)} mm of tooth 48. That gap is a surface-to-surface figure from this scan, not a validated nerve-risk score.`
    : 'No right inferior alveolar canal is segmented in this candidate, so the view does not invent one.';
  const neighbor = measures.neighbor
    ? `Tooth 47 is ${round1(measures.neighbor.distance)} mm from tooth 48 at the closest segmented surfaces. The crown of tooth 48 sits ${round1(measures.depthMm)} mm below the top of tooth 47.`
    : 'Tooth 47 is not in this candidate, so adjacent-molar clearance is not shown.';
  return [
    { title: 'Nerve relationship', detail: nerve },
    { title: 'Tooth position', detail: `The long axis leans ${round1(measures.angleDeg)}° from vertical, and the root-to-crown direction changes by ${round1(measures.curvatureDeg)}°. ${round1(measures.boneCoveragePct)}% of the tooth samples sit below the adjacent occlusal height.` },
    { title: 'Adjacent molar', detail: neighbor },
    {
      title: 'Illustrative pathway',
      detail: measures.pathwayMm === null
        ? 'Without a segmented canal, the page does not draw a clearance figure for a removal path.'
        : `The drawn path leaves upward and away from the canal. Along that line the canal stays ${round1(measures.pathwayMm)} mm away. The section and the lift are a demonstration of access, not an instruction to section or deliver the tooth.`,
    },
  ];
}
