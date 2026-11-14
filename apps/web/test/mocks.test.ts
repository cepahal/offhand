import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CasePackManifest } from '@offhand/contracts';
import { buildMock, MOCKS, mockSource, MOCK_APP } from '../src/mocks/mockCases.js';

describe('frontend mocks', () => {
  it('covers the five brief areas', () => {
    expect(MOCKS.map((m) => m.caseId).sort()).toEqual(['acl', 'concussion', 'knee', 'shoulder', 'tmj']);
    expect(mockSource.list()).toHaveLength(5);
    expect(mockSource.app).toBe(MOCK_APP);
  });

  for (const def of MOCKS) {
    describe(def.caseId, () => {
      const c = buildMock(def.caseId);

      it('is clearly labelled as a mock', () => {
        expect(c.manifest.title).toMatch(/MOCK/);
        expect(c.manifest.title).toMatch(/not anatomy/);
        expect(c.manifest.source.dataset).toMatch(/mock/);
        expect(c.manifest.source.subjectId).toBe('none');
        expect(c.note).toBeTruthy();
      });

      it('has a manifest that passes the shared contract', () => {
        const r = CasePackManifest.safeParse(c.manifest);
        expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      });

      it('supplies one in-memory object per layer, outer to inner', () => {
        const ids = c.manifest.layers.map((l) => l.id);
        expect(Object.keys(c.objects ?? {}).sort()).toEqual([...ids].sort());
        const peel = c.manifest.layers.map((l) => l.peelOrder);
        expect(peel).toEqual([...peel].sort((a, b) => a - b));
        expect(new Set(peel).size).toBeGreaterThanOrEqual(3); // something to peel
        // The innermost layer is opaque so peeling ends on something solid.
        expect(c.manifest.layers.at(-1)?.defaultOpacity).toBe(1);
      });

      it('targets point at real layers and sit inside the model bounds', () => {
        const box = new THREE.Box3();
        for (const o of Object.values(c.objects ?? {})) {
          o.updateMatrixWorld(true);
          box.expandByObject(o);
        }
        for (const f of c.manifest.findings) {
          expect(c.manifest.layers.some((l) => l.id === f.layerId)).toBe(true);
          expect(box.containsPoint(new THREE.Vector3(...f.center))).toBe(true);
        }
      });
    });
  }

  it('TMJ scrub opens the hinge (moves the arm down) and closes it again', () => {
    const c = buildMock('tmj');
    expect(c.app.scrub.target).toBe('motion');
    const hard = c.objects?.hard as THREE.Object3D;
    const lowestZ = (): number => {
      hard.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(hard).min.z;
    };
    c.onScrub?.(0);
    const closed = lowestZ();
    c.onScrub?.(1);
    const open = lowestZ();
    c.onScrub?.(0);
    expect(open).toBeLessThan(closed - 10);
    expect(lowestZ()).toBeCloseTo(closed, 5);
  });

  it('rejects unknown mock names', () => {
    expect(() => buildMock('elbow')).toThrow(/no mock named/);
  });
});
