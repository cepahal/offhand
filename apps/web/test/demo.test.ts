import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalog, hitlItems, patients, policies } from '../src/demo/data.js';
import {
  auditEntries,
  canAdvance,
  confirmEdit,
  emptyDraft,
  fieldState,
  onboardingComplete,
  proposeEdit,
  searchPatients,
} from '../src/demo/logic.js';
import type { OnboardingDraft } from '../src/demo/types.js';

const policiesOnDisk = JSON.parse(readFileSync(new URL('../../../config/demo/policies.json', import.meta.url), 'utf8')) as {
  policies: typeof policies;
  humanInTheLoop: typeof hitlItems;
};

function readyDraft(): OnboardingDraft {
  const hospital = catalog.hospitals[0];
  const site = hospital?.sites[0];
  const theatre = site?.theatres[0];
  if (!hospital || !site || !theatre) throw new Error('hospitals.json has no theatre');
  return {
    hospitalId: hospital.id,
    siteId: site.id,
    theatreId: theatre.id,
    policyIds: policies.filter((policy) => policy.required).map((policy) => policy.id),
    hitl: Object.fromEntries(hitlItems.map((item) => [item.id, true])),
  };
}

describe('onboarding', () => {
  it('cannot advance without the required choices', () => {
    const done = readyDraft();
    expect(onboardingComplete(done, catalog)).toBe(true);
    expect(canAdvance('hospital', emptyDraft(), catalog)).toBe(false);
    expect(canAdvance('location', { ...done, theatreId: null }, catalog)).toBe(false);
    expect(canAdvance('location', { ...done, siteId: catalog.hospitals[1]?.sites[0]?.id ?? 'missing' }, catalog)).toBe(false);

    const required = policies.filter((policy) => policy.required);
    expect(required.length).toBeGreaterThan(0);
    expect(canAdvance('policies', { ...done, policyIds: required.slice(1).map((policy) => policy.id) }, catalog)).toBe(false);
    expect(canAdvance('policies', { ...done, policyIds: policies.filter((policy) => !policy.required).map((policy) => policy.id) }, catalog)).toBe(false);

    const [first, ...rest] = hitlItems;
    expect(first).toBeTruthy();
    const hitl = Object.fromEntries(rest.map((item) => [item.id, true]));
    expect(canAdvance('hitl', { ...done, hitl }, catalog)).toBe(false);
    expect(canAdvance('review', { ...done, hitl }, catalog)).toBe(false);
  });

  it('loads policies from config/demo/policies.json', () => {
    expect(policies).toEqual(policiesOnDisk.policies);
    expect(hitlItems).toEqual(policiesOnDisk.humanInTheLoop);
    expect(policies.map((policy) => policy.name)).toEqual(
      expect.arrayContaining([
        'Clinician approves all patient messages',
        'Voice edits need confirmation',
        'Imaging reviewed by a clinician before use',
        'Patient data masked on shared screens',
      ]),
    );
    expect(hitlItems.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        'A surgeon confirms every patient message',
        'A nurse confirms every record change',
        'Scans are reviewed by a clinician before use',
        'Emergency paging stays under clinician control',
      ]),
    );
    for (const policy of policies) expect(policy.description).not.toContain('\n');
  });
});

describe('patient search', () => {
  it('finds Alex Wu by MRN or name', () => {
    expect(patients).toHaveLength(10);
    for (const query of ['123132', 'wu', 'WU', 'Alex Wu']) {
      const found = searchPatients(patients, query);
      expect(found.map((patient) => patient.mrn)).toEqual(['123132']);
    }
    const alex = searchPatients(patients, 'wu')[0];
    expect(alex?.name).toBe('Alex Wu');
    expect(alex?.age).toBe(47);
    expect(alex?.procedure).toBe('Left frontal craniotomy (tumour resection)');
    expect(alex?.allergies).toEqual(['Penicillin (rash)']);
    expect(alex?.history).toHaveLength(2);
    expect(alex?.studies.map((study) => study.sequence)).toEqual(['T1', 'T2-FLAIR', 'contrast T1']);
    expect(searchPatients(patients, 'nobody')).toEqual([]);
  });
});

describe('chart edits', () => {
  it('stays pending until confirmed, and only then reaches the audit log', () => {
    const saved = proposeEdit([], {
      id: 'edit-1',
      mrn: '123132',
      field: 'notes',
      before: 'original note',
      after: 'updated note',
      savedAt: '2026-11-12T00:00:00Z',
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.status).toBe('pending');
    expect(auditEntries(saved)).toEqual([]);
    expect(fieldState('original note', saved, '123132', 'notes')).toEqual({ official: 'original note', pending: saved[0] });

    const confirmed = confirmEdit(saved, 'edit-1', '2026-11-12T00:01:00Z');
    expect(confirmed[0]?.status).toBe('confirmed');
    expect(auditEntries(saved)).toEqual([]);
    expect(auditEntries(confirmed).map((edit) => edit.after)).toEqual(['updated note']);
    expect(fieldState('original note', confirmed, '123132', 'notes').official).toBe('updated note');
    expect(fieldState('original note', confirmed, '123132', 'notes').pending).toBeUndefined();
  });
});
