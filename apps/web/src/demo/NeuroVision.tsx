/**
 * DentalView screen. The project name stays HoverScan.
 * Each shows the single visit that has the most labelled lesions.
 * The transcript is not shown. The command and the action are.
 */
import { useEffect, useState } from 'preact/hooks';
import type { BusEnvelope } from '@hoverscan/contracts';
import { patients } from './data.js';
import { HubClient } from '../app/hub.js';
import { actionFromModel, actionFromText, commandLabel, type AlexAction } from './alex-commands.js';
import { hear, idleWake, takeCommand, type WakeState } from './wake.js';
import { beginOpenMic } from './voice-listen.js';
import { gestureSignal, type GestureTick } from './openai-actions.js';

const ALEX = patients.find((patient) => patient.mrn === '123132') ?? patients[0]!;

const TRAININGS = [
  { n: '1', caseId: 'isbi2015-training01', file: 'volumes/flair-visit-02.nii.gz', lesions: 5 },
  { n: '2', caseId: 'isbi2015-training02', file: 'volumes/flair-visit-03.nii.gz', lesions: 7 },
  { n: '3', caseId: 'isbi2015-training03', file: 'volumes/flair-visit-03.nii.gz', lesions: 2 },
  { n: '4', caseId: 'isbi2015-training04', file: 'volumes/flair-visit-02.nii.gz', lesions: 3 },
  { n: '5', caseId: 'isbi2015-training05', file: 'volumes/flair-visit-02.nii.gz', lesions: 8 },
] as const;

interface Draft {
  action: AlexAction;
  label: string;
  confirmed: boolean;
}

export function NeuroVision() {
  const [section, setSection] = useState<'view' | 'dashboard' | 'reports' | 'settings'>('view');
  const [training, setTraining] = useState(0);
  const [meds, setMeds] = useState(ALEX.medications);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [table, setTable] = useState<'history' | 'prescription' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [patientText, setPatientText] = useState('');
  const [hospitalText, setHospitalText] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [events, setEvents] = useState<GestureTick[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [port, setPort] = useState('hub offline');
  const [hub, setHub] = useState('closed');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const scan = TRAININGS[training] ?? TRAININGS[0];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const client = new HubClient();
    client.onStatus(setHub);
    client.on((env: BusEnvelope) => {
      if (env.ch === 'gesture' && env.ev.t === 'g') {
        const name = env.ev.g;
        setEvents((current) => [...current.slice(-20), { name, at: Date.now() }]);
      }
    });
    client.connect();
    const health = window.setInterval(() => {
      void fetch('/api/health')
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { modules?: { gesture?: { detail?: string } } } | null) => {
          const detail = body?.modules?.gesture?.detail ?? '';
          const name = detail.split(/[\\/]/).pop()?.split(' ')[0];
          if (name) setPort(name);
        })
        .catch(() => setPort('hub offline'));
    }, 3000);
    return () => {
      window.clearInterval(health);
    };
  }, []);

  function run(action: AlexAction): void {
    const label = commandLabel(action);
    setError(action.action === 'ask' ? action.question : '');
    const brief = label.split(/\s+/).slice(0, 8).join(' ');
    setLog((current) => [brief, ...current].slice(0, 8));
    if (action.action === 'ask') return;
    if (action.action === 'view_history') setTable('history');
    if (action.action === 'view_prescription') setTable('prescription');
    if (action.action === 'view_mri') setTable(null);
    if (action.action === 'add_note') setNote(action.text);
    if (action.action === 'change_prescription') {
      setTable('prescription');
      setDraft({ action, label, confirmed: false });
      setCursor({ x: window.innerWidth - 180, y: 280 });
      return;
    }
    if (action.action === 'message_hospital' || action.action === 'message_patient') {
      setDraft({ action, label, confirmed: false });
    }
  }

  function confirm(): void {
    if (!draft || draft.confirmed) return;
    const action = draft.action;
    if (action.action === 'change_prescription') {
      setMeds((current) => [action.value, ...current.slice(1)]);
      setCursor(null);
    }
    if (action.action === 'message_hospital') setHospitalText(`MRN ${ALEX.mrn}: ${action.text}`);
    if (action.action === 'message_patient') setPatientText(`MRN ${ALEX.mrn}: ${action.text}`);
    setDraft({ ...draft, confirmed: true });
  }

  useEffect(() => {
    let wake: WakeState = idleWake();
    const mic = beginOpenMic({
      onInterim(value) {
        wake = hear(wake, value, Date.now());
      },
      onText(value) {
        wake = hear(wake, value, Date.now());
        window.setTimeout(() => {
          const taken = takeCommand(wake, Date.now());
          wake = taken.state;
          const command = taken.command;
          if (!command) return;
          void fetch('/api/voice/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ transcript: command, patients: [{ name: ALEX.name, mrn: ALEX.mrn }] }),
          })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((raw) => run(raw ? actionFromModel(raw) : actionFromText(command)))
            .catch(() => run(actionFromText(command)));
        }, 1200);
      },
      onError() {
        setError('Microphone needs Chrome.');
      },
    });
    return () => mic.stop();
  }, []);

  return (
    <div class="nv">
      <aside class="nv-side">
        <button class={section === 'view' ? 'on' : ''} type="button" onClick={() => setSection('view')}>DentalView</button>
        <button class={section === 'dashboard' ? 'on' : ''} type="button" onClick={() => setSection('dashboard')}>Dashboard</button>
        <button class={section === 'reports' ? 'on' : ''} type="button" onClick={() => setSection('reports')}>Reports</button>
        <button class={section === 'settings' ? 'on' : ''} type="button" onClick={() => setSection('settings')}>Settings</button>
      </aside>
      <main class="nv-main">
        <header class="nv-top">
          <div class="nv-brand"><span class="nv-logo" aria-hidden="true" />DentalView<span>Northbank University Hospital</span></div>
          <div class="nv-listen">Listening for your command...</div>
          <div class="nv-status"><span class={`nv-dot ${hub === 'open' ? 'ok' : ''}`} />{hub === 'open' ? 'Connected' : 'Offline'} · {hub === 'open' ? 'OYO Active' : 'OYO idle'}</div>
          <div class="nv-doctor" title="Clinician">MH</div>
        </header>
        <div class="nv-stage">
          {section === 'view' && (
            <div class="nv-render">
              <DentalStage study={scan.n} note={note} onDeleteNote={() => setNote(null)} />
              <div class="nv-tabs">
                {TRAININGS.map((item, index) => (
                  <button key={item.caseId} type="button" class={`nv-tab ${index === training ? 'on' : ''}`} onClick={() => setTraining(index)}>
                    Study {item.n}
                  </button>
                ))}
              </div>
            </div>
          )}
          {section === 'dashboard' && (
            <section class="nv-card">
              <h2>Dashboard</h2>
              <p>{gestureSignal(events, now, port)}</p>
            </section>
          )}
          {section === 'reports' && (
            <section class="nv-card">
              <h2>Reports</h2>
              <ul class="nv-log">{log.length === 0 ? <li>No reports yet.</li> : log.map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
          )}
          {section === 'settings' && (
            <section class="nv-card">
              <h2>Settings</h2>
              <p>Board: {port}</p>
              <p>{hub === 'open' ? 'Hub connected.' : 'Hub offline.'}</p>
            </section>
          )}
        </div>
      </main>
      <aside class="nv-right">
        <section class="nv-card">
          <h2>Current Finding</h2>
          <p class="nv-lesion">Lesion #1</p>
          <p>Lower molar region. Demonstration only.</p>
        </section>
        <section class="nv-card">
          <h2>Explanation</h2>
          <p>Possible lesion in the lower molar region. Monitor closely.</p>
        </section>
        <section class="nv-card">
          <h2>Patient</h2>
          <p>{patientText || 'Nothing waiting.'}</p>
        </section>
        <section class="nv-card">
          <h2>Hospital</h2>
          <p>{hospitalText || 'Nothing waiting.'}</p>
        </section>
        {draft && !draft.confirmed && (
          <section class="nv-card">
            <h2>Command</h2>
            <p>{draft.label}</p>
            <button type="button" onClick={confirm}>Confirm</button>
          </section>
        )}
        {table && (
          <section class="nv-white" data-table={table}>
            <table>
              <tbody>
                {table === 'history' ? (
                  <>
                    {ALEX.allergies.map((row) => <tr key={row}><td>{row}</td></tr>)}
                    {ALEX.history.map((row) => <tr key={row.date}><td>{row.text}</td></tr>)}
                  </>
                ) : (
                  meds.map((row) => <tr key={row}><td>{row}</td></tr>)
                )}
              </tbody>
            </table>
          </section>
        )}
        {error && <p class="nv-card">{error}</p>}
        <section class="nv-card">
          <h2>AI Activity</h2>
          <p>{draft ? draft.label.split(/\s+/).slice(0, 8).join(' ') : 'Waiting for a command.'}</p>
        </section>
        <section class="nv-card">
          <h2>Command Logs</h2>
          <ul class="nv-log">{log.length === 0 ? <li>No commands yet.</li> : log.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      </aside>
      {cursor && <div class="nv-cursor" style={{ left: `${cursor.x}px`, top: `${cursor.y}px` }} />}
    </div>
  );
}

function DentalStage({ study, note, onDeleteNote }: { study: string; note: string | null; onDeleteNote: () => void }) {
  return (
    <div class="dental-stage" aria-label={`Dental study ${study}`}>
      <svg viewBox="0 0 640 360" role="img">
        <title>Dental arches</title>
        <ellipse cx="320" cy="150" rx="210" ry="78" fill="#c45b6a" />
        <ellipse cx="320" cy="150" rx="168" ry="52" fill="#1a1a1a" />
        {Array.from({ length: 14 }, (_, i) => {
          const x = 130 + i * 30;
          return <rect key={i} x={x} y="118" width="22" height="34" rx="6" fill={i === 10 ? '#f5d76e' : '#f4f1ea'} stroke="#d7d1c6" />;
        })}
        <ellipse cx="320" cy="250" rx="170" ry="58" fill="#b84d5c" />
        <ellipse cx="320" cy="250" rx="128" ry="36" fill="#1a1a1a" />
        {Array.from({ length: 12 }, (_, i) => {
          const x = 160 + i * 28;
          return <rect key={i} x={x} y="228" width="20" height="30" rx="6" fill="#f7f4ee" stroke="#d7d1c6" />;
        })}
      </svg>
      <div class="dental-planes">
        <span>Axial</span>
        <span>Coronal</span>
        <span>Sagittal</span>
      </div>
      {note && <div class="nv-note">{note}<button type="button" onClick={onDeleteNote}>Delete</button></div>}
    </div>
  );
}
