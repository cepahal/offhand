import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { dentalCase, DENTAL_TRAININGS } from '../src/demo/dental-anatomy.js';
import { layerRole } from '../src/viewer/palette.js';

describe('synthetic dental training cases', () => {
  it('loads five distinguishable cases, each with one yellow region', () => {
    const centres = DENTAL_TRAININGS.map((item) => item.highlight.rasMm.join(','));
    expect(new Set(centres).size).toBe(5);
    for (const item of DENTAL_TRAININGS) {
      const loaded = dentalCase(item.n);
      const highlighted = loaded.manifest.layers.filter((layer) => layerRole(layer.label, layer.id) === 'highlight');
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0]!.color).toBe('#f5d33b');
      const mesh = loaded.objects?.[highlighted[0]!.id] as THREE.Object3D;
      expect(mesh.name).toBe(item.highlight.mesh);
      const text = JSON.stringify(loaded.manifest.layers.map((layer) => `${layer.id} ${layer.label}`));
      expect(text.toLowerCase()).not.toMatch(/brain|cortex|flair|ventricle/);
      expect(loaded.manifest.source.dataset).toMatch(/synthetic/i);
      expect(loaded.manifest.volumes).toEqual([]);
    }
  });

  it('places each highlight on the anatomy that case describes', () => {
    const byN = Object.fromEntries(DENTAL_TRAININGS.map((item) => [item.n, item.highlight]));
    expect(byN[1]!.mesh).toBe('tmj-disc-right');
    expect(byN[1]!.rasMm[0]).toBeGreaterThan(20);
    expect(byN[2]!.mesh).toBe('tmj-condyle-left');
    expect(byN[2]!.rasMm[0]).toBeLessThan(-20);
    expect(byN[3]!.fdi).toBe('36');
    expect(byN[3]!.rasMm[0]).toBeLessThan(0);
    expect(byN[3]!.rasMm[2]).toBeLessThan(0);
    expect(byN[4]!.fdi).toBe('11');
    expect(byN[4]!.rasMm[1]).toBeGreaterThan(8);
    expect(byN[4]!.rasMm[2]).toBeGreaterThan(8);
    expect(byN[5]!.fdi).toBe('48');
    expect(byN[5]!.rasMm[0]).toBeGreaterThan(10);
    const tooth36 = dentalCase(3);
    const shell = tooth36.manifest.layers.find((layer) => layer.id === 'shell-36');
    expect(shell?.defaultOpacity).toBeLessThan(0.5);
    const enamel = tooth36.objects?.enamel as THREE.Group;
    expect(enamel.children.some((child) => child.name === 'fdi-36')).toBe(false);
    const tooth48 = dentalCase(5).objects?.enamel as THREE.Group;
    expect(tooth48.children.some((child) => child.name === 'fdi-48')).toBe(false);
    const lathe = (dentalCase(1).objects?.enamel as THREE.Group).children[0] as THREE.Mesh;
    expect(lathe.geometry.type).toBe('LatheGeometry');
  });
});
