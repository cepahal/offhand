/**
 * Illustrative crown-fit sequence for FDI tooth 36.
 * The scan supplies the tooth surface. Canal fill and the listed fit figures are not
 * measurements from a fabricated crown.
 */
import * as THREE from 'three';
import { crownContactT, rampColor } from './occlusal-dataset.js';

export const CROWN_STAGES = [
  { id: 'initial', label: 'Initial tooth' },
  { id: 'dissection', label: 'Treatment dissection' },
  { id: 'prepared', label: 'Prepared tooth' },
  { id: 'position', label: 'Crown positioning' },
  { id: 'seating', label: 'Crown seating' },
  { id: 'analysis', label: 'Crown-fit analysis' },
] as const;

/** Planning figures for the callouts. They are not a clinical fit report. */
export const CROWN_FIT_FIGURES = {
  cuspAngleDeg: 32,
  marginalGapMm: 0.42,
  occlusalClearanceMm: 1.6,
  crownHeightMm: 2.1,
  occlusalContactPct: 68,
  contactAreaPct: 72,
  seatingAxisDeg: 2.8,
  marginContinuityPct: 98,
  clearanceAvgMm: 1.1,
} as const;

export interface FitPose {
  /** 0 = no section, 1 = cut through the tooth center. */
  section: number;
  /** 0 = full crown of the tooth, 1 = coronal preparation. */
  prep: number;
  canals: number;
  crown: number;
  /** 1 = crown held above the tooth, 0 = seated with the illustrative clearance. */
  lift: number;
  contacts: number;
}

export function stageIndex(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  if (t >= 1) return CROWN_STAGES.length - 1;
  return Math.min(CROWN_STAGES.length - 1, Math.floor(t * CROWN_STAGES.length));
}

export function progressForStage(index: number): number {
  const i = Math.min(CROWN_STAGES.length - 1, Math.max(0, index));
  return Math.min(0.995, (i + 0.82) / CROWN_STAGES.length);
}

export function poseAt(progress: number): FitPose {
  const index = stageIndex(progress);
  const scaled = Math.min(0.999, Math.max(0, progress)) * CROWN_STAGES.length;
  const u = scaled - Math.floor(scaled);
  if (index === 0) return { section: u * 0.2, prep: 0, canals: 0, crown: 0, lift: 1, contacts: 0 };
  if (index === 1) return { section: 0.2 + u * 0.8, prep: u * 0.25, canals: u, crown: 0, lift: 1, contacts: 0 };
  if (index === 2) return { section: 1, prep: 0.25 + u * 0.75, canals: 1, crown: 0, lift: 1, contacts: 0 };
  if (index === 3) return { section: 1, prep: 1, canals: 1, crown: Math.max(u, 0.35), lift: 1, contacts: 0 };
  if (index === 4) return { section: 1, prep: 1, canals: 1, crown: 1, lift: 1 - u, contacts: u * 0.35 };
  return { section: 1, prep: 1, canals: 1, crown: 1, lift: 0, contacts: 1 };
}

export interface SliceCenter {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Three canal polylines around the tooth axis. Every point stays inside that slice's radius. */
export function canalPolylines(slices: SliceCenter[]): Array<Array<[number, number, number]>> {
  if (slices.length < 2) return [];
  const angles = [0.4, 2.5, 4.4];
  return angles.map((angle, canal) => slices.map((slice, index) => {
    const taper = index / Math.max(1, slices.length - 1);
    const reach = slice.radius * (0.34 - taper * 0.22);
    const spin = angle + canal * 0.15;
    return [
      slice.x + Math.cos(spin) * reach,
      slice.y,
      slice.z + Math.sin(spin) * reach,
    ] as [number, number, number];
  }));
}

export function sliceCenters(geometry: THREE.BufferGeometry, from = 0.08, to = 0.62, count = 7): SliceCenter[] {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return [];
  const height = box.max.y - box.min.y;
  if (height < 1) return [];
  const pos = geometry.getAttribute('position');
  const slices: SliceCenter[] = [];
  for (let s = 0; s < count; s++) {
    const y0 = box.min.y + height * (from + ((to - from) * s) / count);
    const y1 = y0 + (height * (to - from)) / count;
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    let reach = 0;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      if (py < y0 || py >= y1) continue;
      x += pos.getX(i);
      y += py;
      z += pos.getZ(i);
      n += 1;
    }
    if (n < 12) continue;
    x /= n;
    y /= n;
    z /= n;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      if (py < y0 || py >= y1) continue;
      reach = Math.max(reach, Math.hypot(pos.getX(i) - x, pos.getZ(i) - z));
    }
    slices.push({ x, y, z, radius: Math.max(reach, height * 0.04) });
  }
  return slices;
}

function triangleIndices(geometry: THREE.BufferGeometry): number[] {
  const index = geometry.getIndex();
  if (index) return Array.from(index.array);
  const count = geometry.getAttribute('position').count;
  return Array.from({ length: count }, (_, i) => i);
}

/** Coronal portion of the scanned tooth, capped at the preparation plane. */
export function buildCrownGeometry(source: THREE.BufferGeometry, marginFraction = 0.64): THREE.BufferGeometry {
  source.computeBoundingBox();
  const box = source.boundingBox;
  const empty = new THREE.BufferGeometry();
  if (!box) return empty;
  const marginY = box.min.y + (box.max.y - box.min.y) * marginFraction;
  const pos = source.getAttribute('position');
  const ids = triangleIndices(source);
  const out: number[] = [];
  const loop: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i + 2 < ids.length; i += 3) {
    a.fromBufferAttribute(pos, ids[i]!);
    b.fromBufferAttribute(pos, ids[i + 1]!);
    c.fromBufferAttribute(pos, ids[i + 2]!);
    const mid = (a.y + b.y + c.y) / 3;
    if (mid < marginY) continue;
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (const p of [a, b, c]) {
      if (p.y < marginY + (box.max.y - marginY) * 0.18) loop.push(p.clone());
    }
  }
  if (out.length < 9) return empty;
  const center = new THREE.Vector3();
  for (const p of loop) center.add(p);
  if (loop.length > 0) center.multiplyScalar(1 / loop.length);
  center.y = marginY;
  const unique: THREE.Vector3[] = [];
  for (const p of loop) {
    if (unique.some((q) => q.distanceToSquared(p) < 0.04)) continue;
    unique.push(p);
  }
  unique.sort((p, q) => Math.atan2(p.z - center.z, p.x - center.x) - Math.atan2(q.z - center.z, q.x - center.x));
  for (let i = 0; i < unique.length; i++) {
    const p = unique[i]!;
    const q = unique[(i + 1) % unique.length]!;
    out.push(center.x, center.y, center.z, p.x, p.y, p.z, q.x, q.y, q.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  geometry.computeVertexNormals();
  paintContacts(geometry);
  return geometry;
}

export function paintContacts(geometry: THREE.BufferGeometry, floor?: number): void {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) return;
  let min = floor ?? Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (floor === undefined && y < min) min = y;
    if (y > max) max = y;
  }
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = rampColor(crownContactT(pos.getX(i), pos.getY(i), pos.getZ(i), min, max));
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Share of the high occlusal vertices on each side of the tooth center. Not a force reading. */
export function highSurfaceSplit(geometry: THREE.BufferGeometry): { mesial: number; distal: number } {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) return { mesial: 50, distal: 50 };
  let min = Infinity;
  let max = -Infinity;
  let meanX = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < min) min = y;
    if (y > max) max = y;
    meanX += pos.getX(i);
  }
  meanX /= pos.count;
  const cut = min + (max - min) * 0.72;
  let mesial = 0;
  let distal = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < cut) continue;
    if (pos.getX(i) <= meanX) mesial += 1;
    else distal += 1;
  }
  const total = mesial + distal;
  if (total === 0) return { mesial: 50, distal: 50 };
  return {
    mesial: Math.round((mesial / total) * 100),
    distal: Math.round((distal / total) * 100),
  };
}

export function contourLoops(geometry: THREE.BufferGeometry, bands = 3): THREE.Vector3[][] {
  const pos = geometry.getAttribute('position');
  const loops: THREE.Vector3[][] = [];
  if (!pos || pos.count === 0) return loops;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const span = Math.max(0.001, max - min);
  for (let band = 1; band <= bands; band++) {
    const y = min + span * (0.22 + band * 0.18);
    const picked: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - y) > span * 0.035) continue;
      picked.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      if (picked.length > 80) break;
    }
    if (picked.length < 8) continue;
    const c = picked.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / picked.length);
    picked.sort((p, q) => Math.atan2(p.z - c.z, p.x - c.x) - Math.atan2(q.z - c.z, q.x - c.x));
    loops.push(picked);
  }
  return loops;
}
