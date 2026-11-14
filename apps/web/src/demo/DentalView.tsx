/** Visible DentalAI screen. The centre view loads one synthetic dental training case. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { makeCommand, type ViewerCommand } from '@hoverscan/contracts';
import { GESTURE_TEXT } from '../viewer/logic.js';
import { HubClient } from '../app/hub.js';
import { createGestureGate } from './dental-gestures.js';
import { addCaseNote, annotate, emptyNoteBook, notesFor, setAnnotationSink, type CaseNote, type NoteBook } from './annotations.js';
import { DENTAL_TRAININGS } from './dental-anatomy.js';
import { DentalStage, type StageControl } from './DentalStage.js';
import { useHackAssistant } from './hack-session.js';
import { PatientDatabase } from './PatientDatabase.js';
import { openPatientWindow, updatePrescription } from './patient-record.js';

type Page = 'view' | 'dashboard' | 'reports' | 'settings';

export function DentalView() {
  const [page, setPage] = useState<Page>('view');
  const [training, setTraining] = useState(0);
  const [notes, setNotes] = useState<NoteBook>(emptyNoteBook);
  const viewer = useRef<StageControl | null>(null);
  const [gestureLabel, setGestureLabel] = useState('Board idle');
  const [noteMode, setNoteMode] = useState(false);
  const active = DENTAL_TRAININGS[training] ?? DENTAL_TRAININGS[0]!;
  const caseRef = useRef(active.n);
  caseRef.current = active.n;
  useEffect(() => {
    setAnnotationSink((text) => {
      setNotes((book) => addCaseNote(book, caseRef.current, text));
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
      if (action.type === 'note') {
        setNoteMode(true);
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
  });
  return (
    <div class="dv">
      <header class="dv-top">
        <div class="dv-brand">
          <Tooth />
          <div>
            <strong>DentalAI</strong>
            <span>Smart Dental Intelligence</span>
          </div>
        </div>
        <div class="dv-listen">
          <Mic />
          <span>{hack.phase}</span>
        </div>
        <div class="dv-oyo">
          <span class="dv-live" />
          OYO Active
          <img src="/dental/doctor.png" alt="" />
        </div>
      </header>
      <div class="dv-body">
        <nav class="dv-nav">
          <button class={page === 'view' ? 'on' : ''} type="button" onClick={() => setPage('view')}><Tooth />Neuroview</button>
          <button class={page === 'dashboard' ? 'on' : ''} type="button" onClick={() => setPage('dashboard')}><Grid />Dashboard</button>
          <button class={page === 'reports' ? 'on' : ''} type="button" onClick={() => setPage('reports')}><Doc />Reports</button>
          <button class={page === 'settings' ? 'on' : ''} type="button" onClick={() => setPage('settings')}><Gear />Settings</button>
          <div class="dv-hospital">
            <Shield />
            <span>Princeton<br />Medical Center</span>
          </div>
        </nav>
        {page === 'view' ? (
          <NeuroStage training={training} setTraining={setTraining} viewer={viewer} notes={notesFor(notes, active.n)} command={hack.command} gestureLabel={gestureLabel} noteMode={noteMode} />
        ) : (
          <DummyPage page={page} />
        )}
        <aside class="dv-right">
          <article class="dv-card">
            <Pin />
            <div>
              <h2>Current Finding</h2>
              <p class="gold">{active.title}</p>
            </div>
            <Caret />
          </article>
          <article class="dv-card">
            <Spark />
            <div>
              <h2>Explanation</h2>
              <p>{active.explanation}</p>
            </div>
          </article>
          <article class="dv-card">
            <Person />
            <div>
              <h2>Patient</h2>
              <p><b>Alex Johnson</b><br />Age: 34 | Hx: None</p>
            </div>
          </article>
          <article class="dv-card">
            <Building />
            <div>
              <h2>Hospital</h2>
              <p>Princeton Medical Center{hack.hospitalMessage ? <><br />{hack.hospitalMessage}</> : null}</p>
            </div>
          </article>
          <article class="dv-card">
            <Pulse />
            <div>
              <h2>AI Activity</h2>
              <p><span class="dv-live" />{hack.activity}</p>
            </div>
          </article>
          <article class="dv-card">
            <Clock />
            <div>
              <h2>Command Logs</h2>
              <p>{hack.log.length === 0 ? 'No commands yet.' : hack.log.map((line, index) => <span key={`${index}-${line}`}>{line}<br /></span>)}</p>
            </div>
          </article>
          {hack.patientMessage && (
            <div class="dv-toast">
              <Check />
              <p><b>Message sent to patient:</b><br />{hack.patientMessage}</p>
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
  viewer,
  notes,
  command,
  gestureLabel,
  noteMode,
}: {
  training: number;
  setTraining: (index: number) => void;
  viewer: { current: StageControl | null };
  notes: CaseNote[];
  command: string;
  gestureLabel: string;
  noteMode: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const active = DENTAL_TRAININGS[training] ?? DENTAL_TRAININGS[0]!;
  return (
    <section class="dv-stage">
      <div class="dv-menu">
        <button class="dv-menu-head" type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>3D View <Caret /></button>
        {menuOpen && (
          <>
            <button type="button" onClick={() => viewer.current?.apply(mouseCommand({ type: 'zoom', factor: 1.12 }))}><Search />Zoom In</button>
            <button type="button" onClick={() => viewer.current?.apply(mouseCommand({ type: 'zoom', factor: 1 / 1.12 }))}><SearchOut />Zoom Out</button>
            <button type="button" onClick={() => viewer.current?.apply(mouseCommand({ type: 'rotate', yawDeg: 24 }))}><Rotate />Rotate</button>
            <button type="button" onClick={() => { const stage = document.querySelector('.dv-stage'); if (!stage) return; if (document.fullscreenElement) void document.exitFullscreen(); else void stage.requestFullscreen(); }}><Expand />Full Screen</button>
          </>
        )}
      </div>
      <div class="dv-train">
        {DENTAL_TRAININGS.map((item, index) => (
          <button key={item.n} type="button" class={index === training ? 'on' : ''} onClick={() => setTraining(index)}>
            Training {item.n}
          </button>
        ))}
      </div>
      <DentalStage index={active.n} notes={notes} bind={(next) => { viewer.current = next; }} />
      <form class="dv-note-form" onSubmit={(event) => { event.preventDefault(); annotate(draft); setDraft(''); }}>
        <input aria-label="Note for this region" value={draft} placeholder="Note for this region" onInput={(event) => setDraft(event.currentTarget.value)} />
        <button type="submit">Add note</button>
        <button class="dv-record" type="button" onClick={() => openPatientWindow()}>Patient record</button>
      </form>
      <div class="dv-gesture">
        <div class="dv-gesture-head"><Hand />Gesture Controls</div>
        <p><Check />{gestureLabel}</p>
        <p><Check />{noteMode ? 'Note mode' : 'Wave: note'}</p>
      </div>
      <div class="dv-cmd">
        <Orb />
        <span>{noteMode && command.startsWith('Say Hack') ? 'Note mode. Say: Hack, create a note about checking this tooth later.' : command}</span>
        <i />
      </div>
    </section>
  );
}

function DummyPage({ page }: { page: Exclude<Page, 'view'> }) {
  const [sound, setSound] = useState(true);
  const [hints, setHints] = useState(true);
  if (page === 'dashboard') {
    return (
      <section class="dv-page">
        <h1>Dashboard</h1>
        <p class="lead">A sample board for the clinic day. Nothing here is a live record.</p>
        <div class="dv-grid">
          <article class="dv-card"><h2>Open charts</h2><p>4 demonstration charts are on the board.</p></article>
          <article class="dv-card"><h2>Training cases</h2><p>Five reference cases are loaded for teaching.</p></article>
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
        <article class="dv-card"><h2>Morning list</h2><p>Training cases 1 to 5 were opened for review.</p></article>
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
      <article class="dv-card"><h2>Clinic</h2><p>Princeton Medical Center · demonstration seat</p></article>
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
      <path fill="#c4b5fd" d="M12 2l1.6 6.2L20 10l-6.4 1.8L12 18l-1.6-6.2L4 10l6.4-1.8L12 2zm6 12l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
    </svg>
  );
}
function Person() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#93c5fd" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4v2h14v-2c0-2-3-4-7-4z" />
    </svg>
  );
}
function Building() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#c4b5fd" d="M4 20V6l8-3 8 3v14h-5v-5H9v5H4zm6-9h2v2h-2V11zm4 0h2v2h-2v-2z" />
    </svg>
  );
}
function Pulse() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#c4b5fd" d="M3 12h4l2-5 4 10 2-5h6v2h-4l-2 5-4-10-2 5H3v-2z" />
    </svg>
  );
}
function Clock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#c4b5fd" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11h5v-2h-4V6h-2v7h1z" />
    </svg>
  );
}
