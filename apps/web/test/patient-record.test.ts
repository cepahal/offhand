import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindPatientWindow,
  closePatientWindow,
  CONFIRMED_PRESCRIPTION,
  openPatientWindow,
  PRESCRIPTION_CLOSE_MS,
  readPatient,
  resetSyntheticPatient,
  SYNTHETIC_PATIENT,
  updatePrescription,
  allergyConflict,
} from '../src/demo/patient-record.js';

afterEach(() => {
  bindPatientWindow(null);
  resetSyntheticPatient();
  vi.useRealTimers();
});

describe('patient record', () => {
  it('flags a penicillin-class drug for a penicillin-allergic patient and passes the confirmed one', () => {
    expect(allergyConflict('Amoxicillin 500 mg', 'Penicillin')).toBe('Penicillin');
    expect(allergyConflict(CONFIRMED_PRESCRIPTION, SYNTHETIC_PATIENT.allergies)).toBeNull();
    expect(allergyConflict('Amoxicillin 500 mg', 'None')).toBeNull();
  });

  it('keeps the synthetic chart and refuses an unconfirmed or unnamed change', async () => {
    expect(readPatient()).toEqual(SYNTHETIC_PATIENT);
    const refused = await updatePrescription(CONFIRMED_PRESCRIPTION, false);
    const unnamed = await updatePrescription('uncertain', true);
    expect(refused.ok).toBe(false);
    expect(unnamed.ok).toBe(false);
    expect(readPatient().prescription).toBe(SYNTHETIC_PATIENT.prescription);
  });

  it('updates only after confirmation, then closes the window', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    bindPatientWindow({
      open: () => seen.push('open'),
      close: () => seen.push('close'),
      showCursor: () => { seen.push('cursor'); return Promise.resolve(); },
      animateField: () => { seen.push('animate'); return Promise.resolve(); },
    });
    const result = await updatePrescription(CONFIRMED_PRESCRIPTION, true);
    expect(result.ok).toBe(true);
    expect(readPatient().prescription).toBe(CONFIRMED_PRESCRIPTION);
    expect(seen).toEqual(['open', 'cursor', 'animate']);
    await vi.advanceTimersByTimeAsync(PRESCRIPTION_CLOSE_MS);
    expect(seen.at(-1)).toBe('close');
    closePatientWindow();
    expect(readPatient().prescription).toBe(CONFIRMED_PRESCRIPTION);
  });

  it('opens and closes without changing the record', () => {
    const seen: string[] = [];
    bindPatientWindow({
      open: () => seen.push('open'),
      close: () => seen.push('close'),
      showCursor: () => Promise.resolve(),
      animateField: () => Promise.resolve(),
    });
    openPatientWindow();
    closePatientWindow();
    expect(seen).toEqual(['open', 'close']);
    expect(readPatient().prescription).toBe(SYNTHETIC_PATIENT.prescription);
  });
});
