import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyMessaging } from '../../hub/src/messaging/demo-messages.js';
import { patients } from '../src/demo/data.js';
import { releaseNotes, makeNote } from '../src/demo/scan-notes.js';
import { appendNote, readNotes } from '../src/demo/scan-notes-file.js';
import {
  MRI_PLACEHOLDER,
  applyGesture,
  commandFromGesture,
  openScannerSession,
  phraseForGesture,
  scannerNodes,
  volumeFromIndex,
  type ScannerGesture,
} from '../src/demo/scanner-commands.js';
import { emptyVoiceMemory, handleUtterance } from '../src/demo/voice-apply.js';
import { parseUtterance } from '../src/demo/voice-intent.js';
import { neuroIndex } from '../vite-demo-files.js';

const NOW = '2026-11-12T18:00:00.000Z';
const POINTER = { scanName: 'FLAIR (preprocessed)', sliceIndex: 40, coordinates: { x: 12, y: 18, z: 40 } };
const GESTURES: ScannerGesture[] = ['next_slice', 'previous_slice', 'mark_area', 'note_check_later', 'possible_lesion', 'possible_defect', 'extraction_required'];

describe('scanner notes', () => {
  it('saves a note with the cursor coordinates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoverscan-notes-'));
    const note = makeNote(POINTER, 'possible lesion', 'possible lesion', '123132', NOW);
    appendNote(dir, note);
    const saved = readNotes(dir, '123132');
    expect(saved).toEqual([note]);
    expect(saved[0]?.coordinates).toEqual({ x: 12, y: 18, z: 40 });
    expect(saved[0]?.sliceIndex).toBe(40);
    expect(saved[0]?.mrn).toBe('123132');
    expect(saved[0]?.scanName).toBe('FLAIR (preprocessed)');

    const heard = handleUtterance('possible lesion', emptyVoiceMemory(), patients, '123132', NOW, 'note-1', 'Theatre 5', {
      notes: [],
      pointer: POINTER,
      volumeLoaded: true,
    });
    expect(heard.note?.coordinates).toEqual({ x: 12, y: 18, z: 40 });
    expect(heard.note?.sliceIndex).toBe(40);
    expect(heard.memory.drafts).toEqual([]);
  });

  it('does not send notes until confirm', () => {
    const note = makeNote(POINTER, 'mark', 'mark this area', '123132', NOW);
    const listed = handleUtterance('send all notes to the hospital', emptyVoiceMemory(), patients, '123132', NOW, 'notes-1', 'Theatre 5', {
      notes: [note],
      pointer: POINTER,
      volumeLoaded: true,
    });
    const draft = listed.memory.drafts[0];
    expect(draft?.status).toBe('draft');
    expect(draft?.kind).toBe('hospital_notes');
    expect(draft?.body).toContain('MRN 123132');
    expect(draft?.body).toContain('12,18,40');
    expect(draft?.body).not.toMatch(/Alex|Wu/);
    expect(draft?.patientName).not.toMatch(/Alex|Wu/);
    expect(listed.say).toBe('Say confirm to save.');

    const blocked = releaseNotes(emptyMessaging(), { id: 'notes-1', body: draft?.body ?? '', status: 'draft' }, true, 'simulated', NOW);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('needs_confirm');
    expect(blocked.state.events).toEqual([]);

    const confirmed = handleUtterance('confirm', listed.memory, patients, '123132', NOW, 'notes-2', 'Theatre 5', {
      notes: [note],
      pointer: POINTER,
      volumeLoaded: true,
    });
    expect(confirmed.memory.drafts[0]?.status).toBe('confirmed');
    const sent = releaseNotes(emptyMessaging(), { id: 'notes-1', body: confirmed.memory.drafts[0]?.body ?? '', status: 'confirmed' }, true, 'simulated', NOW);
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.state.events[0]?.role).toBe('hospital');
      expect(sent.state.events[0]?.text).toContain('MRN 123132');
      expect(sent.state.events[0]?.text).not.toMatch(/Alex|Wu/);
    }
  });
});

describe('scanner session', () => {
  it('keeps listening while a gesture moves the view', () => {
    const session = openScannerSession();
    expect(session).toEqual({ open: true, listening: true });
    const moved = applyGesture(session, 'next_slice');
    expect(moved.session.open).toBe(true);
    expect(moved.session.listening).toBe(true);
    expect(moved.command).toEqual(commandFromGesture('next_slice'));
    expect(parseUtterance('next slice', patients).intent).toEqual(moved.command);
    expect(handleUtterance('next slice', emptyVoiceMemory(), patients, '123132', NOW, 'slice-1').navigate).toBeNull();

    const opened = handleUtterance('open the scanner', emptyVoiceMemory(), patients, '123132', NOW, 'open-1');
    expect(opened.viewerEvent).toEqual({ type: 'open_mri', mrn: '123132', studyId: 'wu-t1c' });
    const still = handleUtterance('previous slice', opened.memory, patients, '123132', NOW, 'slice-2');
    expect(still.navigate).toBeNull();
    expect(still.intent).toEqual(commandFromGesture('previous_slice'));
  });

  it('uses the same command for a gesture and its phrase', () => {
    for (const gesture of GESTURES) {
      expect(parseUtterance(phraseForGesture(gesture), patients).intent).toEqual(commandFromGesture(gesture));
    }
  });

  it('shows no shape when no real volume exists', () => {
    expect(volumeFromIndex(null)).toBeNull();
    expect(volumeFromIndex({ cases: [] })).toBeNull();
    expect(scannerNodes(null)).toEqual({ kind: 'text', text: MRI_PLACEHOLDER });
    const source = readFileSync(fileURLToPath(new URL('../src/demo/MriScanner.tsx', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/ellipse|beginPath|arc\(|DemoBrain/);
    expect(source).toContain('data-mri-placeholder');
    const missing = handleUtterance('mark this area', emptyVoiceMemory(), patients, '123132', NOW, 'mark-1', 'Theatre 5', {
      notes: [],
      pointer: null,
      volumeLoaded: false,
    });
    expect(missing.note).toBeNull();
    expect(missing.say).toBe(MRI_PLACEHOLDER);
    expect(missing.memory.drafts).toEqual([]);
  });

  it('reads a NeuroView volume when the casepack is on disk', () => {
    const dir = fileURLToPath(new URL('../../../casepacks/neuroview', import.meta.url));
    if (!existsSync(dir)) return;
    const volume = volumeFromIndex(neuroIndex(dir));
    expect(volume?.caseId).toBe('isbi2015-training02');
    expect(volume?.scanName).toBe('FLAIR (preprocessed)');
    expect(volume?.file).toBe('volumes/flair-visit-04.nii.gz');
    expect(scannerNodes(volume).kind).toBe('slices');
  });
});
