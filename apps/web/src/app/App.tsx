/**
 * The one screen. Top bar (case, visit, source credit); left: 3D view and slice panel; right: the
 * current finding, its explanation and rulebook badge, voice and typed input, then the share
 * controls and timeline; footer: the disclaimer.
 *
 * The explanation shown here is the hub's latest VerifiedText, unchanged. It is the only text that
 * can be read aloud or sent, and only while its status is "verified". The hub enforces the same
 * rule again, so a disabled button here is a convenience, not the safety mechanism.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CasePackManifest, VerifiedText } from '@hoverscan/contracts';
import { controller } from './controller.js';
import { ui, useStore, type TimelineRow } from './store.js';
import { badgeFor, canSend } from './timeline.js';
import { listenOnce, readAloud, readAloudSupported, stopReading, voiceSupported, VOICE_NEEDS_CHROME } from './speech.js';
import { patients } from '../demo/data.js';
import { beginOpenMic } from '../demo/voice-listen.js';
import { hear, idleWake, takeCommand, type WakeState } from '../demo/wake.js';
import { confirmResult, gestureSignal, planAction, understoodLine, validateModelOutput, type ActionResult, type GestureTick } from '../demo/openai-actions.js';
import { installKeyboard } from '../input/keyboard.js';
import { SlicePanel } from '../slices/SlicePanel.js';
import { orderedTimepoints } from '../viewer/logic.js';
import { regionKindFromSources, regionLabel } from '../viewer/palette.js';
import { ViewerPane } from '../viewer/ViewerPane.js';

export const DISCLAIMER = 'For communication and education. Not for diagnosis.';
const send = controller.dispatch.bind(controller);

export function App() {
  const s = useStore(ui);
  useEffect(() => installKeyboard(controller), []);

  return (
    <div class="screen">
      <TopBar />
      <main class="screen-main">
        <section class="screen-left">
          <div class="screen-3d">
            <ViewerPane />
          </div>
          {s.manifest && s.manifest.volumes.length > 0 && (
            <div class="screen-slices">
              <SlicePanel />
            </div>
          )}
        </section>
        <aside class="screen-right">
          <FindingCard />
          <ExplanationCard />
          <PatientCard />
          <AskBox />
          <ShareCard />
          <GestureSignal />
        </aside>
      </main>
      <footer class="screen-footer">{DISCLAIMER}</footer>
    </div>
  );
}

function TopBar() {
  const s = useStore(ui);
  const m = s.manifest;
  const tps = m ? orderedTimepoints(m) : [];
  const i = Math.min(s.view?.timepoint ?? 0, Math.max(0, tps.length - 1));
  const current = m ? `${m.app}/${m.caseId}` : '';
  const locals = controller.localCases();
  const credit = s.caseConfig?.credit ?? (m ? `Source: ${m.source.dataset} (${m.source.license})` : '');
  const hubOk = s.hub === 'open';
  return (
    <header class="screen-top">
      <select
        class="case-select"
        aria-label="Case"
        value={current}
        onChange={(e) => {
          const [app, caseId] = (e.target as HTMLSelectElement).value.split('/');
          if (app && caseId) send({ type: 'load_case', app, caseId }, 'mouse');
        }}
      >
        {!m && <option value="">{s.loading ?? 'Choose a case…'}</option>}
        {s.cases.map((c) => (
          <option key={`${c.app}/${c.caseId}`} value={`${c.app}/${c.caseId}`}>
            {c.title}
          </option>
        ))}
        {locals.length > 0 && (
          <optgroup label="Mock shapes (not anatomy)">
            {locals.map((c) => (
              <option key={`${c.app}/${c.caseId}`} value={`${c.app}/${c.caseId}`}>
                {c.title}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {tps.length > 1 ? (
        <div class="timepoint">
          <button disabled={i === 0} onClick={() => send({ type: 'timepoint', index: i - 1 }, 'mouse')} aria-label="Previous visit">
            ◀
          </button>
          <span>{tps[i]!.label}</span>
          <button disabled={i === tps.length - 1} onClick={() => send({ type: 'timepoint', index: i + 1 }, 'mouse')} aria-label="Next visit">
            ▶
          </button>
        </div>
      ) : (
        <div class="timepoint">{tps[0]?.label ?? ''}</div>
      )}
      <div class="credit" title={credit}>
        {credit}
      </div>
      <div class={`hub-dot ${hubOk ? 'ok' : 'down'}`} title={hubOk ? 'Hub connected' : 'Hub offline'}>
        {hubOk ? 'hub' : 'hub offline'}
      </div>
    </header>
  );
}

function focusedFinding(m: CasePackManifest | null, id: string | null | undefined) {
  return m?.findings.find((f) => f.id === id);
}

function FindingCard() {
  const s = useStore(ui);
  const m = s.manifest;
  const f = focusedFinding(m, s.view?.focusedFindingId);
  const kind = m ? regionKindFromSources(`${m.source.dataset} ${m.findings.map((item) => item.label).join(' ')}`) : null;
  return (
    <section class="card">
      <h2>Current finding</h2>
      {!m ? (
        <p class="muted">No case loaded.</p>
      ) : m.findings.length === 0 ? (
        <p class="muted">This case has no findings.</p>
      ) : f ? (
        <>
          <p class="finding-label">{s.mock ? `${f.label} (mock target, not anatomy)` : f.label}</p>
          {kind && <p class="muted">{regionLabel(kind)}</p>}
          {f.reportExcerpt && <p class="measured">{f.reportExcerpt}</p>}
        </>
      ) : (
        <>
          <p class="muted">None selected. Say "show the finding" or use Next.</p>
          {kind && <p class="muted">{regionLabel(kind)}</p>}
        </>
      )}
      {m && m.findings.length > 0 && (
        <div class="row-buttons">
          <button onClick={() => send({ type: 'focus_finding', findingId: 'prev' }, 'mouse')}>Previous</button>
          <button onClick={() => send({ type: 'focus_finding', findingId: 'next' }, 'mouse')}>Next</button>
          <button onClick={() => send({ type: 'reset_view' }, 'mouse')}>Reset view</button>
        </div>
      )}
    </section>
  );
}

function ExplanationCard() {
  const s = useStore(ui);
  const [speaking, setSpeaking] = useState(false);
  const vt = s.verified;

  // A new explanation (or a downgrade) always stops whatever was being read.
  useEffect(() => {
    stopReading();
    setSpeaking(false);
  }, [vt]);
  useEffect(() => () => stopReading(), []);

  const f = focusedFinding(s.manifest, s.view?.focusedFindingId);
  return (
    <section class="card">
      <h2>Explanation</h2>
      {vt ? <Explanation vt={vt} /> : <p class="muted">Nothing explained yet. Say "explain it" or press Explain.</p>}
      <div class="row-buttons">
        <button disabled={!f || s.hub !== 'open' || s.mock} onClick={() => send({ type: 'explain' }, 'mouse')}>
          Explain
        </button>
        {speaking ? (
          <button
            class="stop"
            onClick={() => {
              stopReading();
              setSpeaking(false);
            }}
          >
            ■ Stop reading
          </button>
        ) : (
          <button
            disabled={!canSend(vt) || !readAloudSupported()}
            title={canSend(vt) ? 'Read the explanation aloud' : 'Only text checked against the rulebook is read aloud'}
            onClick={() => setSpeaking(readAloud(vt, () => setSpeaking(false)))}
          >
            Read aloud
          </button>
        )}
      </div>
    </section>
  );
}

function Explanation({ vt }: { vt: VerifiedText }) {
  const b = badgeFor(vt);
  return (
    <>
      <p class={`explanation ${b.tone}`}>{vt.text}</p>
      <div class={`badge ${b.tone}`}>
        {b.label}
        {vt.checker === 'mock' && <span class="badge-note"> (mock check, development only)</span>}
      </div>
      {b.reason && <p class="reason">{b.reason}</p>}
    </>
  );
}

function PatientCard() {
  const five = patients.slice(0, 5);
  return (
    <section class="card">
      <h2>Patient</h2>
      {five.map((patient) => (
        <p key={patient.mrn}>
          <b>{patient.name}</b> MRN {patient.mrn} · age {patient.age}
          <span class="muted"> {patient.procedure}</span>
        </p>
      ))}
    </section>
  );
}

function AskBox() {
  const s = useStore(ui);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [heard, setHeard] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const wake = useRef<WakeState>(idleWake());
  const hasVoice = voiceSupported();
  const reply = s.voiceReply;

  const applyTranscript = (transcript: string) => {
    setHeard(transcript);
    const planned = planAction(validateModelOutput({ action: 'ask', question: 'Waiting for the model.' }), '');
    setResult({ ...planned, error: null, understood: 'Waiting for the model.' });
    void fetch('/api/voice/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript, patients: patients.slice(0, 5).map((p) => ({ name: p.name, mrn: p.mrn })) }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('model');
        return response.json() as Promise<unknown>;
      })
      .then((raw) => {
        const action = validateModelOutput(raw);
        const named = 'patient' in action ? action.patient : '';
        const patient = patients.find((item) => item.name.toLowerCase() === named.toLowerCase());
        const before = patient?.medications.join('; ') ?? '';
        setResult(planAction(action, before));
      })
      .catch(() => {
        setResult(planAction({ action: 'ask', question: 'I could not reach the model. Nothing was changed.' }, ''));
      });
  };

  useEffect(() => {
    const mic = beginOpenMic({
      onInterim(value) {
        wake.current = hear(wake.current, value, Date.now());
        setInterim(wake.current.buffer);
      },
      onText(value) {
        wake.current = hear(wake.current, value, Date.now());
        window.setTimeout(() => {
          const taken = takeCommand(wake.current, Date.now());
          wake.current = taken.state;
          if (taken.command) applyTranscript(taken.command);
        }, 1200);
      },
      onError: setMicError,
    });
    return () => mic.stop();
  }, []);

  const toggleMic = () => {
    if (stop.current) {
      stop.current();
      return;
    }
    setMicError(null);
    stop.current = listenOnce({
      onInterim: setInterim,
      onFinal: (t) => {
        setInterim('');
        controller.say(t);
      },
      onError: setMicError,
      onEnd: () => {
        stop.current = null;
        setListening(false);
        setInterim('');
      },
    });
    setListening(!!stop.current);
  };

  return (
    <section class="card">
      <h2>Ask</h2>
      <div class="ask">
        {hasVoice ? (
          <button class={`mic ${listening ? 'on' : ''}`} onClick={toggleMic} disabled={s.hub !== 'open'} aria-pressed={listening}>
            {listening ? '● Listening… (click to stop)' : '🎤 Speak'}
          </button>
        ) : (
          <p class="muted">{VOICE_NEEDS_CHROME}</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (controller.say(text)) setText('');
          }}
        >
          <input
            type="text"
            value={text}
            placeholder='Type a request, e.g. "show the finding"'
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            aria-label="Typed request"
          />
          <button type="submit" disabled={!text.trim() || s.hub !== 'open'}>
            Send
          </button>
        </form>
      </div>
      {interim && <p class="muted">Hearing: {interim}</p>}
      {heard && <p>Heard: {heard}</p>}
      {result && <p>Understood as: {result.understood || understoodLine(result.action)}</p>}
      {result?.pending && (
        <p class="measured">
          {result.pending.field}: {result.pending.before || '—'} → {result.pending.after}
        </p>
      )}
      {result?.table && (
        <table class="white-table">
          <tbody>
            {result.table.map((row) => (
              <tr key={row}>
                <td>{row}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result?.note && <p class="measured">{result.note}</p>}
      {result?.error && <p class="reason">{result.error}</p>}
      {result?.pending && (
        <button
          type="button"
          onClick={() => setResult((current) => (current ? confirmResult(current) : current))}
        >
          Confirm
        </button>
      )}
      {micError && <p class="reason">{micError}</p>}
      {reply && (
        <div class={`reply ${reply.error ? 'error' : ''}`}>
          {reply.heard && <div class="muted">You: {reply.heard}</div>}
          <div>{reply.text}</div>
        </div>
      )}
    </section>
  );
}

const TIMELINE_ICON: Record<TimelineRow['kind'], string> = {
  sent: '✉',
  delivered: '✓',
  read: '👁',
  vote: '☑',
  reaction: '♥',
  error: '✕',
  status: '•',
};

function GestureSignal() {
  const s = useStore(ui);
  const [now, setNow] = useState(() => Date.now());
  const [events, setEvents] = useState<GestureTick[]>([]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const g = s.lastGesture;
    if (!g) return;
    setEvents((current) => [...current.slice(-12), { name: g.name, at: g.at }]);
  }, [s.lastGesture]);
  const port = s.modules.gesture?.detail?.split(' ').find((part) => part.startsWith('/dev/') || part.startsWith('COM')) ?? 'auto';
  const portName = port.split('/').pop() ?? port;
  return (
    <section class="card">
      <h2>Gesture signal</h2>
      <p>{gestureSignal(events, now, portName)}</p>
      <ol class="timeline">
        {events.map((event) => (
          <li key={`${event.at}-${event.name}`}>
            {event.name} <time>{new Date(event.at).toLocaleTimeString()}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ShareCard() {
  const s = useStore(ui);
  const vt = s.verified;
  const confirmFor = s.pending.confirmFor;
  const ok = canSend(vt) && s.hub === 'open' && !s.mock;
  return (
    <section class="card">
      <h2>Patient</h2>
      <div class="row-buttons">
        <button disabled={!ok || !!confirmFor} onClick={() => send({ type: 'share_to_patient', bookmarkIds: [] }, 'mouse')}>
          Send to patient
        </button>
        <button class="confirm" disabled={!ok || !confirmFor} onClick={() => confirmFor && send({ type: 'confirm', for: confirmFor }, 'mouse')}>
          Confirm
        </button>
        <button disabled={!confirmFor} onClick={() => confirmFor && send({ type: 'cancel', for: confirmFor }, 'mouse')}>
          Cancel
        </button>
      </div>
      {confirmFor && <p class="muted">Waiting for your Confirm. Nothing has been sent.</p>}
      {vt && !canSend(vt) && <p class="reason">Sending is off: the explanation is not checked against the rulebook.</p>}
      <ol class="timeline">
        {s.timeline.length === 0 && <li class="muted">Nothing sent yet.</li>}
        {[...s.timeline].reverse().map((r) => (
          <li key={`${r.at}-${r.kind}-${r.text}`} class={`tl-${r.kind}`}>
            <span class="tl-icon">{TIMELINE_ICON[r.kind]}</span>
            <span class="tl-text">{r.text}</span>
            <time>{new Date(r.at).toLocaleTimeString()}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
