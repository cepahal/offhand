/**
 * Scanner commands shared by voice and the gesture board.
 * A gesture never turns the microphone off.
 */

export const MRI_PLACEHOLDER = 'No MRI loaded. Real scans come from the NeuroView case.';

export interface NudgeSliceCommand {
  type: 'nudge_slice';
  delta: -1 | 1;
}

export type NoteCategory = 'mark' | 'note' | 'possible lesion' | 'possible defect' | 'extraction required';

export interface PlaceNoteCommand {
  type: 'place_note';
  category: NoteCategory;
  text: string;
}

export type ScannerGesture = 'next_slice' | 'previous_slice' | 'mark_area' | 'note_check_later' | 'possible_lesion' | 'possible_defect' | 'extraction_required';

export interface ScannerSession {
  open: boolean;
  listening: boolean;
}

export interface NeuroVolume {
  caseId: string;
  scanName: string;
  file: string;
  url: string;
}

export interface NeuroIndex {
  cases: { caseId: string; volumes: { name: string; file: string }[] }[];
}

export type ScannerNodes = { kind: 'text'; text: string } | { kind: 'slices'; url: string; caption: string };

export function openScannerSession(): ScannerSession {
  return { open: true, listening: true };
}

/** Voice and the gesture board both call this, so the command object is the same. */
export function commandFromGesture(gesture: ScannerGesture): NudgeSliceCommand | PlaceNoteCommand {
  if (gesture === 'next_slice') return { type: 'nudge_slice', delta: 1 };
  if (gesture === 'previous_slice') return { type: 'nudge_slice', delta: -1 };
  if (gesture === 'mark_area') return { type: 'place_note', category: 'mark', text: 'mark this area' };
  if (gesture === 'note_check_later') return { type: 'place_note', category: 'note', text: 'check later' };
  if (gesture === 'possible_lesion') return { type: 'place_note', category: 'possible lesion', text: 'possible lesion' };
  if (gesture === 'possible_defect') return { type: 'place_note', category: 'possible defect', text: 'possible defect' };
  return { type: 'place_note', category: 'extraction required', text: 'extraction required' };
}

export function phraseForGesture(gesture: ScannerGesture): string {
  if (gesture === 'next_slice') return 'next slice';
  if (gesture === 'previous_slice') return 'previous slice';
  if (gesture === 'mark_area') return 'mark this area';
  if (gesture === 'note_check_later') return 'note: check later';
  if (gesture === 'possible_lesion') return 'possible lesion';
  if (gesture === 'possible_defect') return 'possible defect';
  return 'extraction required';
}

export function phraseCommand(phrase: string): NudgeSliceCommand | PlaceNoteCommand | null {
  const lower = phrase.trim().toLowerCase().replace(/[.?!]+$/g, '').replace(/\s+/g, ' ');
  if (lower === 'next slice') return commandFromGesture('next_slice');
  if (lower === 'previous slice' || lower === 'prev slice') return commandFromGesture('previous_slice');
  if (lower === 'mark this area') return commandFromGesture('mark_area');
  if (lower === 'note: check later' || lower === 'note check later') return commandFromGesture('note_check_later');
  if (lower === 'possible lesion') return commandFromGesture('possible_lesion');
  if (lower === 'possible defect') return commandFromGesture('possible_defect');
  if (lower === 'extraction required') return commandFromGesture('extraction_required');
  return null;
}

/** Moving the view does not stop the microphone. */
export function applyGesture(session: ScannerSession, gesture: ScannerGesture): { session: ScannerSession; command: NudgeSliceCommand | PlaceNoteCommand } {
  return { session: { open: session.open, listening: session.listening }, command: commandFromGesture(gesture) };
}

/** A listed NeuroView volume, or nothing. Demonstration chart studies are not volumes. */
export function volumeFromIndex(index: NeuroIndex | null): NeuroVolume | null {
  const cases = index?.cases ?? [];
  const chosen = cases.find((item) => item.caseId === 'isbi2015-training02') ?? cases[0];
  const volume = chosen?.volumes.at(-1);
  if (!chosen || !volume) return null;
  const file = volume.file
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return {
    caseId: chosen.caseId,
    scanName: volume.name,
    file: volume.file,
    url: `/casepacks/neuroview/${encodeURIComponent(chosen.caseId)}/${file}`,
  };
}

/** Text only when no volume is loaded. The slices branch is the only one with a canvas. */
export function scannerNodes(volume: NeuroVolume | null): ScannerNodes {
  if (!volume) return { kind: 'text', text: MRI_PLACEHOLDER };
  return { kind: 'slices', url: volume.url, caption: `${volume.scanName} · ${volume.caseId}` };
}
