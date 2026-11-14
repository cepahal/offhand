import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCrownGeometry, canalPolylines, poseAt, progressForStage, sliceCenters, stageIndex } from '../src/demo/crown-fit.js';

describe('crown fit sequence', () => {
  it('walks the six tooth 36 stages in order', () => {
    expect(stageIndex(0)).toBe(0);
    expect(stageIndex(progressForStage(2))).toBe(2);
    expect(stageIndex(1)).toBe(5);
    const start = poseAt(0);
    const dissected = poseAt(progressForStage(1));
    const seated = poseAt(1);
    expect(start.crown).toBe(0);
    expect(start.canals).toBe(0);
    expect(dissected.canals).toBeGreaterThan(0.5);
    expect(dissected.section).toBeGreaterThan(0.5);
    expect(seated.crown).toBe(1);
    expect(seated.lift).toBe(0);
    expect(seated.prep).toBe(1);
  });

  it('keeps illustrative canals inside the tooth and builds the crown from its top', () => {
    const tooth = new THREE.CylinderGeometry(2, 1.2, 10, 20, 8);
    tooth.translate(0, 5, 0);
    const slices = sliceCenters(tooth);
    expect(slices.length).toBeGreaterThan(2);
    const lines = canalPolylines(slices);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      for (const point of line) {
        const slice = slices.reduce((best, item) => Math.abs(item.y - point[1]) < Math.abs(best.y - point[1]) ? item : best);
        expect(Math.hypot(point[0] - slice.x, point[2] - slice.z)).toBeLessThanOrEqual(slice.radius + 0.001);
      }
    }
    const crown = buildCrownGeometry(tooth);
    crown.computeBoundingBox();
    tooth.computeBoundingBox();
    expect(crown.boundingBox!.min.y).toBeGreaterThan(tooth.boundingBox!.min.y + 4);
  });
});
