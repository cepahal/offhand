/**
 * Scanner screen state. A page load always starts from the defaults.
 * Nothing is written or sent until confirm.
 */
import type { DemoPatient } from './types.js';
import type { IntentHit } from './intent-model.js';
import { DIDNT_UNDERSTAND } from './intent-model.js';
import { MRI_PLACEHOLDER } from './scanner-commands.js';
import { matchPatients } from './voice-intent.js';
import type { ScanNote } from './scan-notes.js';
import { CONFIDENCE_MIN } from './gesture-gate.js';

export interface ScannerView {
  zoom: number;
  yaw: number;
  pitch: number;
  peel: number;
  slice: number;
  scrub: number;
  notesShown: boolean;
}

export interface PendingChange {
  kind: 'medication' | 'procedure' | 'instructions';
  mrn: string;
  name: string;
  before: string;
  after: string;
  hospitalCopy: boolean;
}

export interface Outbound {
  mrn: string;
  kind: 'patient' | 'hospital-copy';
  body: string;
}

export interface ScannerSession {
  view: ScannerView;
  mrn: string;
  pending: PendingChange | null;
  table: { title: string; rows: string[] } | null;
  comparison: { before: string[]; after: string[] } | null;
  notes: ScanNote[];
  sent: Outbound[];
  say: string;
  fade: 'in' | 'out';
}

export function freshView(): ScannerView {
  return { zoom: 1, yaw: 0, pitch: 0, peel: 0, slice: 0, scrub: 0, notesShown: false };
}

/** Saved settings are ignored. Every load starts clean. */
export function viewOnLoad(_saved: unknown): ScannerView {
  return freshView();
}

export function freshSession(patients: readonly DemoPatient[]): ScannerSession {
  const first = patients[0];
  return {
    view: freshView(),
    mrn: first?.mrn ?? '',
    pending: null,
    table: null,
    comparison: null,
    notes: [],
    sent: [],
    say: '',
    fade: 'in',
  };
}

function patientOf(patients: readonly DemoPatient[], hit: IntentHit): DemoPatient | null {
  const hits = matchPatients(hit.person, patients);
  return hits.length === 1 ? hits[0]! : null;
}

export function applyIntent(session: ScannerSession, hit: IntentHit, patients: readonly DemoPatient[]): ScannerSession {
  if (hit.intent === 'unknown') return { ...session, say: DIDNT_UNDERSTAND };
  if (hit.intent === 'cancel') return { ...session, pending: null, say: 'Cancelled.' };
  if (hit.intent === 'confirm') return confirm(session);
  if (hit.intent === 'compare') {
    if (!session.pending) return { ...session, say: 'Nothing to compare yet.' };
    return {
      ...session,
      comparison: { before: [session.pending.before], after: [session.pending.after] },
      say: 'Showing the original and the new value.',
    };
  }
  if (hit.intent === 'view_history' || hit.intent === 'view_mri') {
    const patient = patientOf(patients, hit);
    if (!patient) return { ...session, say: DIDNT_UNDERSTAND };
    if (hit.intent === 'view_history') {
      return {
        ...session,
        table: { title: `${patient.name}`, rows: [...patient.allergies, ...patient.history.map((row) => row.text)] },
        say: `Showing allergies and history.`,
      };
    }
    return { ...session, mrn: patient.mrn, fade: 'out', table: null, say: `Showing the latest scan.` };
  }
  if (hit.intent === 'place_note') {
    if (!hit.value) return { ...session, say: DIDNT_UNDERSTAND };
    return { ...session, say: hit.value, view: { ...session.view, notesShown: true } };
  }
  if (hit.intent === 'change_medication' || hit.intent === 'change_procedure') {
    const patient = patientOf(patients, hit);
    if (!patient || !hit.value) return { ...session, say: DIDNT_UNDERSTAND };
    const kind = hit.intent === 'change_medication' ? 'medication' : 'procedure';
    const before = kind === 'medication' ? patient.medications.join('; ') : patient.procedure;
    return {
      ...session,
      pending: { kind, mrn: patient.mrn, name: patient.name, before, after: hit.value, hospitalCopy: true },
      say: 'Pending change. Confirm to save.',
    };
  }
  if (hit.intent === 'send_instructions') {
    const patient = patients.find((item) => item.mrn === session.mrn);
    if (!patient || !hit.value) return { ...session, say: DIDNT_UNDERSTAND };
    return {
      ...session,
      pending: { kind: 'instructions', mrn: patient.mrn, name: patient.name, before: '', after: hit.value, hospitalCopy: true },
      say: 'Draft ready. Confirm to send.',
    };
  }
  return { ...session, say: DIDNT_UNDERSTAND };
}

export function placeNote(session: ScannerSession, note: ScanNote): ScannerSession {
  return { ...session, notes: [...session.notes, note], view: { ...session.view, notesShown: true } };
}

export function deleteNote(session: ScannerSession, at: string): ScannerSession {
  return { ...session, notes: session.notes.filter((note) => note.at !== at) };
}

export function confirm(session: ScannerSession): ScannerSession {
  const pending = session.pending;
  if (!pending) return { ...session, say: 'Nothing is waiting for confirm.' };
  const sent: Outbound[] = [];
  if (pending.kind === 'instructions') {
    sent.push({ mrn: pending.mrn, kind: 'patient', body: `MRN ${pending.mrn}: ${pending.after}` });
  }
  if (pending.hospitalCopy) sent.push({ mrn: pending.mrn, kind: 'hospital-copy', body: `MRN ${pending.mrn}` });
  return { ...session, pending: null, sent: [...session.sent, ...sent], say: 'Saved.' };
}

export function fadeIn(session: ScannerSession): ScannerSession {
  return { ...session, fade: 'in' };
}

export type MotionName = 'left' | 'right' | 'up' | 'down' | 'forward' | 'backward' | 'cw' | 'ccw' | 'wave' | 'hold';

/** One small step. A score under the threshold leaves the view where it is. Listening is unchanged. */
export function moveView(view: ScannerView, gesture: MotionName, confidence: number, listening: boolean): { view: ScannerView; listening: boolean } {
  if (confidence < CONFIDENCE_MIN || gesture === 'wave' || gesture === 'hold') return { view, listening };
  const next = { ...view };
  if (gesture === 'left') next.yaw -= 10;
  if (gesture === 'right') next.yaw += 10;
  if (gesture === 'up') next.pitch += 8;
  if (gesture === 'down') next.pitch -= 8;
  if (gesture === 'forward') next.zoom = Math.round(next.zoom * 1.08 * 1000) / 1000;
  if (gesture === 'backward') next.zoom = Math.round((next.zoom / 1.08) * 1000) / 1000;
  if (gesture === 'cw') next.peel += 1;
  if (gesture === 'ccw') next.peel = Math.max(0, next.peel - 1);
  return { view: next, listening };
}

export function scanCaption(hasVolume: boolean, caseId: string): string {
  return hasVolume ? `NeuroView case ${caseId}` : MRI_PLACEHOLDER;
}
