import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanCasepacks } from '../src/casepacks/scan.js';

const root = mkdtempSync(join(tmpdir(), 'offhand-cp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const manifest = (app: string, caseId: string, extra: Record<string, unknown> = {}) => ({
  schema: 1,
  app,
  caseId,
  title: 'Scan test',
  source: { dataset: 'unit test', url: 'n/a', license: 'n/a', citation: 'n/a', subjectId: 'n/a' },
  deidentified: true,
  coordinateSystem: 'RAS',
  units: 'mm',
  layers: [
    { id: 'a', label: 'A', file: 'a.glb', color: '#ff0000', defaultOpacity: 1, peelOrder: 0, kind: 'surface' },
  ],
  volumes: [],
  findings: [],
  share: { templateId: 't', pollOptions: [] },
  policyId: 'p',
  ...extra,
});

const writeCase = (app: string, caseId: string, m: unknown, files: string[] = ['a.glb']) => {
  const dir = join(root, app, caseId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  for (const f of files) writeFileSync(join(dir, f), 'x');
};

writeCase('demo', 'ok-1', manifest('demo', 'ok-1'));
writeCase('demo', 'missing-file', manifest('demo', 'missing-file'), []);
writeCase('demo', 'wrong-folder', manifest('demo', 'other'));
writeCase('demo', 'bad-finding', manifest('demo', 'bad-finding', {
  findings: [{ id: 'f', label: 'x', layerId: 'nope', center: [0, 0, 0], radiusMm: 1, provenance: 'measured' }],
}));
writeCase('demo', 'not-ras', { ...manifest('demo', 'not-ras'), coordinateSystem: 'LPS' });
mkdirSync(join(root, 'demo', 'no-manifest'), { recursive: true });

describe('scanCasepacks', () => {
  const r = scanCasepacks(root);
  const bad = Object.fromEntries(r.invalid.map((i) => [i.path, i.errors.join(' | ')]));

  it('serves valid packs only', () => {
    expect([...r.cases.keys()]).toEqual(['demo/ok-1']);
    expect(r.cases.get('demo/ok-1')?.summary).toMatchObject({ layers: 1, baseUrl: '/casepacks/demo/ok-1/' });
  });
  it('explains why each invalid pack was rejected', () => {
    expect(bad['demo/missing-file']).toMatch(/missing file: a\.glb/);
    expect(bad['demo/wrong-folder']).toMatch(/caseId "other" != folder "wrong-folder"/);
    expect(bad['demo/bad-finding']).toMatch(/unknown layerId nope/);
    expect(bad['demo/not-ras']).toMatch(/coordinateSystem/);
    expect(bad['demo/no-manifest']).toMatch(/manifest\.json missing/);
  });
  it('handles a missing root', () => {
    expect(scanCasepacks(join(root, 'nope')).cases.size).toBe(0);
  });
});
