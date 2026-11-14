import { describe, expect, it } from 'vitest';
import {
  closestApproach,
  coverageBelow,
  extractionDirection,
  extractionFactors,
  longAxis,
  pathwayClearance,
  poseAt,
  progressForStage,
  rootCurvatureDeg,
  stageIndex,
  type Vec3,
} from '../src/demo/extraction-plan.js';

const point = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describe('wisdom-tooth extraction sequence', () => {
  it('walks the seven tooth 48 stages without moving anatomy before the section', () => {
    expect(stageIndex(0)).toBe(0);
    expect(stageIndex(progressForStage(3))).toBe(3);
    expect(stageIndex(1)).toBe(6);
    const isolate = poseAt(0);
    const exposed = poseAt(progressForStage(2));
    const sectioned = poseAt(progressForStage(4));
    const delivered = poseAt(1);
    expect(isolate.boneOpacity).toBeLessThan(1);
    expect(isolate.boneOpacity).toBeGreaterThan(0.5);
    expect(isolate.canal).toBe(0);
    expect(isolate.lift).toBe(0);
    expect(exposed.canal).toBeGreaterThan(0.8);
    expect(exposed.boneOpacity).toBeLessThan(0.4);
    expect(exposed.lift).toBe(0);
    expect(sectioned.section).toBeGreaterThan(0.8);
    expect(sectioned.lift).toBe(0);
    expect(delivered.lift).toBe(1);
    expect(delivered.section).toBe(1);
    expect(delivered.canal).toBe(1);
  });

  it('measures the segmented surfaces and keeps the removal path off the canal', () => {
    const tooth = [point(0, 2, 0), point(0, 8, 0)];
    const canal = [point(0, 2, 3), point(0, 6, 3)];
    const neighbor = [point(4, 2, 0), point(4, 9, 0)];
    const nerve = closestApproach(tooth, canal);
    const molar = closestApproach(tooth, neighbor);
    expect(nerve?.distance).toBeCloseTo(3, 5);
    expect(molar?.distance).toBeCloseTo(4, 5);
    const tilted = [point(0, 0, 0), point(1, 1, 0), point(2, 2, 0)];
    const axis = longAxis(tilted);
    expect(axis.angleFromVerticalDeg).toBeGreaterThan(40);
    expect(axis.angleFromVerticalDeg).toBeLessThan(50);
    const straight = [point(0, 0, 0), point(0, 3, 0), point(0, 6, 0), point(0, 9, 0)];
    expect(rootCurvatureDeg(straight)).toBeLessThan(1);
    const bent = [point(0, 0, 0), point(0, 1, 0), point(0, 2, 0), point(1, 3, 0), point(2, 4, 0), point(3, 5, 0)];
    expect(rootCurvatureDeg(bent)).toBeGreaterThan(20);
    expect(coverageBelow(tooth, 9)).toBe(100);
    const direction = extractionDirection(axis.direction, { x: 0, y: 1, z: -1 });
    expect(direction.y).toBeGreaterThan(0);
    const clearance = pathwayClearance(point(0, 8, 0), direction, canal);
    expect(clearance).not.toBeNull();
    expect(clearance!).toBeGreaterThan(nerve!.distance - 0.01);
  });

  it('builds eight demonstration factors and does not invent a missing canal', () => {
    const withCanal = extractionFactors({
      canalSegmented: true,
      nerve: { distance: 1.2, from: point(0, 0, 0), to: point(1.2, 0, 0) },
      neighbor: { distance: 1.1, from: point(0, 0, 0), to: point(1.1, 0, 0) },
      angleDeg: 48,
      axis: point(0, 1, 0),
      depthMm: 6,
      curvatureDeg: 33,
      boneCoveragePct: 80,
      pathwayMm: 2.2,
      pathwayDir: point(0, 1, 0),
    });
    expect(withCanal).toHaveLength(8);
    expect(withCanal.map((item) => item.name)).toEqual([
      'Nerve proximity',
      'Impaction angulation',
      'Impaction depth',
      'Root morphology',
      'Surrounding bone coverage',
      'Adjacent second-molar proximity',
      'Extraction pathway clearance',
      'Anatomical complexity',
    ]);
    expect(withCanal[0]?.status).toBe('High');
    expect(withCanal[0]?.value).toBe('1.2 mm');
    expect(withCanal[7]?.status).toBe('High');
    const missing = extractionFactors({
      canalSegmented: false,
      nerve: null,
      neighbor: null,
      angleDeg: 10,
      axis: point(0, 1, 0),
      depthMm: 0,
      curvatureDeg: 4,
      boneCoveragePct: 20,
      pathwayMm: null,
      pathwayDir: point(0, 1, 0),
    });
    expect(missing[0]?.status).toBe('Unavailable');
    expect(missing[0]?.value).toBe('Not segmented');
    expect(missing[6]?.value).toBe('Not segmented');
  });
});
