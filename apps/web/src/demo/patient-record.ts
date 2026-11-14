/**
 * One synthetic patient for the dental screen.
 * A prescription change is applied only when a clinician confirms a named medication.
 */
export type PatientRecord = {
  name: string;
  age: number;
  initialProblem: string;
  medicalHistory: string;
  allergies: string;
  prescription: string;
  diagnosis: string;
  treatment: string;
};

export type PrescriptionUpdate = { ok: boolean; reason?: string; record: PatientRecord };

export const PRESCRIPTION_CLOSE_MS = 3000;

export const SYNTHETIC_PATIENT: PatientRecord = {
  name: 'Alex Johnson',
  age: 34,
  initialProblem: 'Pain on chewing, lower left molar (36)',
  medicalHistory: 'Non-contributory',
  allergies: 'Penicillin',
  prescription: 'Ibuprofen 400 mg PO q6h PRN pain',
  diagnosis: 'Symptomatic irreversible pulpitis; symptomatic apical periodontitis, 36',
  treatment: 'Root canal treatment, 36',
};

/** The medication a clinician can confirm from the record window. It is not chosen by the model. */
export const CONFIRMED_PRESCRIPTION = 'Ibuprofen 600 mg PO q6h, 3 days';

const PENICILLIN_CLASS = /penicillin|amoxicillin|amoxycillin|ampicillin|augmentin|co-amoxiclav|dicloxacillin|flucloxacillin|piperacillin|pen vk/i;

/** A recorded allergy the medication belongs to, or null. Shown as a warning; never silent. */
export function allergyConflict(medication: string, allergies: string): string | null {
  if (/penicillin/i.test(allergies) && PENICILLIN_CLASS.test(medication)) return 'Penicillin';
  return null;
}

type PatientWindowController = {
  open: () => void;
  close: () => void;
  showCursor: () => Promise<void>;
  animateField: (next: string) => Promise<void>;
};

let record: PatientRecord = { ...SYNTHETIC_PATIENT };
let controller: PatientWindowController | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function readPatient(): PatientRecord {
  return { ...record };
}

export function resetSyntheticPatient(): void {
  record = { ...SYNTHETIC_PATIENT };
  running = false;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
}

export function bindPatientWindow(next: PatientWindowController | null): void {
  controller = next;
}

export function openPatientWindow(): void {
  controller?.open();
}

export function closePatientWindow(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  controller?.close();
}

export function showAICursor(): Promise<void> {
  return controller?.showCursor() ?? Promise.resolve();
}

export function animateFieldUpdate(next: string): Promise<void> {
  return controller?.animateField(next) ?? Promise.resolve();
}

function namedMedication(value: string): boolean {
  const text = value.trim();
  if (text.length < 3) return false;
  return !/\b(uncertain|unsure|unknown|unspecified)\b/i.test(text) && !/[?]/.test(text);
}

/** Open the record, play the cursor edit, and store the new prescription only after confirmation. */
export async function updatePrescription(value: string, confirmed = false): Promise<PrescriptionUpdate> {
  const next = value.trim();
  if (!confirmed) {
    return { ok: false, reason: 'A clinician has to confirm this prescription change.', record: readPatient() };
  }
  if (!namedMedication(next)) {
    return { ok: false, reason: 'No medication was named, so nothing was changed.', record: readPatient() };
  }
  if (running) {
    return { ok: false, reason: 'A prescription update is already running.', record: readPatient() };
  }
  running = true;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  try {
    openPatientWindow();
    await showAICursor();
    await animateFieldUpdate(next);
    record = { ...record, prescription: next };
    closeTimer = setTimeout(() => {
      closeTimer = null;
      controller?.close();
    }, PRESCRIPTION_CLOSE_MS);
    return { ok: true, record: readPatient() };
  } finally {
    running = false;
  }
}
