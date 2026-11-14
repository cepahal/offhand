/** Tiny observable store + Preact hook. Enough for one kiosk page; no framework needed. */
import { useEffect, useReducer } from 'preact/hooks';
import type { Bookmark, CasePackManifest, CommandSource, ViewSnapshot } from '@offhand/contracts';
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
  view: ViewSnapshot | null;
  bookmarks: Bookmark[];
  lastGesture: { name: string; at: number } | null;
  lastCommand: { type: string; source: CommandSource; at: number } | null;
  listening: boolean;
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
  view: null,
  bookmarks: [],
  lastGesture: null,
  lastCommand: null,
  listening: false,
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
