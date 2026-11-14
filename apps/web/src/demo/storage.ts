/** Choices and chart edits stay in the browser. There is no server. */
import { emptyDraft } from './logic.js';
import { CHART_FIELDS, type ChartEdit, type ChartField, type DemoSession, type OnboardingDraft } from './types.js';

const DRAFT_KEY = 'hoverscan.demo.onboarding';
const SESSION_KEY = 'hoverscan.demo.session';
const EDITS_KEY = 'hoverscan.demo.edits';
const TIMER_KEY = 'hoverscan.demo.onboardingStartedAt';

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function loadDraft(): OnboardingDraft {
  const parsed = readJson(DRAFT_KEY);
  if (!parsed || typeof parsed !== 'object') return emptyDraft();
  const draft = parsed as Partial<OnboardingDraft>;
  const hitl: Record<string, boolean> = {};
  if (draft.hitl && typeof draft.hitl === 'object') {
    for (const [id, on] of Object.entries(draft.hitl)) hitl[id] = on === true;
  }
  return {
    hospitalId: typeof draft.hospitalId === 'string' ? draft.hospitalId : null,
    siteId: typeof draft.siteId === 'string' ? draft.siteId : null,
    theatreId: typeof draft.theatreId === 'string' ? draft.theatreId : null,
    policyIds: isStringArray(draft.policyIds) ? draft.policyIds : [],
    hitl,
  };
}

export function saveDraft(draft: OnboardingDraft): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function loadSession(): DemoSession | null {
  const parsed = readJson(SESSION_KEY);
  if (!parsed || typeof parsed !== 'object') return null;
  const session = parsed as Partial<DemoSession>;
  if (typeof session.hospitalId !== 'string' || typeof session.siteId !== 'string' || typeof session.theatreId !== 'string') return null;
  if (!isStringArray(session.policyIds) || typeof session.completedAt !== 'string') return null;
  const hitl: Record<string, boolean> = {};
  if (session.hitl && typeof session.hitl === 'object') {
    for (const [id, on] of Object.entries(session.hitl)) hitl[id] = on === true;
  }
  return {
    hospitalId: session.hospitalId,
    siteId: session.siteId,
    theatreId: session.theatreId,
    policyIds: session.policyIds,
    hitl,
    completedAt: session.completedAt,
  };
}

export function saveSession(draft: OnboardingDraft, completedAt: string): DemoSession | null {
  if (!draft.hospitalId || !draft.siteId || !draft.theatreId) return null;
  const session: DemoSession = {
    hospitalId: draft.hospitalId,
    siteId: draft.siteId,
    theatreId: draft.theatreId,
    policyIds: draft.policyIds,
    hitl: draft.hitl,
    completedAt,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function isField(value: string): value is ChartField {
  return (CHART_FIELDS as readonly string[]).includes(value);
}

export function loadEdits(): ChartEdit[] {
  const parsed = readJson(EDITS_KEY);
  if (!Array.isArray(parsed)) return [];
  const edits: ChartEdit[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const edit = item as Partial<ChartEdit>;
    if (typeof edit.id !== 'string' || typeof edit.mrn !== 'string' || typeof edit.field !== 'string') continue;
    if (!isField(edit.field) || (edit.status !== 'pending' && edit.status !== 'confirmed')) continue;
    if (typeof edit.before !== 'string' || typeof edit.after !== 'string' || typeof edit.savedAt !== 'string') continue;
    edits.push({
      id: edit.id,
      mrn: edit.mrn,
      field: edit.field,
      before: edit.before,
      after: edit.after,
      status: edit.status,
      savedAt: edit.savedAt,
      ...(typeof edit.confirmedAt === 'string' ? { confirmedAt: edit.confirmedAt } : {}),
    });
  }
  return edits;
}

export function saveEdits(edits: readonly ChartEdit[]): void {
  localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
}

export function onboardingStartedAt(): number {
  const stored = sessionStorage.getItem(TIMER_KEY);
  const parsed = stored ? Number(stored) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  const now = Date.now();
  sessionStorage.setItem(TIMER_KEY, String(now));
  return now;
}
