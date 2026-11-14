/** Tiny observable store + Preact hook. Enough for one kiosk page; no framework needed. */
import { useEffect, useReducer } from 'preact/hooks';
import type { Bookmark, CasePackManifest, CommandSource, VerifiedText, ViewerState, ViewSnapshot } from '@hoverscan/contracts';
import type { CaseSummary, HubStatus, InvalidCase, ModuleHealth } from './hub.js';
import type { AppConfig } from '../viewer/appConfig.js';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T extends object>(s: Store<T>): T {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => s.subscribe(() => force(undefined)), [s]);
  return s.get();
}

export interface LogLine {
  at: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

/** One row of the patient-share timeline (sent, delivered, read, vote, not sent, messaging status). */
export interface TimelineRow {
  at: number;
  kind: 'sent' | 'delivered' | 'read' | 'vote' | 'reaction' | 'error' | 'status';
  text: string;
  shareId?: string;
}

/** What the assistant last said back (clarifying question, "done", error). Display only. */
export interface VoiceReply {
  at: number;
  heard?: string;
  text: string;
  error: boolean;
}

export type DialogId = 'open' | 'about' | 'keys' | null;

export interface UiState {
  hub: HubStatus;
  modules: Record<string, ModuleHealth>;
  cases: CaseSummary[];
  invalid: InvalidCase[];
  apps: Record<string, AppConfig>;
  manifest: CasePackManifest | null;
  /** True when the loaded case is a frontend mock (not a hub case pack). */
  mock: boolean;
  /** Viewer config of the loaded case (scrub target/label). */
  caseConfig: AppConfig | null;
  /** Note shown under the banner (frontend mocks). */
  caseNote: string | null;
  loading: string | null;
  /** Incremented after every successful case load (a reload of the same case included). */
  loadSeq: number;
  view: ViewSnapshot | null;
  bookmarks: Bookmark[];
  lastGesture: { name: string; at: number; confidence?: number; accepted?: boolean } | null;
  /** Proposed view. Shown before it is applied. */
  suggestion: { surgeonId: string; mode: 'orbit' | 'scrub'; plane: 'axial' | 'coronal' | 'sagittal'; text: string } | null;
  lastCommand: { type: string; source: CommandSource; at: number } | null;
  listening: boolean;
  /** Latest explanation from the hub's AI module. The only text that may be shown, sent or read aloud. */
  verified: VerifiedText | null;
  /** Hub-owned confirm token for a pending share (adopted from hub-published state). */
  pending: ViewerState['pending'];
  voiceReply: VoiceReply | null;
  timeline: TimelineRow[];
  log: LogLine[];
  dialog: DialogId;
  slicePanel: boolean;
  bigUi: boolean;
  hoverMock: boolean;
}

export const ui = createStore<UiState>({
  hub: 'closed',
  modules: {},
  cases: [],
  invalid: [],
  apps: {},
  manifest: null,
  mock: false,
  caseConfig: null,
  caseNote: null,
  loading: null,
  loadSeq: 0,
  view: null,
  bookmarks: [],
  lastGesture: null,
  suggestion: null,
  lastCommand: null,
  listening: false,
  verified: null,
  pending: {},
  voiceReply: null,
  timeline: [],
  log: [],
  dialog: null,
  slicePanel: false,
  bigUi: false,
  hoverMock: false,
});

export function logLine(text: string, level: LogLine['level'] = 'info'): void {
  const log = [...ui.get().log, { at: Date.now(), level, text }].slice(-80);
  ui.set({ log });
}

export function timelineRow(row: Omit<TimelineRow, 'at'>): void {
  ui.set({ timeline: [...ui.get().timeline, { at: Date.now(), ...row }].slice(-50) });
}
