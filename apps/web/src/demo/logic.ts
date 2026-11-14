/**
 * Rules for the browser demo. The onboarding screen, the patient search and the chart editor
 * call these functions, and the tests call the same ones.
 */
import type {
  Catalog,
  ChartEdit,
  ChartField,
  DemoPatient,
  Hospital,
  OnboardingDraft,
  OnboardingStep,
  Site,
  Theatre,
} from './types.js';

export const DEMO_DATA_LABEL = 'Demonstration data, not a real patient.';
export const DEMO_SOFTWARE_BANNER = 'Demonstration software, mock data';

/** The demonstration opens here. There is no setup screen. */
export const DEMO_PLACE = { hospitalId: 'northbank', siteId: 'riverside', theatreId: 'nb-t5' } as const;
export const PENDING_LABEL = 'Pending confirmation';
export const SIGNED_IN_SURGEON = 'Dr. M. Hale (demo)';

export const ONBOARDING_STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'hospital', label: 'Hospital' },
  { id: 'location', label: 'Location' },
  { id: 'policies', label: 'Policies' },
  { id: 'hitl', label: 'Human in the loop' },
  { id: 'review', label: 'Review' },
];

export function emptyDraft(): OnboardingDraft {
  return { hospitalId: null, siteId: null, theatreId: null, policyIds: [], hitl: {} };
}

export function hospitalById(hospitals: Hospital[], id: string | null): Hospital | undefined {
  return id ? hospitals.find((h) => h.id === id) : undefined;
}

export function siteById(hospital: Hospital | undefined, id: string | null): Site | undefined {
  return id ? hospital?.sites.find((s) => s.id === id) : undefined;
}

export function theatreById(site: Site | undefined, id: string | null): Theatre | undefined {
  return id ? site?.theatres.find((t) => t.id === id) : undefined;
}

/** Next stays disabled until this step's required choices are present. */
export function canAdvance(step: OnboardingStep, draft: OnboardingDraft, catalog: Catalog): boolean {
  if (step === 'hospital') return hospitalById(catalog.hospitals, draft.hospitalId) !== undefined;
  if (step === 'location') {
    const site = siteById(hospitalById(catalog.hospitals, draft.hospitalId), draft.siteId);
    return theatreById(site, draft.theatreId) !== undefined;
  }
  if (step === 'policies') {
    const required = catalog.policies.filter((p) => p.required);
    return required.length > 0 && required.every((p) => draft.policyIds.includes(p.id));
  }
  if (step === 'hitl') return catalog.hitl.length > 0 && catalog.hitl.every((item) => draft.hitl[item.id] === true);
  return (['hospital', 'location', 'policies', 'hitl'] as const).every((s) => canAdvance(s, draft, catalog));
}

export function onboardingComplete(draft: OnboardingDraft, catalog: Catalog): boolean {
  return canAdvance('review', draft, catalog);
}

export function selectHospital(draft: OnboardingDraft, hospitalId: string): OnboardingDraft {
  if (draft.hospitalId === hospitalId) return draft;
  return { ...draft, hospitalId, siteId: null, theatreId: null };
}

export function selectSite(draft: OnboardingDraft, siteId: string): OnboardingDraft {
  if (draft.siteId === siteId) return draft;
  return { ...draft, siteId, theatreId: null };
}

export function togglePolicy(draft: OnboardingDraft, policyId: string): OnboardingDraft {
  const policyIds = draft.policyIds.includes(policyId)
    ? draft.policyIds.filter((id) => id !== policyId)
    : [...draft.policyIds, policyId];
  return { ...draft, policyIds };
}

export function toggleHitl(draft: OnboardingDraft, id: string): OnboardingDraft {
  return { ...draft, hitl: { ...draft.hitl, [id]: !draft.hitl[id] } };
}

export function searchPatients(list: readonly DemoPatient[], query: string): DemoPatient[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((p) => p.name.toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q));
}

export function allergiesText(patient: DemoPatient): string {
  return patient.allergies.join('\n');
}

export function medicationsText(patient: DemoPatient): string {
  return patient.medications.join('\n');
}

export function historyText(patient: DemoPatient): string {
  return patient.history.map((h) => `${h.date} — ${h.text}`).join('\n');
}

export function baseFieldText(patient: DemoPatient, field: ChartField): string {
  if (field === 'procedure') return patient.procedure;
  if (field === 'allergies') return allergiesText(patient);
  if (field === 'medications') return medicationsText(patient);
  if (field === 'history') return historyText(patient);
  return patient.notes;
}

/** The official value stays as it was until a pending edit is confirmed. */
export function fieldState(
  base: string,
  edits: readonly ChartEdit[],
  mrn: string,
  field: ChartField,
): { official: string; pending: ChartEdit | undefined } {
  const mine = edits.filter((e) => e.mrn === mrn && e.field === field);
  const confirmed = mine.filter((e) => e.status === 'confirmed');
  const last = confirmed[confirmed.length - 1];
  return { official: last ? last.after : base, pending: mine.find((e) => e.status === 'pending') };
}

/** Saving a field records a pending edit and does not write the audit log. */
export function proposeEdit(edits: readonly ChartEdit[], edit: Omit<ChartEdit, 'status' | 'confirmedAt'>): ChartEdit[] {
  const pending: ChartEdit = { ...edit, status: 'pending' };
  const rest = edits.filter((e) => !(e.mrn === edit.mrn && e.field === edit.field && e.status === 'pending'));
  return [...rest, pending];
}

export function confirmEdit(edits: readonly ChartEdit[], id: string, confirmedAt: string): ChartEdit[] {
  return edits.map((e) => (e.id === id && e.status === 'pending' ? { ...e, status: 'confirmed', confirmedAt } : e));
}

export function discardEdit(edits: readonly ChartEdit[], id: string): ChartEdit[] {
  return edits.filter((e) => !(e.id === id && e.status === 'pending'));
}

/** The audit log is confirmed edits only. */
export function auditEntries(edits: readonly ChartEdit[]): ChartEdit[] {
  return edits.filter((e) => e.status === 'confirmed');
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatScheduled(iso: string): string {
  const [date, time] = iso.split('T');
  if (!date) return iso;
  return time ? `${date} ${time.slice(0, 5)}` : date;
}

export const FIELD_LABELS: Record<ChartField, string> = {
  procedure: 'Procedure',
  allergies: 'Allergies',
  medications: 'Medications',
  history: 'History',
  notes: 'Notes',
};
