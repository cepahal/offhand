/**
 * Rule-based commands for the demonstration chart. No model and no network.
 * A name matches only when one patient fits. A name and an MRN that disagree match nobody.
 */
import { phraseCommand, type PlaceNoteCommand, type NudgeSliceCommand } from './scanner-commands.js';
import type { ChartField, DemoPatient } from './types.js';

export const UNKNOWN_SAY = "I didn't catch that. Try: open Alex Wu, open MRI scans, or change allergy to ...";
export const CONFIRM_TO_SAVE = 'Say confirm to save.';
export const EMERGENCY_TEXT = 'Emergency team paged. Assistant on the way. ETA 2 minutes.';
export const RECIPIENT_QUESTION = 'Send to the patient or the hospital inbox?';
export const VIEWER_EVENT_NAME = 'hoverscan:demo-viewer';

export type VoiceIntent =
  | { type: 'open_patient'; mrn: string; name: string }
  | { type: 'refuse'; reason: 'mismatch' | 'ambiguous' }
  | { type: 'open_mri' }
  | { type: 'show_finding'; target: 'tumour' | 'lesion' }
  | { type: 'show_scans' }
  | { type: 'propose_edit'; field: ChartField; value: string }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'open_draft'; draft: 'prescription' | 'hospital_update' }
  | { type: 'send_notes' }
  | NudgeSliceCommand
  | PlaceNoteCommand
  | { type: 'ask_recipient' }
  | { type: 'emergency' }
  | { type: 'unknown' };

export interface ParsedUtterance {
  heard: string;
  intent: VoiceIntent;
  doing: string;
  say: string;
}

const FIELD_WORDS: Record<string, ChartField> = {
  allergy: 'allergies',
  allergies: 'allergies',
  medication: 'medications',
  medications: 'medications',
  meds: 'medications',
  note: 'notes',
  notes: 'notes',
  history: 'history',
  procedure: 'procedure',
};

export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.?!]+$/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidy(text: string): string {
  return text.trim().replace(/[.?!]+$/g, '').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = next;
  }
  return prev[b.length] ?? 0;
}

function tokenMatches(query: string, nameToken: string): boolean {
  if (query === nameToken) return true;
  if (query.length < 2 || nameToken.length < 2) return false;
  const distance = levenshtein(query, nameToken);
  if (distance <= 1) return true;
  // Short names such as "Wu" still match a one-syllable miss ("woo") without loosening longer names.
  const short = Math.min(query.length, nameToken.length);
  const long = Math.max(query.length, nameToken.length);
  return short <= 3 && long <= 4 && distance <= 2;
}

/** Every word of the query must match a word of the name. One letter off is allowed ("woo" / "wu"). */
export function matchPatients(query: string, patients: readonly DemoPatient[]): DemoPatient[] {
  const tokens = normalizePhrase(query).split(' ').filter((token) => token.length > 0);
  if (tokens.length === 0) return [];
  return patients.filter((patient) => {
    const nameTokens = normalizePhrase(patient.name).split(' ');
    return tokens.every((token) => nameTokens.some((nameToken) => tokenMatches(token, nameToken)));
  });
}

function heard(text: string, intent: VoiceIntent, doing: string, say: string): ParsedUtterance {
  return { heard: text.trim(), intent, doing, say };
}

function unknown(text: string): ParsedUtterance {
  return heard(text, { type: 'unknown' }, UNKNOWN_SAY, UNKNOWN_SAY);
}

export function parseUtterance(text: string, patients: readonly DemoPatient[]): ParsedUtterance {
  const phrase = tidy(text);
  const lower = phrase.toLowerCase();
  if (!phrase) return unknown(text);

  if (lower === 'contact emergency' || lower === 'contact the emergency team') {
    return heard(text, { type: 'emergency' }, EMERGENCY_TEXT, EMERGENCY_TEXT);
  }
  if (lower === 'confirm') return heard(text, { type: 'confirm' }, 'Confirming the pending action.', 'Confirming.');
  if (lower === 'cancel') return heard(text, { type: 'cancel' }, 'Cancelling the pending action.', 'Cancelling.');

  if (lower === 'send prescription to patient' || lower === 'send the prescription to the patient' || lower === 'send this to the patient') {
    return heard(text, { type: 'open_draft', draft: 'prescription' }, `Opened a prescription draft. ${CONFIRM_TO_SAVE}`, CONFIRM_TO_SAVE);
  }
  if (lower === 'send all notes to the hospital') {
    return heard(text, { type: 'send_notes' }, `Listing notes for the hospital. ${CONFIRM_TO_SAVE}`, CONFIRM_TO_SAVE);
  }
  if (lower === 'send update to hospital software' || lower === 'send an update to the hospital software' || lower === 'send this to the hospital' || lower === 'send this to the hospital inbox') {
    return heard(text, { type: 'open_draft', draft: 'hospital_update' }, `Opened a hospital-software draft. ${CONFIRM_TO_SAVE}`, CONFIRM_TO_SAVE);
  }
  if (/^send this to /.test(lower)) {
    return heard(text, { type: 'ask_recipient' }, RECIPIENT_QUESTION, RECIPIENT_QUESTION);
  }
  if (/^(?:open|show) (?:the )?(?:mri scans|latest scan|scanner)$/.test(lower)) {
    const say = lower.endsWith('scanner') ? 'Opening the scanner.' : 'Opening the latest scan.';
    return heard(text, { type: 'open_mri' }, say, say);
  }

  const finding = /^(?:show|open) (?:me )?(?:the )?(tumou?r|lesion)$/.exec(lower);
  if (finding) {
    const target = finding[1] === 'lesion' ? 'lesion' : 'tumour';
    const say = target === 'lesion' ? 'Showing the lesion.' : 'Showing the tumour.';
    return heard(text, { type: 'show_finding', target }, say, say);
  }
  if (/^(?:show|open) (?:the )?scans$/.test(lower)) {
    return heard(text, { type: 'show_scans' }, 'Stepping through the scans.', 'Stepping through the scans.');
  }

  const numbered = /^(?:give me|get me|show me) (.+?) patient number (\d+) details$/.exec(lower);
  if (numbered) {
    const nameQuery = numbered[1] ?? '';
    const mrn = numbered[2] ?? '';
    const byNumber = patients.find((patient) => patient.mrn === mrn);
    const byName = matchPatients(nameQuery, patients);
    if (!byNumber || byName.length !== 1 || byName[0]?.mrn !== byNumber.mrn) {
      const say = "Those details don't match one patient. Nothing was opened.";
      return heard(text, { type: 'refuse', reason: 'mismatch' }, say, say);
    }
    return openPatient(text, byNumber);
  }

  const change = /^(?:change|set|update) (?:the )?(.+?) to (.+)$/i.exec(phrase);
  if (change) {
    const field = FIELD_WORDS[(change[1] ?? '').toLowerCase()];
    const value = (change[2] ?? '').trim();
    if (!field || !value) return unknown(text);
    const doing = `Pending ${field}: ${value}. ${CONFIRM_TO_SAVE}`;
    return heard(text, { type: 'propose_edit', field, value }, doing, CONFIRM_TO_SAVE);
  }

  const scanner = phraseCommand(phrase);
  if (scanner?.type === 'nudge_slice') {
    const say = scanner.delta > 0 ? 'Next slice.' : 'Previous slice.';
    return heard(text, scanner, say, say);
  }
  if (scanner?.type === 'place_note') {
    return heard(text, scanner, `Note: ${scanner.text}.`, scanner.text);
  }

  const named = /^(?:open|show) (?:patient )?(.+)$/i.exec(phrase);
  if (named) {
    const hits = matchPatients(named[1] ?? '', patients);
    if (hits.length > 1) {
      const say = `More than one patient matches. Say the full name.`;
      return heard(text, { type: 'refuse', reason: 'ambiguous' }, say, say);
    }
    const only = hits[0];
    if (!only) return unknown(text);
    return openPatient(text, only);
  }

  return unknown(text);
}

function openPatient(text: string, patient: DemoPatient): ParsedUtterance {
  const say = `Opening ${patient.name}.`;
  return heard(text, { type: 'open_patient', mrn: patient.mrn, name: patient.name }, `${say} MRN ${patient.mrn}.`, say);
}
