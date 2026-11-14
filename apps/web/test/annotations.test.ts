import { describe, expect, it } from 'vitest';
import { addCaseNote, annotate, emptyNoteBook, notesFor, setAnnotationSink, TREATMENT_ANCHORS } from '../src/demo/annotations.js';

describe('dental annotations', () => {
  it('keeps one treatment anchor per training case', () => {
    expect(Object.keys(TREATMENT_ANCHORS)).toEqual(['1', '2', '3', '4', '5']);
    const spots = Object.values(TREATMENT_ANCHORS).map((anchor) => anchor.spot.join(','));
    expect(new Set(spots).size).toBe(5);
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
