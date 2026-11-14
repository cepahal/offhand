/**
 * Append-only notes on disk. The browser never imports this module.
 * MRN is digits only, so the file name cannot leave the notes directory.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanNote } from './scan-notes.js';

const MRN = /^\d{3,12}$/;

export function noteFileName(mrn: string): string {
  if (!MRN.test(mrn)) throw new Error('bad mrn');
  return `${mrn}.jsonl`;
}

export function appendNote(dir: string, note: ScanNote): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(join(dir, noteFileName(note.mrn)), `${JSON.stringify(note)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function readNotes(dir: string, mrn: string): ScanNote[] {
  try {
    const raw = readFileSync(join(dir, noteFileName(mrn)), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ScanNote);
  } catch {
    return [];
  }
}
