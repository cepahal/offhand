/**
 * The only startup screen. View settings start at the defaults on every load.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { patients } from './data.js';
import { classifyUtterance } from './intent-model.js';
import { beginOpenMic } from './voice-listen.js';
import { hear, idleWake, takeCommand, type WakeState } from './wake.js';
import { MriScanner, type ScanCursor } from './MriScanner.js';
import { volumeFromIndex, type NeuroIndex, type NeuroVolume } from './scanner-commands.js';
import { makeNote } from './scan-notes.js';
import {
  applyIntent,
  deleteNote,
  fadeIn,
  freshSession,
  moveView,
  placeNote,
  scanCaption,
  viewOnLoad,
  type MotionName,
  type ScannerSession,
} from './scanner-session.js';
import { gestureAccepted } from './gesture-gate.js';
import type { DemoPatient } from './types.js';

const FIVE = patients.slice(0, 5);

function studiesLatest(patient: DemoPatient) {
  return [...patient.studies].sort((a, b) => b.date.localeCompare(a.date));
}

export function ScannerHome() {
  const [session, setSession] = useState<ScannerSession>(() => freshSession(FIVE));
  const [volume, setVolume] = useState<NeuroVolume | null>(null);
  const [cursor, setCursor] = useState<ScanCursor | null>(null);
  const [wake, setWake] = useState<WakeState>(() => idleWake());
  const [confidence, setConfidence] = useState<number | null>(null);
  const patient = FIVE.find((item) => item.mrn === session.mrn) ?? FIVE[0]!;

  useEffect(() => {
    const view = viewOnLoad(null);
    setSession((current) => ({ ...current, view }));
  }, []);

  useEffect(() => {
    let stop = false;
    void fetch('/casepacks/neuroview/index.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((index: NeuroIndex | null) => {
        if (!stop) setVolume(volumeFromIndex(index));
      })
      .catch(() => {
        if (!stop) setVolume(null);
      });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    const sessionMic = beginOpenMic({
      onInterim(text) {
        setWake((current) => hear(current, text, Date.now()));
      },
      onText(text) {
        setWake((current) => {
          const heard = hear(current, text, Date.now());
          window.setTimeout(() => {
            setWake((latest) => {
              const taken = takeCommand(latest, Date.now());
              if (taken.command) {
                void classifyUtterance(taken.command).then((hit) => {
                  setSession((prev) => {
                    const next = applyIntent(prev, hit, FIVE);
                    if (hit.intent === 'place_note' && cursor && hit.value) {
                      const note = makeNote(
                        { scanName: volume?.scanName ?? 'none', sliceIndex: prev.view.slice, coordinates: cursor.pointer.coordinates },
                        'note',
                        hit.value,
                        prev.mrn,
                        new Date().toISOString(),
                      );
                      void fetch('/demo-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note) });
                      return placeNote(next, note);
                    }
                    if (next.fade === 'out') window.setTimeout(() => setSession((cur) => fadeIn(cur)), 280);
                    return next;
                  });
                });
              }
              return taken.state;
            });
          }, 1200);
          return heard;
        });
      },
      onError(message) {
        setSession((current) => ({ ...current, say: message }));
      },
    });
    return () => sessionMic.stop();
  }, [cursor, volume]);

  const caption = scanCaption(!!volume, volume?.caseId ?? '');
  const shownNotes = useMemo(() => session.notes.filter((note) => note.mrn === patient.mrn), [session.notes, patient.mrn]);

  function onGesture(name: MotionName, score: number) {
    setConfidence(score);
    if (!gestureAccepted(score)) return;
    setSession((current) => {
      const moved = moveView(current.view, name, score, true);
      return { ...current, view: moved.view };
    });
  }

  return (
    <div class="scanner-home">
      <header class="scanner-top">
        <strong>Scanner</strong>
        <span class="muted">Listening for “hack”. {wake.phase === 'capture' ? wake.buffer : 'Gestures keep the mic on.'}</span>
        {confidence != null && <span>Gesture {Math.round(confidence * 100)}%</span>}
      </header>
      <div class="scanner-body">
        <aside class="scanner-cards">
          {FIVE.map((item) => (
            <button key={item.mrn} type="button" class={item.mrn === patient.mrn ? 'on' : ''} onClick={() => setSession((current) => ({ ...applyIntent(current, { intent: 'view_mri', confidence: 1, person: item.name, value: '', say: '' }, FIVE), fade: 'out' }))}>
              <b>{item.name}</b>
              <span>MRN {item.mrn} · age {item.age}</span>
              <span>{item.procedure}</span>
            </button>
          ))}
        </aside>
        <section class={`scanner-stage ${session.fade === 'out' ? 'fade-out' : 'fade-in'}`}>
          <article class="patient-card">
            <h1>{patient.name}</h1>
            <p>MRN {patient.mrn} · age {patient.age}</p>
            <p>{patient.procedure}</p>
            <p>Medication: {patient.medications.join('; ')}</p>
            <p>Allergies: {patient.allergies.join('; ')}</p>
            <ul>
              {patient.history.map((row) => (
                <li key={row.date}>{row.text}</li>
              ))}
            </ul>
            <h2>MRI studies</h2>
            <ol>
              {studiesLatest(patient).map((study) => (
                <li key={study.id}>
                  {study.date} {study.modality} {study.sequence}
                </li>
              ))}
            </ol>
          </article>
          <div class="scanner-view">
            <p class="small">zoom {session.view.zoom} · yaw {session.view.yaw} · peel {session.view.peel} · slice {session.view.slice}</p>
            {volume ? <MriScanner volume={volume} pins={[]} nudge={{ tick: 0, delta: 1 }} onCursor={setCursor} /> : <p class="mri-empty" data-mri-placeholder>{caption}</p>}
            {volume && <p class="mri-caption">{caption}</p>}
            {shownNotes.map((note) => (
              <div key={note.at} class="mri-sticky mri-sticky-white">
                <span>{note.text}</span>
                <button type="button" onClick={() => setSession((current) => deleteNote(current, note.at))}>Delete</button>
              </div>
            ))}
          </div>
        </section>
      </div>
      {session.pending && (
        <div class="white-box" data-pending>
          <p>Pending {session.pending.kind} for {session.pending.name}</p>
          <p>{session.pending.after}</p>
          <button type="button" onClick={() => setSession((current) => applyIntent(current, { intent: 'confirm', confidence: 1, person: '', value: '', say: '' }, FIVE))}>Confirm</button>
        </div>
      )}
      {session.table && (
        <table class="white-table">
          <caption>{session.table.title}</caption>
          <tbody>
            {session.table.rows.map((row) => (
              <tr key={row}><td>{row}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {session.comparison && (
        <div class="compare-row">
          <div>{session.comparison.before.join('; ')}</div>
          <div>{session.comparison.after.join('; ')}</div>
        </div>
      )}
      {session.say && <p class="scanner-say">{session.say}</p>}
      <footer class="screen-footer">For communication and education. Not for diagnosis.</footer>
      <div class="gesture-pad" hidden>
        {(['left', 'right', 'up', 'down', 'forward', 'backward', 'cw', 'ccw'] as MotionName[]).map((name) => (
          <button key={name} type="button" data-gesture={name} onClick={() => onGesture(name, 0.9)}>{name}</button>
        ))}
      </div>
    </div>
  );
}
