/**
 * Offhand dental CBCT workstation.
 * Layout (macOS split view): toolbar · sidebar (navigation) | viewports | inspector (details) · status bar.
 * Gestures go through GestureIntent (stroke/return model); voice goes through the Hack assistant.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { makeCommand } from '@hoverscan/contracts';
import { HubClient } from '../app/hub.js';
import { GestureIntent } from './gesture-intent.js';
import { addCaseNote, annotate, emptyNoteBook, notesFor, setAnnotationSink, type CaseNote, type NoteBook } from './annotations.js';
import { DENTAL_TRAININGS, type DentalTraining } from './dental-anatomy.js';
import { CBCTWorkspace, DENTAL_CANDIDATE_GROUPS, DENTAL_CANDIDATES, focusName, offFocus, pinLabel, type GestureCue, type ScanPoint, type StageControl } from './CBCTWorkspace.js';
import { universalFromFdi } from './bite-scenarios.js';
import { resolveTooth } from './bite-analysis.js';
import { BiteSimulation } from './BiteSimulation.js';
import { useHackAssistant } from './hack-session.js';
import type { HackPhase } from './hack-commands.js';
import { PatientDatabase } from './PatientDatabase.js';
import { openPatientWindow, updatePrescription } from './patient-record.js';
import {
  IconCheck,
  IconChevron,
  IconClock,
  IconClose,
  IconDoc,
  IconGear,
  IconGrid,
  IconInspector,
  IconMic,
  IconPin,
  IconPressure,
  IconRecord,
  IconScan,
  PuckGlyph,
} from './icons.js';

type Page = 'view' | 'bite' | 'dashboard' | 'reports' | 'settings';
type Board = 'live' | 'idle' | 'offline';

const DEFAULT_CLINIC = { doctor: 'OYO Clinician', hospital: 'Princeton Medical Center', patientName: 'Deidentified subject', patientId: 'Research case' };
const HEARTBEAT_STALE_MS = 5000;

const CUE_TEXT: Record<string, { glyph: GestureCue['glyph']; label: string }> = {
  left: { glyph: 'left', label: 'Rotate left' },
  right: { glyph: 'right', label: 'Rotate right' },
  up: { glyph: 'up', label: 'Tilt up' },
  down: { glyph: 'down', label: 'Tilt down' },
  forward: { glyph: 'zoom-in', label: 'Zoom in' },
  backward: { glyph: 'zoom-out', label: 'Zoom out' },
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
  const [board, setBoard] = useState<Board>('idle');
  const [cue, setCue] = useState<GestureCue | null>(null);
  const [inspector, setInspector] = useState(true);
  const [source, setSource] = useState('ToothFairy2 · research training data');
  const viewer = useRef<StageControl | null>(null);
  const armRef = useRef<() => void>(() => {});
  const pendingRef = useRef(false);
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
      const point = scanPointRef.current ?? undefined;
      setNotes((book) => addCaseNote(book, caseRef.current, text, point));
      const training = DENTAL_TRAININGS.find((t) => t.n === caseRef.current);
      if (point && training && offFocus(training, point.structure)) setScanPoint(null);
    });
    return () => setAnnotationSink(null);
  }, []);

  useEffect(() => {
    const intent = new GestureIntent();
    const client = new HubClient();
    let hubOpen = false;
    let lastBeat = -Infinity;
    let cueId = 0;
    const refresh = () => setBoard(!hubOpen ? 'offline' : Date.now() - lastBeat < HEARTBEAT_STALE_MS ? 'live' : 'idle');
    const timer = window.setInterval(refresh, 1000);
    client.onStatus((status) => {
      hubOpen = status === 'open';
      refresh();
    });
    client.on((env) => {
      if (env.ch !== 'gesture') return;
      const ev = env.ev;
      if (ev.t === 'hb') {
        lastBeat = ev.paj === 'missing' || ev.paj === 'lost' ? -Infinity : Date.now();
        refresh();
        return;
      }
      if (ev.t === 'h') {
        intent.hover(ev);
        return;
      }
      if (ev.t !== 'g') return;
      lastBeat = Date.now();
      const decision = intent.gesture(ev);
      if (decision.kind === 'drop') return;
      cueId += 1;
      if (decision.kind === 'return') {
        setCue({ id: cueId, glyph: 'return', label: 'Return stroke ignored', streak: 0 });
        return;
      }
      const action = decision.action;
      if (action.type === 'wake') {
        // The voice bar shows listening/confirm; no cue in the viewport.
        armRef.current();
        return;
      }
      if (action.type === 'peel') {
        const out = action.dir === 'out';
        setCue({ id: cueId, glyph: out ? 'peel-out' : 'peel-in', label: out ? 'Peel layer' : 'Restore layer', streak: decision.streak });
        viewer.current?.peel(action.dir);
        return;
      }
      const text = CUE_TEXT[decision.gesture];
      if (text) setCue({ id: cueId, ...text, streak: decision.streak });
      viewer.current?.apply(makeCommand(action, 'gesture'));
    });
    client.connect();
    return () => {
      window.clearInterval(timer);
      client.close();
    };
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
  pendingRef.current = hack.pending !== null;

  const caseNotes = notesFor(notes, active.n);
  const caseCandidates = DENTAL_CANDIDATE_GROUPS[active.n];
  const candidate = caseCandidates.find((item) => item.id === candidateSelection[active.n]) ?? caseCandidates[0]!;
  const selectCandidate = (id: string) => {
    const selection = DENTAL_CANDIDATES.find((item) => item.id === id);
    if (!selection) return;
    setTraining(selection.training - 1);
    setCandidateSelection((current) => ({ ...current, [selection.training]: selection.id }));
    setPage('view');
  };
  useEffect(() => setScanPoint(null), [active.n, candidate.id]);

  const caseName = `Case ${candidate.id.replace('tf2-', '').toUpperCase()}`;
  const title = page === 'view' ? `${active.title}${active.focusLayer ? ` (#${universalFromFdi(active.fdi)})` : ''}` : page === 'bite' ? 'Pressure analysis' : PAGE_TITLE[page];

  return (
    <div class={`app ${inspector ? 'with-inspector' : ''}`}>
      <header class="toolbar">
        <div class="tb-lead">
          <img class="logo" src="/brand/offhand-logo-light.png" alt="offhand" width="79" height="30" />
          <span class="tb-sep" />
          <div class="tb-title">
            <h1>{title}</h1>
            <p>{caseName} · ToothFairy2 CBCT · Research case</p>
          </div>
        </div>
        <div class="seg seg-lg tb-center" role="tablist" aria-label="Workspace">
          <button type="button" role="tab" aria-selected={page === 'view'} class={page === 'view' ? 'on' : ''} onClick={() => setPage('view')}><IconScan size={17} />Scan review</button>
          <button type="button" role="tab" aria-selected={page === 'bite'} class={page === 'bite' ? 'on' : ''} onClick={() => setPage('bite')}><IconPressure size={17} />Pressure analysis</button>
        </div>
        <div class="tb-trail">
          <span class={`status status-${board}`} title="Gesture board">
            <PuckGlyph state={board} />
            <span><b>{board === 'live' ? 'Board live' : board === 'idle' ? 'No board' : 'Hub offline'}</b><small>Gesture input</small></span>
          </span>
          <span class={`status status-voice phase-${phaseClass(hack.phase)}`} title="Voice assistant">
            <IconMic size={18} />
            <span><b>{hack.phase === 'Idle' ? 'Voice ready' : hack.phase}</b><small>Wave to talk</small></span>
          </span>
          <span class="tb-sep" />
          <button type="button" class="btn" onClick={() => openPatientWindow()}><IconRecord size={17} />Patient record</button>
          <button type="button" class={`btn btn-icon ${inspector ? 'on' : ''}`} aria-pressed={inspector} aria-label="Show inspector" title="Show or hide the inspector" onClick={() => setInspector((v) => !v)}><IconInspector size={18} /></button>
        </div>
      </header>

      <div class="body">
        <nav class="sidebar" aria-label="Cases">
          <h2 class="side-head">Review focus</h2>
          <ul class="tree">
            {DENTAL_TRAININGS.map((item, index) => {
              const open = index === training;
              return (
                <li key={item.n} class={open ? 'open' : ''}>
                  <button type="button" class="tree-row" aria-expanded={open} onClick={() => { setTraining(index); setPage('view'); }}>
                    <IconChevron size={14} class="tree-caret" />
                    <span class="tree-label">{item.tabLabel}</span>
                    {item.focusLayer && <span class="tree-tag">#{universalFromFdi(item.fdi)}</span>}
                  </button>
                  {open && (
                    <ul class="tree-sub">
                      {DENTAL_CANDIDATE_GROUPS[item.n].map((c) => (
                        <li key={c.id}>
                          <button type="button" class={`tree-leaf ${c.id === candidate.id && page === 'view' ? 'sel' : ''}`} aria-current={c.id === candidate.id} onClick={() => selectCandidate(c.id)}>
                            <span class="leaf-dot" />
                            Case {c.id.replace('tf2-', '').toUpperCase()}
                            <small>{c.id === DENTAL_CANDIDATE_GROUPS[item.n][0]!.id ? 'subject A' : 'subject B'}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <h2 class="side-head">Clinic</h2>
          <ul class="tree">
            {(['dashboard', 'reports', 'settings'] as const).map((name) => (
              <li key={name}>
                <button type="button" class={`tree-row flat ${page === name ? 'sel' : ''}`} onClick={() => setPage(name)}>
                  {name === 'dashboard' ? <IconGrid size={16} /> : name === 'reports' ? <IconDoc size={16} /> : <IconGear size={16} />}
                  <span class="tree-label">{PAGE_TITLE[name]}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main class="main">
          {page === 'view' ? (
            <CBCTWorkspace
              key={candidate.id}
              training={active}
              candidateId={candidate.id}
              notes={caseNotes}
              cue={cue}
              onScanPoint={setScanPoint}
              onSource={setSource}
              bind={(next) => { viewer.current = next; }}
            />
          ) : page === 'bite' ? (
            <BiteSimulation trainingTitle={active.title} patientName="Deidentified subject" request={biteRequest} onNote={hack.note} />
          ) : (
            <InfoPage page={page} clinic={clinic} board={board} />
          )}
          <div class="dock">
            <CommandBar phase={hack.phase} command={hack.command} heard={hack.heard} awaiting={hack.pending !== null} target={page === 'view' ? (scanPoint ? pinLabel(scanPoint) : focusName(active)) : null} off={!!scanPoint && offFocus(active, scanPoint.structure)} />
          </div>
          {hack.patientMessage.startsWith('Delivered') && (
            <div class="notice" role="status">
              <span class="notice-icon"><IconCheck size={18} /></span>
              <p><b>Message delivered to the patient</b>{hack.patientMessage.replace(/^Delivered:\s*/, '')}</p>
              <button type="button" class="btn-plain" aria-label="Dismiss" onClick={hack.dismissPatient}><IconClose size={16} /></button>
            </div>
          )}
        </main>

        {inspector && (
          <aside class="inspector" aria-label="Inspector">
            <section class="insp">
              <h2 class="insp-head">Review focus</h2>
              <p class="big">{active.title}</p>
              <dl class="kv">
                {active.focusLayer && <div><dt>Tooth</dt><dd>FDI {active.fdi} · Universal #{universalFromFdi(active.fdi)}</dd></div>}
                <div><dt>Case</dt><dd>{caseName} · de-identified, age not supplied</dd></div>
              </dl>
              <p class="meta">{active.context}</p>
            </section>
            <NotesSection notes={caseNotes} scanPoint={scanPoint} training={active} onPick={(note) => { if (note.anchor?.mm) viewer.current?.goTo(note.anchor.mm); }} />
            <details class="insp insp-fold" open>
              <summary class="insp-head"><IconClock size={15} />Activity<span class="count">{hack.log.length}</span></summary>
              {hack.hospitalMessage && <p class="meta">Hospital message: {hack.hospitalMessage}</p>}
              {hack.patientMessage && !hack.patientMessage.startsWith('Delivered') && <p class="meta">Patient message: {hack.patientMessage}</p>}
              <ol class="log">
                {hack.log.length === 0 ? <li class="empty">No commands yet.</li> : hack.log.slice(0, 8).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
              </ol>
            </details>
          </aside>
        )}
      </div>

      <footer class="statusbar">
        <span class="sb-warn"><i />Research data · Not for diagnosis</span>
        <span class="sb-src">{source}</span>
        <span class="sb-fill" />
        {scanPoint && <span>Pinned point: {pinLabel(scanPoint)}</span>}
      </footer>
      <PatientDatabase />
    </div>
  );
}

const PAGE_TITLE: Record<'dashboard' | 'reports' | 'settings', string> = { dashboard: 'Dashboard', reports: 'Reports', settings: 'Settings' };

function phaseClass(phase: HackPhase): string {
  if (phase === 'Listening') return 'listening';
  if (phase === 'Understanding' || phase === 'Preparing' || phase === 'Executing') return 'working';
  if (phase === 'Awaiting Confirmation') return 'confirm';
  if (phase === 'Completed') return 'done';
  return 'idle';
}

/**
 * The voice/command bar. Sized to read from the chair: words appear as they are recognised,
 * each one easing in, so it is obvious the system is hearing you.
 */
function CommandBar({ phase, command, heard, awaiting, target, off }: { phase: HackPhase; command: string; heard: string; awaiting: boolean; target: string | null; off: boolean }) {
  const state = phaseClass(phase);
  const listening = phase === 'Listening';
  const words = listening && heard ? heard.split(/\s+/) : [];
  const hint = awaiting ? 'Wave to confirm' : listening ? 'Pause to finish' : state === 'working' ? 'Working' : 'Wave to speak';
  const pinTo = listening && target ? <span class={`cmd-target ${off ? 'off' : ''}`}>Notes pin to: {target}{off ? ' — not on focus tooth' : ''}</span> : null;
  return (
    <div class={`cmd cmd-${state}`} role="status" aria-live="polite">
      <span class="cmd-orb" aria-hidden="true"><i /><i /><i /><i /></span>
      <span class="cmd-phase">{phase === 'Idle' ? 'Voice' : phase === 'Awaiting Confirmation' ? 'Confirm' : phase}</span>
      <div class="cmd-main">
      <p class="cmd-text">
        {listening ? (
          words.length ? words.map((word, index) => <span class="word" key={`${index}-${word}`} style={{ animationDelay: `${Math.min(index, 3) * 18}ms` }}>{word} </span>) : <span class="cmd-wait">Listening…</span>
        ) : (
          <span key={command} class="cmd-line">{command || 'Wave, then speak.'}</span>
        )}
      </p>
      {pinTo}
      </div>
      <span class="cmd-hint">{hint}</span>
    </div>
  );
}

function NotesSection({ notes, scanPoint, training, onPick }: { notes: CaseNote[]; scanPoint: ScanPoint | null; training: DentalTraining; onPick: (note: CaseNote) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <section class="insp insp-notes">
      <h2 class="insp-head"><IconPin size={15} />Notes<span class="count">{notes.length}</span></h2>
      <p class="anchor">
        New notes pin to <b>{scanPoint ? pinLabel(scanPoint) : focusName(training)}</b>
        {scanPoint && offFocus(training, scanPoint.structure) && <em class="off-focus">not on {training.fdi}</em>}
      </p>
      <form class="composer" onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; annotate(draft); setDraft(''); }}>
        <textarea aria-label="Note for this scan" value={draft} placeholder="Add an observation…" rows={2} onInput={(event) => setDraft(event.currentTarget.value)} />
        <button type="submit" class="btn btn-primary" disabled={!draft.trim()}>Add note</button>
      </form>
      {notes.length === 0 ? (
        <p class="meta">No notes on this review yet. Say “add a note…” or type one.</p>
      ) : (
        <ol class="notes">
          {notes.map((note, index) => (
            <li key={note.id}>
              <button type="button" class="note-row" onClick={() => onPick(note)} title={note.anchor?.mm ? 'Show this point on the slices' : undefined}>
                <span class="callout-n">{index + 1}</span>
                <span>
                  <p>{note.text}</p>
                  <small>{note.anchor ? pinLabel(note.anchor) : focusName(training)}</small>
                  {note.anchor && offFocus(training, note.anchor.structure) && <em class="off-focus block">not on {training.fdi}</em>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function InfoPage({ page, clinic, board }: { page: 'dashboard' | 'reports' | 'settings'; clinic: typeof DEFAULT_CLINIC; board: Board }) {
  const [sound, setSound] = useState(true);
  const [hints, setHints] = useState(true);
  if (page === 'dashboard') {
    return (
      <section class="page">
        <h1>Dashboard</h1>
        <p class="lead">A sample board for the clinic day. Nothing here is a live record.</p>
        <table class="table">
          <tbody>
            <tr><th>Open charts</th><td>4 demonstration charts</td></tr>
            <tr><th>Scan library</th><td>10 ToothFairy2 CBCT scans across 5 review focuses</td></tr>
            <tr><th>Messages</th><td>1 note waiting for the front desk</td></tr>
            <tr><th>Gesture board</th><td>{board === 'live' ? 'Live' : board === 'idle' ? 'Not connected' : 'Hub offline'}</td></tr>
          </tbody>
        </table>
      </section>
    );
  }
  if (page === 'reports') {
    return (
      <section class="page">
        <h1>Reports</h1>
        <p class="lead">Sample report names. These are not clinical documents.</p>
        <table class="table">
          <tbody>
            <tr><th>Morning list</th><td>Five review focuses across ten scans</td></tr>
            <tr><th>Message log</th><td>A prescription note was sent to the demonstration patient</td></tr>
            <tr><th>Image check</th><td>Axial, coronal and sagittal views on file</td></tr>
          </tbody>
        </table>
      </section>
    );
  }
  return (
    <section class="page">
      <h1>Settings</h1>
      <p class="lead">Display choices for this screen. They stay on this browser only.</p>
      <table class="table">
        <tbody>
          <tr><th>Command chime</th><td>{sound ? 'On' : 'Off'}</td><td class="act"><button type="button" class="btn" onClick={() => setSound((v) => !v)}>{sound ? 'Turn off' : 'Turn on'}</button></td></tr>
          <tr><th>Training hints</th><td>{hints ? 'Shown' : 'Hidden'}</td><td class="act"><button type="button" class="btn" onClick={() => setHints((v) => !v)}>{hints ? 'Hide' : 'Show'}</button></td></tr>
          <tr><th>Clinic</th><td colSpan={2}>{clinic.hospital} · {clinic.doctor}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
