import { describe, expect, it } from 'vitest';
import { addCaseNote, annotate, emptyNoteBook, notesFor, setAnnotationSink } from '../src/demo/annotations.js';

describe('dental annotations', () => {
  it('keeps the slice point and its 3D position with a note', () => {
    const anchor = { candidateId: 'tf2-f007', plane: 'axial' as const, voxel: [120, 88, 40] as [number, number, number], mm: [12.5, -30, 4] as [number, number, number] };
    const book = addCaseNote(emptyNoteBook(), 3, 'Check the distal root.', anchor);
    expect(notesFor(book, 3)[0]).toMatchObject({ text: 'Check the distal root.', anchor });
  });

  it('stores notes on the selected case and keeps them when others are opened', () => {
    const first = addCaseNote(emptyNoteBook(), 1, 'Review this region during the next TMJ assessment.');
    const second = addCaseNote(first, 4, 'Check the apex of tooth 11.');
    expect(notesFor(second, 1).map((note) => note.text)).toEqual(['Review this region during the next TMJ assessment.']);
    expect(notesFor(second, 4).map((note) => note.text)).toEqual(['Check the apex of tooth 11.']);
    expect(notesFor(second, 2)).toEqual([]);
    expect(addCaseNote(second, 1, '   ')).toBe(second);
  });

  it('sends note text to the registered screen', () => {
    const received: string[] = [];
    setAnnotationSink((text) => received.push(text));
    annotate('Review this region during the next TMJ assessment.');
    annotate('');
    setAnnotationSink(null);
    annotate('ignored');
    expect(received).toEqual(['Review this region during the next TMJ assessment.', '']);
  });
});
