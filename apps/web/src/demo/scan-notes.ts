/**
 * Sticky notes for the scanner. A note is a point on a slice, not a change to the chart.
 * The hospital message names the MRN only.
 */
import { releaseMessage, type MessagingState, type ReleaseResult } from '../../../hub/src/messaging/demo-messages.js';
import type { NoteCategory } from './scanner-commands.js';

export interface NotePoint {
  x: number;
  y: number;
  z: number;
}

export interface ScanNote {
  text: string;
  category: NoteCategory;
  mrn: string;
  scanName: string;
  sliceIndex: number;
  coordinates: NotePoint;
  at: string;
}

export interface NotePointer {
  scanName: string;
  sliceIndex: number;
  coordinates: NotePoint;
}

export interface ScanContext {
  notes: readonly ScanNote[];
  pointer: NotePointer | null;
  volumeLoaded: boolean;
}

export function emptyScanContext(): ScanContext {
  return { notes: [], pointer: null, volumeLoaded: false };
}

export function makeNote(pointer: NotePointer, category: NoteCategory, text: string, mrn: string, at: string): ScanNote {
  return {
    text,
    category,
    mrn,
    scanName: pointer.scanName,
    sliceIndex: pointer.sliceIndex,
    coordinates: { x: pointer.coordinates.x, y: pointer.coordinates.y, z: pointer.coordinates.z },
    at,
  };
}

/** One hospital message. The patient's name is not included. */
export function hospitalNotesText(mrn: string, notes: readonly ScanNote[]): string {
  const lines = notes.map((note) => `${note.category}: ${note.text} | ${note.scanName} | slice ${note.sliceIndex} | ${note.coordinates.x},${note.coordinates.y},${note.coordinates.z} | ${note.at}`);
  return [`MRN ${mrn}`, ...lines].join('\n');
}

/** The Photon release runs only after the draft is confirmed. */
export function releaseNotes(state: MessagingState, draft: { id: string; body: string; status: 'draft' | 'confirmed' }, approved: boolean, mode: 'live' | 'simulated', now: string): ReleaseResult {
  return releaseMessage(state, {
    shareId: draft.id,
    role: 'hospital',
    text: draft.body,
    confirmed: draft.status === 'confirmed',
    clinicianApproved: approved,
    mode,
    now,
  });
}
