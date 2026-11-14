import type { Vec3 } from './common.js';

export interface CameraOrbit {
  /** Degrees in [0, 360): 0 = camera anterior of the target, 90 = patient's right, 180 = posterior, 270 = left. */
  azimuth: number;
  /** Degrees in [-90, 90]: +90 = camera superior of the target, -90 = inferior. */
  elevation: number;
  /** Position-to-target distance, mm. */
  distance: number;
}

const DEG = 180 / Math.PI;
const round3 = (n: number): number => Math.round(n * 1000) / 1000 || 0;

/**
 * Orbit angles of a camera pose in viewer world coordinates (three.js: x = -R, y = S, z = A,
 * the fixed transform in apps/web/src/viewer/logic.ts). Pure; a camera on its target gives 0, 0, 0.
 */
export function cameraOrbit(position: Vec3, target: Vec3): CameraOrbit {
  const r = -(position[0] - target[0]);
  const s = position[1] - target[1];
  const a = position[2] - target[2];
  const horizontal = Math.hypot(r, a);
  const distance = Math.hypot(horizontal, s);
  if (distance === 0) return { azimuth: 0, elevation: 0, distance: 0 };
  const azimuth = (Math.atan2(r, a) * DEG + 360) % 360;
  return { azimuth: round3(azimuth) % 360, elevation: round3(Math.atan2(s, horizontal) * DEG), distance: round3(distance) };
}
