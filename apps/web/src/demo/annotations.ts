/**
 * Notes belong to the open review focus and keep the slice point they were taken at, if any.
 * `annotate` is the entry voice or another caller can use later. It does not listen for speech.
 */
import type { DentalTraining } from './dental-anatomy.js';

/** Where a note was taken: slice plane and voxel, plus the RAS-mm point for the 3D callout. */
export type NoteAnchor = { candidateId: string; plane: 'axial' | 'coronal' | 'sagittal'; voxel: [number, number, number]; mm?: [number, number, number]; structure?: string };
export type CaseNote = { id: string; text: string; anchor?: NoteAnchor };

export type NoteBook = Record<DentalTraining['n'], CaseNote[]>;

let sequence = 0;

export function emptyNoteBook(): NoteBook {
  return { 1: [], 2: [], 3: [], 4: [], 5: [] };
}

export function addCaseNote(book: NoteBook, caseN: DentalTraining['n'], text: string, anchor?: NoteAnchor): NoteBook {
  const body = text.trim();
  if (!body) return book;
  sequence += 1;
  const note: CaseNote = { id: `note-${caseN}-${sequence}`, text: body, ...(anchor ? { anchor } : {}) };
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
