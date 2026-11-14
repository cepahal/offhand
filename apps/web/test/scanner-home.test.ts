import { describe, expect, it } from 'vitest';
import { patients } from '../src/demo/data.js';
import { classifyLocal, DIDNT_UNDERSTAND } from '../src/demo/intent-model.js';
import { hear, idleWake, takeCommand, COMMAND_SILENCE_MS } from '../src/demo/wake.js';
import { makeNote } from '../src/demo/scan-notes.js';
import {
  applyIntent,
  confirm,
  deleteNote,
  freshSession,
  moveView,
  placeNote,
  viewOnLoad,
} from '../src/demo/scanner-session.js';
import { CONFIDENCE_MIN } from '../src/demo/gesture-gate.js';

const five = patients.slice(0, 5);

function run(text: string) {
  return applyIntent(freshSession(five), classifyLocal(text), five);
}

describe('scanner home', () => {
  it('maps each of the five commands, and saves nothing until confirm', () => {
    const medication = run("change Alex Wu's medication to ibuprofen");
    expect(medication.pending?.kind).toBe('medication');
    expect(medication.pending?.after).toBe('ibuprofen');
    expect(medication.sent).toHaveLength(0);
    const saved = confirm(medication);
    expect(saved.pending).toBeNull();
    expect(saved.sent.some((row) => row.kind === 'hospital-copy' && row.mrn === '123132')).toBe(true);

    const history = run("view Jordan Ellis's allergies and history");
    expect(history.table?.rows.join(' ')).toContain('No known allergies');

    const mri = run("view Samira Okonkwo's MRI scan");
    expect(mri.mrn).toBe('551904');
    expect(mri.fade).toBe('out');

    const note = run('put a note here margin is clear');
    expect(note.say).toBe('margin is clear');

    const draft = run('send the patient these instructions rest today');
    expect(draft.pending?.kind).toBe('instructions');
    expect(draft.sent).toHaveLength(0);
    const sent = confirm(draft);
    expect(sent.sent.map((row) => row.kind).sort()).toEqual(['hospital-copy', 'patient']);
    expect(JSON.stringify(sent)).not.toMatch(/\d{7,}/);
  });

  it('rejects a phrase under the threshold', () => {
    const miss = run('play some music');
    expect(miss.say).toBe(DIDNT_UNDERSTAND);
    expect(miss.pending).toBeNull();
  });

  it('resets the view on load and ignores a saved view', () => {
    const saved = { zoom: 4, yaw: 90, pitch: 20, peel: 3, slice: 40, scrub: 0.5, notesShown: true };
    expect(viewOnLoad(saved)).toEqual({ zoom: 1, yaw: 0, pitch: 0, peel: 0, slice: 0, scrub: 0, notesShown: false });
  });

  it('stores a note at the pointer and deletes it', () => {
    let session = freshSession(five);
    const note = makeNote({ scanName: 'FLAIR', sliceIndex: 12, coordinates: { x: 10, y: 20, z: 30 } }, 'note', 'margin is clear', '123132', 't1');
    session = placeNote(session, note);
    expect(session.notes[0]).toMatchObject({ coordinates: { x: 10, y: 20, z: 30 }, sliceIndex: 12 });
    session = deleteNote(session, 't1');
    expect(session.notes).toHaveLength(0);
  });

  it('does not move the view for a gesture under the threshold, and keeps listening', () => {
    const start = freshSession(five).view;
    const blocked = moveView(start, 'cw', CONFIDENCE_MIN - 0.01, true);
    expect(blocked.view).toEqual(start);
    expect(blocked.listening).toBe(true);
    const moved = moveView(start, 'right', 0.9, true);
    expect(moved.view.yaw).toBe(10);
    expect(moved.listening).toBe(true);
  });

  it('captures the words after hack and waits through 1.2 seconds of silence', () => {
    const state = hear(idleWake(0), 'hey hack change medication', 1000);
    expect(state.buffer).toContain('change medication');
    expect(takeCommand(state, 1000 + COMMAND_SILENCE_MS - 1).command).toBeNull();
    const ready = takeCommand(state, 1000 + COMMAND_SILENCE_MS);
    expect(ready.command).toContain('change medication');
  });
});
