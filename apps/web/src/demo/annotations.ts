/**
 * Notes hang off one stored treatment anchor per training case.
 * `annotate` is the entry voice or another caller can use later. It does not listen for speech.
 */
import type { DentalTraining } from './dental-anatomy.js';

export type CaseNote = { id: string; text: string };

export type NoteBook = Record<DentalTraining['n'], CaseNote[]>;

/** Fraction across the mesh box: x to the right, y up, z toward the camera. One anchor per case. */
export const TREATMENT_ANCHORS: Record<DentalTraining['n'], { label: string; spot: [number, number, number] }> = {
  1: { label: 'Right TMJ', spot: [0.16, 0.72, 0.55] },
  2: { label: 'Left TMJ', spot: [0.84, 0.72, 0.55] },
  3: { label: 'Tooth 36', spot: [0.34, 0.3, 0.72] },
  4: { label: 'Periapical lesion · 11', spot: [0.47, 0.83, 0.92] },
  5: { label: 'Tooth 48', spot: [0.76, 0.28, 0.62] },
};

let sequence = 0;

export function emptyNoteBook(): NoteBook {
  return { 1: [], 2: [], 3: [], 4: [], 5: [] };
}

export function addCaseNote(book: NoteBook, caseN: DentalTraining['n'], text: string): NoteBook {
  const body = text.trim();
  if (!body) return book;
  sequence += 1;
  const note: CaseNote = { id: `note-${caseN}-${sequence}`, text: body };
  return { ...book, [caseN]: [...book[caseN], note] };
}

export function notesFor(book: NoteBook, caseN: DentalTraining['n']): CaseNote[] {
  return book[caseN];
}

type AnnotationSink = (text: string) => void;
let sink: AnnotationSink | null = null;

/** Register the screen that should receive note text. Pass null on unmount. */
export function setAnnotationSink(next: AnnotationSink | null): void {
  sink = next;
}

/** Attach concise note text to the training case that is open. */
export function annotate(text: string): void {
  sink?.(text);
}
