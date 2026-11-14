/** offhand's deidentified ToothFairy2 CBCT review workspace. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { makeCommand, type ViewerCommand } from '@hoverscan/contracts';
import { GESTURE_TEXT } from '../viewer/logic.js';
import { HubClient } from '../app/hub.js';
import { createGestureGate } from './dental-gestures.js';
import { addCaseNote, annotate, emptyNoteBook, notesFor, setAnnotationSink, type CaseNote, type NoteBook } from './annotations.js';
import { DENTAL_TRAININGS } from './dental-anatomy.js';
import { CBCTWorkspace, type ScanPoint, DENTAL_CANDIDATE_GROUPS, DENTAL_CANDIDATES } from './CBCTWorkspace.js';
import type { StageControl } from './DentalStage.js';
import { resolveTooth } from './bite-analysis.js';
import { BiteSimulation } from './BiteSimulation.js';
import { useHackAssistant } from './hack-session.js';
import { PatientDatabase } from './PatientDatabase.js';
import { openPatientWindow, updatePrescription } from './patient-record.js';

type Page = 'view' | 'bite' | 'dashboard' | 'reports' | 'settings';

const DEFAULT_CLINIC = { doctor: 'OYO Clinician', hospital: 'Princeton Medical Center', patientName: 'Deidentified subject', patientId: 'Research case' };
const TRAINING_CONTEXT: Record<1 | 2 | 3 | 4 | 5, { label: string; detail: string }> = {
  1: { label: 'Right TMJ review region', detail: 'ToothFairy2 anatomy segmentation. No disc or pathology finding is labeled.' },
  2: { label: 'Left TMJ review region', detail: 'ToothFairy2 anatomy segmentation. No disc or pathology finding is labeled.' },
  3: { label: 'Tooth 36', detail: 'Tooth segmentation is highlighted in the 3D surface view; internal pulp anatomy is not segmented.' },
  4: { label: 'Periapical region · tooth 11', detail: 'Review prompt only. The case pack supplies anatomy segmentation, not a periapical lesion label.' },
  5: { label: 'Impacted tooth 48', detail: 'Tooth 48 and adjacent anatomy are available in the segmented surface view.' },
};

export function DentalView() {
  const [page, setPage] = useState<Page>('view');
  const [clinic, setClinic] = useState(DEFAULT_CLINIC);
  const [biteRequest, setBiteRequest] = useState<{ scenarioId: string | null; focus: 'bone' | 'analysis' | 'adjustments' | null; replay: number }>({ scenarioId: null, focus: null, replay: 0 });
  const [training, setTraining] = useState(0);
  const [candidateSelection, setCandidateSelection] = useState<Record<1 | 2 | 3 | 4 | 5, string>>({
    1: 'tf2-f001', 2: 'tf2-f003', 3: 'tf2-f007', 4: 'tf2-f009', 5: 'tf2-f004',
  });
  const [notes, setNotes] = useState<NoteBook>(emptyNoteBook);
  const [scanPoint, setScanPoint] = useState<ScanPoint | null>(null);
  const viewer = useRef<StageControl | null>(null);
  const [gestureLabel, setGestureLabel] = useState('Board idle');
  const armRef = useRef<() => void>(() => {});
  const active = DENTAL_TRAININGS[training] ?? DENTAL_TRAININGS[0]!;
  const caseRef = useRef(active.n);
  const scanPointRef = useRef<ScanPoint | null>(scanPoint);
  caseRef.current = active.n;
  scanPointRef.current = scanPoint;
  useEffect(() => {
    void fetch('/api/clinic')
      .then(async (response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const row = value as Partial<typeof DEFAULT_CLINIC>;
        if (row.doctor && row.hospital && row.patientName && row.patientId) setClinic({ doctor: row.doctor, hospital: row.hospital, patientName: row.patientName, patientId: row.patientId });
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    setAnnotationSink((text) => {
      setNotes((book) => addCaseNote(book, caseRef.current, text, scanPointRef.current ?? undefined));
    });
    return () => setAnnotationSink(null);
  }, []);
  useEffect(() => {
    const gate = createGestureGate();
    const client = new HubClient();
    client.onStatus((status) => {
      if (status === 'closed') setGestureLabel('Board offline');
      if (status === 'open') setGestureLabel((current) => (current === 'Board offline' ? 'Board idle' : current));
    });
    client.on((env) => {
      if (env.ch !== 'gesture' || env.ev.t !== 'g') return;
      const action = gate.accept(env.ev, Date.now());
      if (!action) return;
      setGestureLabel(GESTURE_TEXT[env.ev.g] ?? env.ev.g);
      if (action.type === 'wake') {
        armRef.current();
        return;
      }
      if (action.type === 'peel') {
        viewer.current?.peel(action.dir);
        return;
      }
      viewer.current?.apply(makeCommand(action, 'gesture'));
    });
    client.connect();
    return () => client.close();
  }, []);
  const hack = useHackAssistant({
    showPatient: () => openPatientWindow(),
    viewScans: () => setPage('view'),
    addNote: (text) => annotate(text),
    applyPrescription: async (medication) => {
      await updatePrescription(medication, true);
    },
    openBite: () => setPage('bite'),
    simulateBite: (tooth) => {
      const found = resolveTooth(tooth);
      if (!found.ok) return found;
      setPage('bite');
      setBiteRequest((current) => ({ scenarioId: found.scenario.id, focus: 'analysis', replay: current.replay + 1 }));
      return { ok: true };
    },
    showBone: () => {
      setPage('bite');
      setBiteRequest((current) => ({ ...current, focus: 'bone' }));
    },
    showAnalysis: () => {
      setPage('bite');
      setBiteRequest((current) => ({ ...current, focus: 'analysis' }));
    },
    showAdjustments: () => {
      setPage('bite');
      setBiteRequest((current) => ({ ...current, focus: 'adjustments' }));
    },
    replayBite: () => {
      setPage('bite');
      setBiteRequest((current) => ({ ...current, replay: current.replay + 1 }));
    },
  });
  armRef.current = hack.arm;
  const caseNotes = notesFor(notes, active.n);
  const caseCandidates = DENTAL_CANDIDATE_GROUPS[active.n];
  const candidate = caseCandidates.find((item) => item.id === candidateSelection[active.n]) ?? caseCandidates[0]!;
  const selectCandidate = (id: string) => {
    const selection = DENTAL_CANDIDATES.find((item) => item.id === id);
    if (!selection) return;
    setTraining(selection.training - 1);
    setCandidateSelection((current) => ({ ...current, [selection.training]: selection.id }));
  };
  useEffect(() => setScanPoint(null), [active.n, candidate.id]);
  return (
    <div class="dv min-h-screen text-sm">
      <header class="dv-top flex items-center">
        <div class="dv-brand">
          <span class="dv-brand-mark"><Tooth /></span>
          <span class="dv-brand-copy"><strong>offhand</strong><small>IMAGING WORKSTATION</small></span>
        </div>
        <span class="dv-top-rule" />
        <div class="dv-session">
          <span class="dv-overline">ACTIVE REVIEW</span>
          <strong>{active.title}</strong>
          <small>{candidate.id.toUpperCase()} <i /> TOOTHFAIRY2 RESEARCH DATA</small>
        </div>
        <div class="dv-top-right">
          <span class={`dv-connection ${gestureLabel === 'Board offline' ? 'is-offline' : ''}`}>
            <i />{gestureLabel === 'Board offline' ? 'Board offline' : 'Gesture board'}
          </span>
          <button class="dv-user" type="button" onClick={() => openPatientWindow()} title="Open patient record">
            <span class="dv-user-mark" aria-hidden="true">OY</span>
            <span><strong>{clinic.doctor}</strong><small>{clinic.hospital}</small></span>
            <Caret />
          </button>
        </div>
      </header>
      <div class="dv-body grid min-h-0">
        <nav class="dv-nav">
          <span class="dv-rail-label">WORKSPACE</span>
          <button class={page === 'view' ? 'on' : ''} type="button" onClick={() => setPage('view')}><Tooth /><span>Scan review</span></button>
          <button class={page === 'bite' ? 'on' : ''} type="button" onClick={() => setPage('bite')}><Pulse /><span>Pressure analysis</span></button>
          <span class="dv-rail-label dv-rail-spaced">CLINIC</span>
          <button class={page === 'dashboard' ? 'on' : ''} type="button" onClick={() => setPage('dashboard')}><Grid /><span>Dashboard</span></button>
          <button class={page === 'reports' ? 'on' : ''} type="button" onClick={() => setPage('reports')}><Doc /><span>Reports</span></button>
          <button class={page === 'settings' ? 'on' : ''} type="button" onClick={() => setPage('settings')}><Gear /><span>Settings</span></button>
          <div class="dv-nav-bottom">
            <div class="dv-nav-board"><i class="dv-live" /><span><b>{gestureLabel}</b><small>Gesture input</small></span></div>
            <button type="button" class="dv-patient-link" onClick={() => openPatientWindow()}><Person /><span>Patient record</span></button>
          </div>
        </nav>
        <main class="dv-main min-w-0 min-h-0">
          <div class="dv-main-head">
            <div><span class="dv-overline">CASE WORKSPACE / {candidate.id.toUpperCase()}</span><h1>{page === 'view' ? active.title : page === 'bite' ? 'Pressure analysis' : page[0]!.toUpperCase() + page.slice(1)}</h1></div>
            <div class="dv-case-tags"><span>FDI {['18 / 48', '28 / 38', '36', '11', '48'][active.n - 1]}</span><span>Research candidate</span></div>
          </div>
          <div class="dv-main-content">
            {page === 'view' ? (
              <NeuroStage training={training} setTraining={setTraining} candidateId={candidate.id} onCandidateChange={(id) => setCandidateSelection((current) => ({ ...current, [active.n]: id }))} onTrainingCandidateChange={selectCandidate} viewer={viewer} notes={caseNotes} onScanPoint={setScanPoint} command={hack.command} gestureLabel={gestureLabel} awaiting={hack.pending !== null} />
            ) : page === 'bite' ? (
              <BiteSimulation trainingTitle={active.title} patientName="Deidentified subject" request={biteRequest} onNote={hack.note} />
            ) : (
              <DummyPage page={page} clinic={clinic} />
            )}
          </div>
        </main>
        <aside class="dv-right">
          <div class="dv-panel-heading"><div><span class="dv-overline">REVIEW DETAILS</span><h2>Case context</h2></div><span class="dv-context-id">{candidate.id.toUpperCase()}</span></div>
          <article class="dv-card dv-patient-card">
            <Person />
            <div><h2>Subject</h2><p class="dv-patient-name">{candidate.subjectId}</p><p>Deidentified <i /> Age not supplied</p></div>
            <button type="button" aria-label="Open patient record" onClick={() => openPatientWindow()}><Caret /></button>
          </article>
          <article class="dv-card dv-finding-card">
            <Pin />
            <div><h2>Focus region</h2><p class="dv-highlight">{TRAINING_CONTEXT[active.n].label}</p><p class="dv-muted">{TRAINING_CONTEXT[active.n].detail}</p></div>
          </article>
          <article class="dv-card dv-ai-card">
            <Spark />
            <div><h2>AI activity</h2><p class="dv-ai-state"><span class="dv-live" />{hack.activity}</p><p class="dv-muted">Assistant · {hack.phase}</p></div>
          </article>
          <article class="dv-card dv-clinic-card">
            <Building />
            <div><h2>Clinic</h2><p>{clinic.hospital}</p>{hack.hospitalMessage ? <p class="dv-muted">{hack.hospitalMessage}</p> : null}</div>
          </article>
          <NotesCard notes={caseNotes} scanPoint={scanPoint} />
          <details class="dv-activity">
            <summary><Clock /><span>Recent activity</span><small>{hack.log.length}</small></summary>
            <div class="dv-activity-list">{hack.log.length === 0 ? <p>No commands yet.</p> : hack.log.slice(-6).reverse().map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
          </details>
          {hack.patientMessage.startsWith('Delivered') && (
            <div class="dv-toast">
              <Check />
              <p><b>Message delivered to patient:</b><br />{hack.patientMessage}</p>
              <button type="button" aria-label="Dismiss" onClick={hack.dismissPatient}>×</button>
            </div>
          )}
        </aside>
      </div>
      <PatientDatabase />
    </div>
  );
}

function mouseCommand(body: { type: 'zoom'; factor: number } | { type: 'rotate'; yawDeg: number }): ViewerCommand {
  return { id: 'dental-ui', ts: Date.now(), source: 'mouse', ...body };
}

function NeuroStage({
  training,
  setTraining,
  candidateId,
  onCandidateChange,
  onTrainingCandidateChange,
  viewer,
  notes,
  onScanPoint,
  command,
  gestureLabel,
  awaiting,
}: {
  training: number;
  setTraining: (index: number) => void;
  candidateId: string;
  onCandidateChange: (id: string) => void;
  onTrainingCandidateChange: (id: string) => void;
  viewer: { current: StageControl | null };
  notes: CaseNote[];
  onScanPoint: (point: ScanPoint) => void;
  command: string;
  gestureLabel: string;
  awaiting: boolean;
}) {
  const active = DENTAL_TRAININGS[training] ?? DENTAL_TRAININGS[0]!;
  return (
    <section class="dv-stage">
      <div class="dv-stage-toolbar">
        <div class="dv-train" role="tablist" aria-label="Training cases">
        {DENTAL_TRAININGS.map((item, index) => (
          <button key={item.n} type="button" role="tab" aria-selected={index === training} class={index === training ? 'on' : ''} onClick={() => setTraining(index)}>
            {item.tabLabel}
          </button>
        ))}
        </div>
        <select class="dv-training-select" aria-label="Select Training…" value={candidateId} onChange={(event) => onTrainingCandidateChange(event.currentTarget.value)}>
          <option value="" disabled>Select Training…</option>
          {DENTAL_CANDIDATES.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <div class="dv-stage-actions" aria-label="3D view controls">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => viewer.current?.apply(mouseCommand({ type: 'zoom', factor: 1.12 }))}><Search /></button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => viewer.current?.apply(mouseCommand({ type: 'zoom', factor: 1 / 1.12 }))}><SearchOut /></button>
          <button type="button" aria-label="Rotate model" title="Rotate model" onClick={() => viewer.current?.apply(mouseCommand({ type: 'rotate', yawDeg: 24 }))}><Rotate /></button>
          <button type="button" aria-label="Reset view" title="Reset view" onClick={() => viewer.current?.reset()}><Reset /></button>
          <button type="button" aria-label="Toggle full screen" title="Toggle full screen" onClick={() => { const stage = document.querySelector('.dv-stage'); if (!stage) return; if (document.fullscreenElement) void document.exitFullscreen(); else void stage.requestFullscreen(); }}><Expand /></button>
        </div>
      </div>
      <CBCTWorkspace key={candidateId} training={active.n} candidateId={candidateId} notes={notes} onCandidateChange={onCandidateChange} onScanPoint={onScanPoint} bind={(next) => { viewer.current = next; }} />
      <div class="dv-stage-footer">
        <div class="dv-gesture-status"><Hand /><span><b>Gesture controls</b><small>{gestureLabel} · {awaiting ? 'Wave to confirm' : 'Wave to listen'}</small></span></div>
        <div class="dv-cmd"><span class="dv-orb" /><span>{command || 'Ready for a command'}</span><i /></div>
      </div>
    </section>
  );
}

function NotesCard({ notes, scanPoint }: { notes: CaseNote[]; scanPoint: ScanPoint | null }) {
  const [draft, setDraft] = useState('');
  return (
    <section class="dv-card dv-notes-card">
      <div class="dv-notes-heading"><Doc /><div><h2>Scan notes</h2><small>{notes.length} attached to this region</small></div></div>
      <p class="dv-note-anchor">{scanPoint ? `Anchor: ${scanPoint.candidateId.toUpperCase()} · ${scanPoint.plane} · voxel ${scanPoint.voxel.join(', ')}` : 'Select a location on any CBCT slice to anchor a note.'}</p>
      <form class="dv-note-form" onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; annotate(draft); setDraft(''); }}>
        <textarea aria-label="Note for this scan region" value={draft} placeholder="Add an observation to this region…" rows={3} onInput={(event) => setDraft(event.currentTarget.value)} />
        <div class="dv-note-actions"><button type="button" class="dv-record" onClick={() => openPatientWindow()}>Patient record</button><button type="submit" disabled={!draft.trim()}>Add note</button></div>
      </form>
      <div class="dv-note-list">{notes.length === 0 ? <p>No notes on this training case.</p> : notes.slice(-3).reverse().map((note) => <article key={note.id}><i /><p>{note.text}{note.anchor && <small> · {note.anchor.candidateId.toUpperCase()} / {note.anchor.plane} / voxel {note.anchor.voxel.join(', ')}</small>}</p></article>)}</div>
    </section>
  );
}

function DummyPage({ page, clinic }: { page: Exclude<Page, 'view' | 'bite'>; clinic: typeof DEFAULT_CLINIC }) {
  const [sound, setSound] = useState(true);
  const [hints, setHints] = useState(true);
  if (page === 'dashboard') {
    return (
      <section class="dv-page">
        <h1>Dashboard</h1>
        <p class="lead">A sample board for the clinic day. Nothing here is a live record.</p>
        <div class="dv-grid">
          <article class="dv-card"><h2>Open charts</h2><p>4 demonstration charts are on the board.</p></article>
          <article class="dv-card"><h2>Candidate library</h2><p>Ten ToothFairy2 scans are grouped by review focus.</p></article>
          <article class="dv-card"><h2>Messages</h2><p>1 note is waiting for the front desk.</p></article>
          <article class="dv-card"><h2>Board</h2><p>The gesture board reports idle.</p></article>
        </div>
      </section>
    );
  }
  if (page === 'reports') {
    return (
      <section class="dv-page">
        <h1>Reports</h1>
        <p class="lead">Sample report names. These are not clinical documents.</p>
        <article class="dv-card"><h2>Morning list</h2><p>Five review focuses are available across ten candidates.</p></article>
        <article class="dv-card"><h2>Message log</h2><p>A prescription note was sent to the demonstration patient.</p></article>
        <article class="dv-card"><h2>Image check</h2><p>Axial, coronal, and sagittal views are on file.</p></article>
      </section>
    );
  }
  return (
    <section class="dv-page">
      <h1>Settings</h1>
      <p class="lead">Display choices for this screen. They stay on this browser only.</p>
      <article class="dv-card dv-setting"><div><h2>Command chime</h2><p>{sound ? 'On' : 'Off'}</p></div><button type="button" onClick={() => setSound((v) => !v)}>{sound ? 'Turn off' : 'Turn on'}</button></article>
      <article class="dv-card dv-setting"><div><h2>Training hints</h2><p>{hints ? 'Shown' : 'Hidden'}</p></div><button type="button" onClick={() => setHints((v) => !v)}>{hints ? 'Hide' : 'Show'}</button></article>
      <article class="dv-card"><h2>Clinic</h2><p>{clinic.hospital} · {clinic.doctor}</p></article>
    </section>
  );
}

function Tooth() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 3c2 0 2.5 2 4 2s2-2 4-2c3 0 5 3 5 6 0 4-2 6-3 9-.5 1.6-1.4 3-2.4 3-1.2 0-1.6-1.6-2.6-1.6S11.6 21 10.4 21c-1 0-1.9-1.4-2.4-3C7 15 5 13 5 9c0-3 2-6 3-6z" />
    </svg>
  );
}
function Mic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z" />
    </svg>
  );
}
function Grid() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
    </svg>
  );
}
function Doc() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M6 2h8l4 4v16H6V2zm8 1.5V7h3.5L14 3.5zM8 11h8v1.5H8V11zm0 3h8v1.5H8V14zm0 3h5v1.5H8V17z" />
    </svg>
  );
}
function Gear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm8.2 3-1.7-.3a6.8 6.8 0 0 0-.7-1.6l1-1.4-1.4-1.4-1.4 1a6.8 6.8 0 0 0-1.6-.7L14 5h-2l-.3 1.6a6.8 6.8 0 0 0-1.6.7l-1.4-1L7.3 7.7l1 1.4a6.8 6.8 0 0 0-.7 1.6L6 11v2l1.6.3c.2.6.4 1.1.7 1.6l-1 1.4 1.4 1.4 1.4-1c.5.3 1 .5 1.6.7L12 19h2l.3-1.6c.6-.2 1.1-.4 1.6-.7l1.4 1 1.4-1.4-1-1.4c.3-.5.5-1 .7-1.6L20 13v-2h-1.8z" />
    </svg>
  );
}
function Shield() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#e8a23a" d="M12 2 4 5v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V5l-8-3z" />
      <path fill="#1a1206" d="M12 7v10h1.2c1.6 0 2.8-1 2.8-2.6V11H12V9.2h4V8H12z" />
    </svg>
  );
}
function Caret() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 10l4 4 4-4H8z" />
    </svg>
  );
}
function Search() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm7.5 12.1-3-3a8 8 0 1 0-1.4 1.4l3 3 1.4-1.4zM11 7H9v2H7v2h2v2h2v-2h2V9h-2V7z" />
    </svg>
  );
}
function SearchOut() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm7.5 12.1-3-3a8 8 0 1 0-1.4 1.4l3 3 1.4-1.4zM7 9h6v2H7V9z" />
    </svg>
  );
}
function Rotate() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 6V3L8 7l4 4V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6z" />
    </svg>
  );
}
function Reset() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 4a8 8 0 1 1-7.3 4.7l1.8.9A6 6 0 1 0 12 6V9L7.5 5.5 12 2v2z" />
    </svg>
  );
}
function Expand() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z" />
    </svg>
  );
}
function Hand() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 11V6a1.5 1.5 0 0 1 3 0v4h1V5a1.5 1.5 0 0 1 3 0v5h1V7.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-1.5A1.5 1.5 0 0 1 8 11z" />
    </svg>
  );
}
function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="#22c55e" />
      <path fill="#06210f" d="M10.2 15.2 7.4 12.4l1.2-1.2 1.6 1.6 4.2-4.2 1.2 1.2-5.4 5.4z" />
    </svg>
  );
}
function Orb() {
  return <span class="dv-orb" aria-hidden="true" />;
}
function Pin() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#f5c518" d="M12 2a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 0 0-6-6zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
    </svg>
  );
}
function Spark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2l1.6 6.2L20 10l-6.4 1.8L12 18l-1.6-6.2L4 10l6.4-1.8L12 2zm6 12l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
    </svg>
  );
}
function Person() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4v2h14v-2c0-2-3-4-7-4z" />
    </svg>
  );
}
function Building() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 20V6l8-3 8 3v14h-5v-5H9v5H4zm6-9h2v2h-2V11zm4 0h2v2h-2v-2z" />
    </svg>
  );
}
function Pulse() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 12h4l2-5 4 10 2-5h6v2h-4l-2 5-4-10-2 5H3v-2z" />
    </svg>
  );
}
function Clock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11h5v-2h-4V6h-2v7h1z" />
    </svg>
  );
}
