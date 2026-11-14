/**
 * Applies a parsed command. Edits and message drafts stay unconfirmed until a later "confirm".
 * Emergency paging is a local log and a toast. Nothing is contacted.
 */
import { hospitalUpdateText, prescriptionText } from '../../../hub/src/messaging/demo-messages.js';
import { baseFieldText, confirmEdit, discardEdit, fieldState, proposeEdit } from './logic.js';
import { hospitalNotesText, makeNote, type ScanContext, type ScanNote } from './scan-notes.js';
import { MRI_PLACEHOLDER } from './scanner-commands.js';
import { viewerCommand, type DemoViewerCommand } from './viewer-commands.js';
import { CONFIRM_TO_SAVE, EMERGENCY_TEXT, RECIPIENT_QUESTION, parseUtterance, type VoiceIntent } from './voice-intent.js';
import type { ChartEdit, DemoPatient } from './types.js';

export interface MessageDraft {
  id: string;
  kind: 'prescription' | 'hospital_update' | 'hospital_notes';
  mrn: string;
  patientName: string;
  body: string;
  status: 'draft' | 'confirmed';
}

export interface VoiceLogEntry {
  at: string;
  heard: string;
  doing: string;
  kind: 'info' | 'emergency';
}

export interface PendingVoice {
  kind: 'edit' | 'message';
  id: string;
}

export interface VoiceMemory {
  edits: ChartEdit[];
  drafts: MessageDraft[];
  pending: PendingVoice | null;
  log: VoiceLogEntry[];
}

export interface VoiceOutcome {
  memory: VoiceMemory;
  heard: string;
  doing: string;
  say: string;
  navigate: string | null;
  toast: string | null;
  viewerEvent: DemoViewerCommand | null;
  intent: VoiceIntent;
  note: ScanNote | null;
}

export function emptyVoiceMemory(): VoiceMemory {
  return { edits: [], drafts: [], pending: null, log: [] };
}

function draftBody(kind: MessageDraft['kind'], patient: DemoPatient, theatreName: string): string {
  if (kind === 'prescription') return prescriptionText(patient);
  if (kind === 'hospital_notes') return '';
  return hospitalUpdateText(patient, theatreName);
}

function needPatient(memory: VoiceMemory, heard: string, now: string): VoiceOutcome {
  const say = 'Open a patient first.';
  return finish(memory, heard, say, say, null, null, null, { type: 'unknown' }, now, 'info');
}

function finish(
  memory: VoiceMemory,
  heard: string,
  doing: string,
  say: string,
  navigate: string | null,
  toast: string | null,
  viewerEvent: DemoViewerCommand | null,
  intent: VoiceIntent,
  now: string,
  kind: VoiceLogEntry['kind'],
  note: ScanNote | null = null,
): VoiceOutcome {
  return {
    memory: { ...memory, log: [...memory.log, { at: now, heard: heard.trim(), doing, kind }] },
    heard: heard.trim(),
    doing,
    say,
    navigate,
    toast,
    viewerEvent,
    intent,
    note,
  };
}

/** Drop the previous unconfirmed voice action so confirm cannot apply to the wrong one. */
function clearPending(memory: VoiceMemory): VoiceMemory {
  const pending = memory.pending;
  if (!pending) return memory;
  if (pending.kind === 'edit') return { ...memory, edits: discardEdit(memory.edits, pending.id), pending: null };
  return { ...memory, drafts: memory.drafts.filter((draft) => !(draft.id === pending.id && draft.status === 'draft')), pending: null };
}

export function handleUtterance(
  text: string,
  memory: VoiceMemory,
  patients: readonly DemoPatient[],
  currentMrn: string | null,
  now: string,
  id: string,
  theatreName = 'the scheduled theatre',
  scan: ScanContext = { notes: [], pointer: null, volumeLoaded: false },
): VoiceOutcome {
  const parsed = parseUtterance(text, patients);
  const patient = currentMrn ? patients.find((item) => item.mrn === currentMrn) : undefined;

  if (
    parsed.intent.type === 'propose_edit' ||
    parsed.intent.type === 'open_draft' ||
    parsed.intent.type === 'open_mri' ||
    parsed.intent.type === 'show_finding' ||
    parsed.intent.type === 'show_scans' ||
    parsed.intent.type === 'nudge_slice' ||
    parsed.intent.type === 'place_note' ||
    parsed.intent.type === 'send_notes'
  ) {
    if (!patient) return needPatient(memory, text, now);
  }

  if (parsed.intent.type === 'open_patient') {
    return finish(memory, text, parsed.doing, parsed.say, `/demo/app/patient/${parsed.intent.mrn}`, null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'open_mri' && patient) {
    const doing = `Opening MRI scans for ${patient.name}.`;
    return finish(memory, text, doing, 'Opening MRI scans.', `/demo/app/imaging?patient=${patient.mrn}`, null, viewerCommand('open_mri', patient), parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'show_finding' && patient) {
    const command = viewerCommand('show_region', patient);
    const say = command?.type === 'show_region' ? `Showing the ${command.label}.` : parsed.say;
    return finish(memory, text, say, say, null, null, command, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'show_scans' && patient) {
    const command = viewerCommand('step_scans', patient);
    const say = command ? 'Stepping through the scans.' : 'No MRI scans are on file.';
    return finish(memory, text, say, say, null, null, command, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'nudge_slice' && patient) {
    const say = parsed.intent.delta > 0 ? 'Next slice.' : 'Previous slice.';
    return finish(memory, text, say, say, null, null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'place_note' && patient) {
    if (!scan.volumeLoaded || !scan.pointer) {
      const say = scan.volumeLoaded ? 'Click the slice, then mark the area.' : MRI_PLACEHOLDER;
      return finish(memory, text, say, say, null, null, null, parsed.intent, now, 'info');
    }
    const note = makeNote(scan.pointer, parsed.intent.category, parsed.intent.text, patient.mrn, now);
    const say = `Noted on slice ${note.sliceIndex}.`;
    return finish(memory, text, say, say, null, null, null, parsed.intent, now, 'info', note);
  }

  if (parsed.intent.type === 'send_notes' && patient) {
    if (scan.notes.length === 0) {
      const say = 'There are no notes to send.';
      return finish(memory, text, say, say, null, null, null, parsed.intent, now, 'info');
    }
    const body = hospitalNotesText(patient.mrn, scan.notes);
    const cleared = clearPending(memory);
    const draft: MessageDraft = {
      id,
      kind: 'hospital_notes',
      mrn: patient.mrn,
      patientName: `MRN ${patient.mrn}`,
      body,
      status: 'draft',
    };
    const next: VoiceMemory = { ...cleared, drafts: [...cleared.drafts, draft], pending: { kind: 'message', id } };
    return finish(next, text, `${body}\n${CONFIRM_TO_SAVE}`, CONFIRM_TO_SAVE, '/demo/app/messages', null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'propose_edit' && patient) {
    const base = memory.edits;
    const cleared = clearPending({ ...memory, edits: base });
    const before = fieldState(baseFieldText(patient, parsed.intent.field), cleared.edits, patient.mrn, parsed.intent.field).official;
    const edits = proposeEdit(cleared.edits, {
      id,
      mrn: patient.mrn,
      field: parsed.intent.field,
      before,
      after: parsed.intent.value,
      savedAt: now,
    });
    const next: VoiceMemory = { ...cleared, edits, pending: { kind: 'edit', id } };
    return finish(next, text, parsed.doing, CONFIRM_TO_SAVE, '/demo/app/messages', null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'ask_recipient') {
    return finish(memory, text, RECIPIENT_QUESTION, RECIPIENT_QUESTION, null, null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'open_draft' && patient) {
    const cleared = clearPending(memory);
    const draft: MessageDraft = {
      id,
      kind: parsed.intent.draft,
      mrn: patient.mrn,
      patientName: patient.name,
      body: draftBody(parsed.intent.draft, patient, theatreName),
      status: 'draft',
    };
    const next: VoiceMemory = { ...cleared, drafts: [...cleared.drafts, draft], pending: { kind: 'message', id } };
    return finish(next, text, parsed.doing, CONFIRM_TO_SAVE, '/demo/app/messages', null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'confirm') {
    const pending = memory.pending;
    const edit = pending?.kind === 'edit' ? memory.edits.find((item) => item.id === pending.id && item.status === 'pending') : undefined;
    if (edit) {
      const next: VoiceMemory = { ...memory, edits: confirmEdit(memory.edits, edit.id, now), pending: null };
      return finish(next, text, 'Saved the pending edit.', 'Saved.', null, null, null, parsed.intent, now, 'info');
    }
    const draft = pending?.kind === 'message' ? memory.drafts.find((item) => item.id === pending.id && item.status === 'draft') : undefined;
    if (draft) {
      const drafts = memory.drafts.map((item) => (item.id === draft.id ? { ...item, status: 'confirmed' as const } : item));
      const say = 'Confirmed. Nothing was sent outside this demonstration.';
      return finish({ ...memory, drafts, pending: null }, text, say, say, '/demo/app/messages', null, null, parsed.intent, now, 'info');
    }
    const say = 'There is nothing to confirm.';
    return finish(memory, text, say, say, null, null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'cancel') {
    if (!memory.pending) {
      const say = 'There is nothing to cancel.';
      return finish(memory, text, say, say, null, null, null, parsed.intent, now, 'info');
    }
    const say = memory.pending.kind === 'message' ? 'Cancelled. Nothing was sent.' : 'Cancelled. Nothing was saved.';
    return finish(clearPending(memory), text, say, say, null, null, null, parsed.intent, now, 'info');
  }

  if (parsed.intent.type === 'emergency') {
    return finish(memory, text, EMERGENCY_TEXT, EMERGENCY_TEXT, null, EMERGENCY_TEXT, null, parsed.intent, now, 'emergency');
  }

  return finish(memory, text, parsed.doing, parsed.say, null, null, null, parsed.intent, now, 'info');
}
