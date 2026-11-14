/** Demonstration hospital chart. Edits stay pending until Confirm. Nothing is sent. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { hospitals, hitlItems, patients, policies } from './data.js';
import {
  DEMO_DATA_LABEL,
  DEMO_PLACE,
  DEMO_SOFTWARE_BANNER,
  FIELD_LABELS,
  PENDING_LABEL,
  SIGNED_IN_SURGEON,
  auditEntries,
  baseFieldText,
  confirmEdit,
  discardEdit,
  fieldState,
  formatScheduled,
  hospitalById,
  proposeEdit,
  searchPatients,
  siteById,
  theatreById,
  toggleHitl,
  togglePolicy,
} from './logic.js';
import { go, parseAppRoute } from './router.js';
import { loadEdits, loadSession, saveEdits, saveSession } from './storage.js';
import {
  CLINICIAN_APPROVAL_POLICY,
  advanceSimulated,
  emptyMessaging,
  phonePanels,
  releaseMessage,
  type MessagingState,
  type PersistedRole,
} from '../../../hub/src/messaging/demo-messages.js';
import { MriScanner, type ScanCursor } from './MriScanner.js';
import { emptyVoiceMemory, handleUtterance, type MessageDraft, type VoiceMemory } from './voice-apply.js';
import { EMERGENCY_TEXT, VIEWER_EVENT_NAME } from './voice-intent.js';
import { latestStudy, patientRegionLabel, viewerCommand, type DemoViewerCommand } from './viewer-commands.js';
import { beginHold, beginOpenMic, speakReply, type HoldSession } from './voice-listen.js';
import type { ScanNote } from './scan-notes.js';
import { applyGesture, phraseForGesture, volumeFromIndex, type NeuroIndex, type NeuroVolume, type ScannerGesture } from './scanner-commands.js';
import type { AppSection, ChartEdit, ChartField, DemoPatient, DemoStudy, OnboardingDraft } from './types.js';

interface OpenViewer {
  patient: DemoPatient;
  study: DemoStudy;
  label: string;
  surround: number;
}

function emitViewer(command: DemoViewerCommand | null): void {
  if (!command) return;
  window.dispatchEvent(new CustomEvent(VIEWER_EVENT_NAME, { detail: command }));
}

const NAV: { id: AppSection; label: string; href: string }[] = [
  { id: 'patients', label: 'Patients', href: '/demo/app/patients' },
  { id: 'surgery', label: 'Surgery', href: '/demo/app/surgery' },
  { id: 'imaging', label: 'Imaging', href: '/demo/app/imaging' },
  { id: 'messages', label: 'Messages', href: '/demo/app/messages' },
  { id: 'wards', label: 'Ward map', href: '/demo/app/wards' },
  { id: 'theatres', label: 'Theatre schedule', href: '/demo/app/theatres' },
  { id: 'audit', label: 'Audit log', href: '/demo/app/audit' },
  { id: 'settings', label: 'Settings', href: '/demo/app/settings' },
];

const WARDS = [
  { name: 'Maple', level: 'Level 2', beds: 18, occupied: 14 },
  { name: 'Cedar', level: 'Level 2', beds: 16, occupied: 11 },
  { name: 'Willow', level: 'Level 3', beds: 20, occupied: 17 },
  { name: 'Oak', level: 'Level 3', beds: 12, occupied: 6 },
];

const THEATRE_BOARD = [
  { name: 'Theatre 1', state: 'Turnover' },
  { name: 'Theatre 2', state: 'Available' },
  { name: 'Theatre 5', state: 'In use' },
];

function useClock(): Date {
  const [value, setValue] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setValue(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return value;
}

function defaultSettings(): OnboardingDraft {
  const stored = loadSession();
  return {
    hospitalId: DEMO_PLACE.hospitalId,
    siteId: DEMO_PLACE.siteId,
    theatreId: DEMO_PLACE.theatreId,
    policyIds: stored?.policyIds?.length ? stored.policyIds : policies.filter((policy) => policy.required).map((policy) => policy.id),
    hitl: stored && Object.keys(stored.hitl).length > 0 ? stored.hitl : Object.fromEntries(hitlItems.map((item) => [item.id, true])),
  };
}

export function HospitalApp({ locationKey }: { locationKey: string }) {
  const pathname = locationKey.split('?')[0] ?? locationKey;
  const query = new URLSearchParams(locationKey.split('?')[1] ?? '').get('q') ?? '';
  const route = parseAppRoute(pathname);
  const [settings, setSettings] = useState<OnboardingDraft>(defaultSettings);
  const [edits, setEdits] = useState<ChartEdit[]>(loadEdits);
  const [command, setCommand] = useState('');
  const now = useClock();
  const [viewer, setViewer] = useState<OpenViewer | null>(null);
  const [volumeState, setVolumeState] = useState<{ status: 'loading' } | { status: 'missing' } | { status: 'ready'; volume: NeuroVolume }>({ status: 'missing' });
  const [notes, setNotes] = useState<ScanNote[]>([]);
  const [pins, setPins] = useState<{ text: string; x: number; y: number }[]>([]);
  const [nudge, setNudge] = useState<{ tick: number; delta: -1 | 1 }>({ tick: 0, delta: 1 });
  const cursorRef = useRef<ScanCursor | null>(null);
  const scanRef = useRef<{ notes: readonly ScanNote[]; pointer: ScanCursor['pointer'] | null; volumeLoaded: boolean }>({ notes: [], pointer: null, volumeLoaded: false });
  const scannerOpenRef = useRef(false);
  scannerOpenRef.current = viewer !== null;
  scanRef.current = { notes, pointer: cursorRef.current?.pointer ?? scanRef.current.pointer, volumeLoaded: volumeState.status === 'ready' };
  const [voice, setVoice] = useState<VoiceMemory>(emptyVoiceMemory);
  const [mail, setMail] = useState<MessagingState>(emptyMessaging);
  const mailRef = useRef(mail);
  mailRef.current = mail;
  const [photonMode, setPhotonMode] = useState<'live' | 'simulated'>('simulated');
  const modeRef = useRef(photonMode);
  modeRef.current = photonMode;
  const [card, setCard] = useState<{ heard: string; doing: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const hold = useRef<HoldSession | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const editsRef = useRef(edits);
  editsRef.current = edits;

  useEffect(() => {
    document.title = 'HoverScan demonstration — chart';
  }, []);
  useEffect(() => {
    const onView = (event: Event) => {
      const command = (event as CustomEvent<DemoViewerCommand>).detail;
      if (!command) return;
      const person = patients.find((item) => item.mrn === command.mrn);
      if (!person) return;
      if (command.type === 'open_mri') {
        const study = person.studies.find((item) => item.id === command.studyId);
        if (!study) return;
        setViewer({ patient: person, study, label: patientRegionLabel(person), surround: 1 });
        return;
      }
      if (command.type === 'show_region') {
        setViewer((prev) => {
          const study = prev?.patient.mrn === person.mrn ? prev.study : latestStudy(person);
          if (!study) return prev;
          return { patient: person, study, label: command.label, surround: command.surroundOpacity };
        });
        return;
      }
      setViewer((prev) => {
        const ids = command.studyIds;
        if (ids.length === 0) return prev;
        const current = prev?.patient.mrn === person.mrn ? ids.indexOf(prev.study.id) : -1;
        const study = person.studies.find((item) => item.id === ids[(current + 1) % ids.length]);
        if (!study) return prev;
        const same = prev?.patient.mrn === person.mrn;
        return {
          patient: person,
          study,
          label: same && prev ? prev.label : patientRegionLabel(person),
          surround: same && prev ? prev.surround : 1,
        };
      });
    };
    window.addEventListener(VIEWER_EVENT_NAME, onView);
    return () => window.removeEventListener(VIEWER_EVENT_NAME, onView);
  }, []);
  useEffect(() => {
    saveEdits(edits);
  }, [edits]);

  const hospital = hospitalById(hospitals, DEMO_PLACE.hospitalId);
  const theatre = theatreById(siteById(hospital, DEMO_PLACE.siteId), DEMO_PLACE.theatreId);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    saveSession(settings, new Date().toISOString());
  }, [settings]);
  const patient = route.mrn ? patients.find((item) => item.mrn === route.mrn) : undefined;
  const imagingMrn = new URLSearchParams(locationKey.split('?')[1] ?? '').get('patient');
  const [currentMrn, setCurrentMrn] = useState<string | null>(route.mrn ?? imagingMrn);
  const currentRef = useRef(currentMrn);
  currentRef.current = currentMrn;
  useEffect(() => {
    const next = route.mrn ?? imagingMrn;
    if (!next) return;
    currentRef.current = next;
    setCurrentMrn(next);
  }, [route.mrn, imagingMrn]);

  const runRef = useRef<(text: string) => void>(() => undefined);

  const runUtterance = (text: string) => {
    const pendingMessage = voiceRef.current.pending?.kind === 'message' ? voiceRef.current.pending.id : null;
    const outcome = handleUtterance(text, { ...voiceRef.current, edits: editsRef.current }, patients, currentRef.current, new Date().toISOString(), crypto.randomUUID(), theatre?.name ?? 'the scheduled theatre', scanRef.current);
    voiceRef.current = outcome.memory;
    editsRef.current = outcome.memory.edits;
    if (outcome.intent.type === 'open_patient') {
      currentRef.current = outcome.intent.mrn;
      setCurrentMrn(outcome.intent.mrn);
    }
    setEdits(outcome.memory.edits);
    setVoice(outcome.memory);
    setCommand(outcome.heard);
    setCard({ heard: outcome.heard, doing: outcome.doing });
    if (outcome.toast) setToast(outcome.toast);
    if (outcome.viewerEvent) window.dispatchEvent(new CustomEvent(VIEWER_EVENT_NAME, { detail: outcome.viewerEvent }));
    if (outcome.navigate) go(outcome.navigate);
    if (outcome.intent.type === 'nudge_slice') {
      const delta = outcome.intent.delta;
      setNudge((prev) => ({ tick: prev.tick + 1, delta }));
      const pointer = scanRef.current.pointer;
      if (pointer) {
        const next = {
          ...pointer,
          sliceIndex: pointer.sliceIndex + delta,
          coordinates: { ...pointer.coordinates, z: pointer.coordinates.z + delta },
        };
        scanRef.current = { ...scanRef.current, pointer: next };
        if (cursorRef.current) cursorRef.current = { ...cursorRef.current, pointer: next };
      }
    }
    if (outcome.note) {
      const note = outcome.note;
      const screen = cursorRef.current?.screen;
      setNotes((prev) => [...prev, note]);
      if (screen) setPins((prev) => [...prev, { text: note.text, x: screen.x, y: screen.y }]);
      void fetch('/demo-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note) });
    }
    if (scannerOpenRef.current) setListening(true);
    const confirmed = pendingMessage ? outcome.memory.drafts.find((draft) => draft.id === pendingMessage && draft.status === 'confirmed') : undefined;
    if (confirmed) releaseDraft(confirmed);
    speakReply(outcome.say);
  };
  runRef.current = runUtterance;

  const runGesture = (gesture: ScannerGesture) => {
    const result = applyGesture({ open: true, listening: true }, gesture);
    setListening(result.session.listening);
    runUtterance(phraseForGesture(gesture));
  };

  const releaseDraft = (draft: MessageDraft) => {
    const approved = settingsRef.current.policyIds.includes(CLINICIAN_APPROVAL_POLICY);
    const result = releaseMessage(mailRef.current, {
      shareId: draft.id,
      role: draft.kind === 'prescription' ? 'patient' : 'hospital',
      text: draft.body,
      confirmed: true,
      clinicianApproved: approved,
      mode: modeRef.current,
      now: new Date().toISOString(),
    });
    if (!result.ok) {
      setCard({ heard: draft.body, doing: result.reason === 'needs_approval' ? 'Not sent. Clinician approval is required.' : 'Not sent.' });
      return;
    }
    mailRef.current = result.state;
    setMail(result.state);
    if (result.transport === 'simulated') {
      window.setTimeout(() => {
        const next = advanceSimulated(mailRef.current, draft.id, new Date().toISOString());
        mailRef.current = next;
        setMail(next);
      }, 400);
      return;
    }
    void fetch('/api/demo/messaging/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shareId: draft.id, role: draft.kind === 'prescription' ? 'patient' : 'hospital', text: draft.body, confirmed: true, clinicianApproved: approved }),
    }).then((res) => {
      if (!res.ok) setCard({ heard: draft.body, doing: 'not configured' });
    }).catch(() => setCard({ heard: draft.body, doing: 'not configured' }));
  };

  const startHold = () => {
    if (hold.current) return;
    setListening(true);
    hold.current = beginHold({
      onInterim: setCommand,
      onText: (text) => {
        if (!scannerOpenRef.current) {
          setListening(false);
          hold.current = null;
        }
        runUtterance(text);
      },
      onError: (message) => {
        if (!scannerOpenRef.current) {
          setListening(false);
          hold.current = null;
        }
        setCard({ heard: '', doing: message });
      },
    });
  };
  const stopHold = () => {
    if (scannerOpenRef.current) return;
    hold.current?.stop();
  };

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.code !== 'Space' || event.repeat || typing) return;
      event.preventDefault();
      startHold();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') stopHold();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      if (!scannerOpenRef.current) hold.current?.stop();
    };
  }, []);

  const scannerMrn = viewer?.patient.mrn ?? null;
  const scannerOpen = viewer !== null;
  useEffect(() => {
    if (!scannerMrn) {
      setNotes([]);
      setPins([]);
      cursorRef.current = null;
      scanRef.current = { notes: [], pointer: null, volumeLoaded: false };
      return;
    }
    let cancelled = false;
    setVolumeState({ status: 'loading' });
    void fetch('/casepacks/neuroview/index.json')
      .then((res) => (res.ok ? (res.json() as Promise<NeuroIndex>) : null))
      .then((index) => {
        if (cancelled) return;
        const volume = volumeFromIndex(index);
        setVolumeState(volume ? { status: 'ready', volume } : { status: 'missing' });
      })
      .catch(() => {
        if (!cancelled) setVolumeState({ status: 'missing' });
      });
    void fetch(`/demo-notes/${scannerMrn}`)
      .then((res) => (res.ok ? (res.json() as Promise<ScanNote[]>) : []))
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        setNotes((prev) => {
          const seen = new Set(prev.map((note) => `${note.at}:${note.text}`));
          return [...rows.filter((note) => !seen.has(`${note.at}:${note.text}`)), ...prev];
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scannerMrn]);
  useEffect(() => {
    if (!scannerOpen) return;
    let stopped = false;
    setListening(true);
    hold.current?.stop();
    hold.current = beginOpenMic({
      onInterim: setCommand,
      onText: (text) => {
        if (!stopped) runRef.current(text);
      },
      onError: (message) => setCard({ heard: '', doing: message }),
    });
    return () => {
      stopped = true;
      hold.current?.stop();
      hold.current = null;
      setListening(false);
    };
  }, [scannerOpen]);

  useEffect(() => {
    let cancel = false;
    void fetch('/api/demo/messaging')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { mode?: string; roles?: PersistedRole[] } | null) => {
        if (cancel || !body) return;
        setPhotonMode(body.mode === 'live' ? 'live' : 'simulated');
        if (!body.roles?.length) return;
        setMail((prev) => ({ ...prev, roles: body.roles ?? prev.roles }));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const saveField = (person: DemoPatient, field: ChartField, after: string) => {
    setEdits((prev) => {
      const before = fieldState(baseFieldText(person, field), prev, person.mrn, field).official;
      return proposeEdit(prev, { id: crypto.randomUUID(), mrn: person.mrn, field, before, after, savedAt: new Date().toISOString() });
    });
  };

  const holdMic = (event: { preventDefault: () => void; currentTarget: EventTarget | null; pointerId: number }) => {
    event.preventDefault();
    if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId);
    startHold();
  };

  return (
    <div class="cis">
      <aside class="cis-side">
        <div class="cis-brand">
          <span class="cis-mark" aria-hidden="true">
            +
          </span>
          <div>
            <strong>{hospital?.name ?? 'Northbank University Hospital'}</strong>
            <span>{theatre?.name ?? 'Theatre 5'}</span>
          </div>
        </div>
        <div class="cis-user">
          <span class="cis-avatar">MH</span>
          <span>{SIGNED_IN_SURGEON}</span>
        </div>
        <button type="button" class={listening ? 'cis-mic on' : 'cis-mic'} aria-label="Hold to talk" aria-pressed={listening} onPointerDown={holdMic} onPointerUp={stopHold} onPointerCancel={stopHold}>
          Mic
        </button>
        <nav class="cis-nav" aria-label="Chart sections">
          {NAV.map((item) => (
            <button key={item.id} type="button" aria-current={route.section === item.id ? 'page' : undefined} class={route.section === item.id ? 'on' : ''} onClick={() => go(item.href)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div class="cis-status">
          <p>
            <span class="cis-dot" /> System online
          </p>
          <p class="cis-banner">{DEMO_SOFTWARE_BANNER}</p>
          <p>{now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        </div>
      </aside>
      <div class="cis-stage">
        <header class="cis-top">
          <form
            class="cis-command"
            onSubmit={(event) => {
              event.preventDefault();
              const text = String(new FormData(event.currentTarget).get('command') ?? '');
              if (text.trim()) runUtterance(text);
            }}
          >
            <input name="command" aria-label="Command" placeholder="Hold Mic or Space, or type a command..." value={command} onInput={(event) => setCommand((event.target as HTMLInputElement).value)} />
            <button type="submit">Go</button>
          </form>
          <button type="button" class={listening ? 'cis-mic on' : 'cis-mic'} aria-label="Hold to talk" aria-pressed={listening} onPointerDown={holdMic} onPointerUp={stopHold} onPointerCancel={stopHold}>
            Mic
          </button>
          <button type="button" class="cis-emergency" onClick={() => setToast(EMERGENCY_TEXT)}>
            Emergency
          </button>
          <span class="cis-avatar" title={SIGNED_IN_SURGEON}>
            MH
          </span>
        </header>
        <main class="cis-panel">
          {card && (
            <p class="ehr-heard" role="status">
              I heard: {card.heard || '—'}
              <br />
              Doing: {card.doing}
            </p>
          )}
          {route.section === 'patients' && route.mrn && patient && (
            <PatientDetail
              patient={patient}
              edits={edits}
              onSave={saveField}
              onConfirm={(id) => {
                const now = new Date().toISOString();
                setEdits((prev) => {
                  const next = confirmEdit(prev, id, now);
                  editsRef.current = next;
                  return next;
                });
                if (voiceRef.current.pending?.kind === 'edit' && voiceRef.current.pending.id === id) {
                  const next = { ...voiceRef.current, pending: null };
                  voiceRef.current = next;
                  setVoice(next);
                }
              }}
              onDiscard={(id) => {
                setEdits((prev) => {
                  const next = discardEdit(prev, id);
                  editsRef.current = next;
                  return next;
                });
                if (voiceRef.current.pending?.kind === 'edit' && voiceRef.current.pending.id === id) {
                  const next = { ...voiceRef.current, pending: null };
                  voiceRef.current = next;
                  setVoice(next);
                }
              }}
              onOpenStudy={(study) => emitViewer({ type: 'open_mri', mrn: patient.mrn, studyId: study.id })}
            />
          )}
          {route.section === 'patients' && route.mrn && !patient && <p>No demonstration chart matches MRN {route.mrn}.</p>}
          {route.section === 'patients' && !route.mrn && <PatientTable initialQuery={query} />}
          {route.section === 'surgery' && <SurgeryList />}
          {route.section === 'imaging' && (
            <ImagingList
              onOpen={({ patient: person, study }) => emitViewer({ type: 'open_mri', mrn: person.mrn, studyId: study.id })}
              patientMrn={imagingMrn}
            />
          )}
          {route.section === 'messages' && (
            <Messages
              drafts={voice.drafts}
              edits={edits}
              panels={phonePanels(mail, photonMode, 'Alex Wu')}
              onConfirm={() => runUtterance('confirm')}
              onCancel={() => runUtterance('cancel')}
              pendingId={voice.pending?.id ?? null}
            />
          )}
          {route.section === 'wards' && <WardMap />}
          {route.section === 'theatres' && <TheatreSchedule />}
          {route.section === 'audit' && <AuditLog edits={edits} log={voice.log} />}
          {route.section === 'settings' && <Settings draft={settings} onChange={setSettings} />}
        </main>
      </div>
      {toast && (
        <p class="ehr-toast" role="alert">
          <span class="cis-sim">Simulated</span>
          <span>{toast}</span>
        </p>
      )}
      {viewer && (
        <Dialog title="Scanner" wide onClose={() => setViewer(null)}>
          <div>
            <p>MRN {viewer.patient.mrn}</p>
            {listening ? <p class="mri-listening">Microphone listening</p> : null}
            {volumeState.status === 'loading' ? <p class="muted">Loading the NeuroView case.</p> : null}
            {volumeState.status !== 'loading' ? (
              <MriScanner
                volume={volumeState.status === 'ready' ? volumeState.volume : null}
                pins={pins}
                nudge={nudge}
                onCursor={(cursor) => {
                  cursorRef.current = cursor;
                  scanRef.current = { ...scanRef.current, pointer: cursor.pointer };
                }}
              />
            ) : null}
            <div class="ehr-gestures">
              <button type="button" onClick={() => runGesture('previous_slice')}>
                Gesture: previous slice
              </button>
              <button type="button" onClick={() => runGesture('next_slice')}>
                Gesture: next slice
              </button>
              <button type="button" onClick={() => runGesture('mark_area')}>
                Gesture: mark this area
              </button>
              <button type="button" onClick={() => runGesture('note_check_later')}>
                Gesture: note check later
              </button>
              <button type="button" onClick={() => runGesture('possible_lesion')}>
                Gesture: possible lesion
              </button>
              <button type="button" onClick={() => runGesture('possible_defect')}>
                Gesture: possible defect
              </button>
              <button type="button" onClick={() => runGesture('extraction_required')}>
                Gesture: extraction required
              </button>
              <button type="button" onClick={() => emitViewer(viewerCommand('open_mri', viewer.patient))}>
                Gesture: open MRI scans
              </button>
              <button type="button" onClick={() => emitViewer(viewerCommand('show_region', viewer.patient))}>
                Gesture: show the region
              </button>
              <button type="button" onClick={() => emitViewer(viewerCommand('step_scans', viewer.patient))}>
                Gesture: show the scans
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PatientTable({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  const rows = searchPatients(patients, query);
  return (
    <section>
      <header class="cis-head">
        <div>
          <h1>Patients</h1>
          <p class="cis-sub">{DEMO_DATA_LABEL}</p>
        </div>
        <div class="cis-stat">
          <span>Total patients</span>
          <strong>{patients.length}</strong>
        </div>
      </header>
      <form
        class="ehr-search"
        onSubmit={(event) => {
          event.preventDefault();
          go(`/demo/app/patients?q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <input aria-label="Search by name or MRN" placeholder="Search by name or MRN" value={query} onInput={(event) => setQuery((event.target as HTMLInputElement).value)} />
      </form>
      <table class="ehr-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>MRN</th>
            <th>Age</th>
            <th>Procedure</th>
            <th>Scheduled</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => (
            <tr key={person.mrn} class="clickable" onClick={() => go(`/demo/app/patient/${person.mrn}`)}>
              <td>
                <span class="cis-who">
                  <span class="cis-avatar sm">{initials(person.name)}</span>
                  {person.name}
                </span>
              </td>
              <td>{person.mrn}</td>
              <td>{person.age}</td>
              <td>{person.procedure}</td>
              <td>{formatScheduled(person.scheduled)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5}>No demonstration patient matches that search.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function PatientDetail({
  patient,
  edits,
  onSave,
  onConfirm,
  onDiscard,
  onOpenStudy,
}: {
  patient: DemoPatient;
  edits: readonly ChartEdit[];
  onSave: (patient: DemoPatient, field: ChartField, after: string) => void;
  onConfirm: (id: string) => void;
  onDiscard: (id: string) => void;
  onOpenStudy: (study: DemoStudy) => void;
}) {
  const field = (key: ChartField, multiline = true) => (
    <EditableText
      label={FIELD_LABELS[key]}
      base={baseFieldText(patient, key)}
      edits={edits}
      mrn={patient.mrn}
      field={key}
      multiline={multiline}
      onSave={(after) => onSave(patient, key, after)}
      onConfirm={onConfirm}
      onDiscard={onDiscard}
    />
  );
  const confirmed = auditEntries(edits).filter((edit) => edit.mrn === patient.mrn);
  return (
    <section>
      <button type="button" class="linkish" onClick={() => go('/demo/app/patients')}>
        Patients
      </button>
      <h1>
        {patient.name} <span class="ehr-mrn">MRN {patient.mrn}</span>
      </h1>
      <div class="ehr-grid">
        <article class="ehr-card">
          <h2>Demographics</h2>
          <dl>
            <div>
              <dt>Age</dt>
              <dd>{patient.age}</dd>
            </div>
            <div>
              <dt>Sex</dt>
              <dd>{patient.sex}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{patient.dob}</dd>
            </div>
          </dl>
        </article>
        <article class="ehr-card">
          <h2>Imaging studies</h2>
          <ul class="ehr-studies">
            {patient.studies.map((study) => (
              <li key={study.id}>
                <span>
                  {study.modality} {study.sequence}
                  <small>{study.date}</small>
                </span>
                <button type="button" onClick={() => onOpenStudy(study)}>
                  Open viewer
                </button>
              </li>
            ))}
          </ul>
        </article>
        <article class="ehr-card">{field('procedure', false)}</article>
        <article class="ehr-card">{field('allergies')}</article>
        <article class="ehr-card">{field('medications')}</article>
        <article class="ehr-card">{field('history')}</article>
        <article class="ehr-card ehr-span">{field('notes')}</article>
        <article class="ehr-card ehr-span">
          <h2>Audit log</h2>
          <AuditTable edits={confirmed} />
        </article>
      </div>
    </section>
  );
}

function EditableText({
  label,
  base,
  edits,
  mrn,
  field,
  multiline,
  onSave,
  onConfirm,
  onDiscard,
}: {
  label: string;
  base: string;
  edits: readonly ChartEdit[];
  mrn: string;
  field: ChartField;
  multiline: boolean;
  onSave: (after: string) => void;
  onConfirm: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const state = fieldState(base, edits, mrn, field);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.official);
  useEffect(() => {
    if (!editing) setDraft(state.official);
  }, [state.official, editing]);
  return (
    <div>
      <h2>{label}</h2>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft !== state.official) onSave(draft);
            setEditing(false);
          }}
        >
          {multiline ? (
            <textarea aria-label={label} rows={4} value={draft} onInput={(event) => setDraft((event.target as HTMLTextAreaElement).value)} />
          ) : (
            <input aria-label={label} value={draft} onInput={(event) => setDraft((event.target as HTMLInputElement).value)} />
          )}
          <div class="ehr-row">
            <button type="submit">Propose change</button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <Lines text={state.official} />
          <button
            type="button"
            onClick={() => {
              setDraft(state.official);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </>
      )}
      {state.pending && (
        <div class="ehr-pending">
          <strong>{PENDING_LABEL}</strong>
          <Lines text={state.pending.after} />
          <div class="ehr-row">
            <button type="button" class="primary" onClick={() => onConfirm(state.pending!.id)}>
              Confirm
            </button>
            <button type="button" onClick={() => onDiscard(state.pending!.id)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Lines({ text }: { text: string }) {
  const rows = text.split('\n').filter((line) => line.length > 0);
  if (rows.length === 0) return <p class="muted">None recorded.</p>;
  if (rows.length === 1) return <p>{rows[0]}</p>;
  return (
    <ul>
      {rows.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function SurgeryList() {
  return (
    <section>
      <header class="cis-head">
        <div>
          <h1>Surgery</h1>
          <p class="cis-sub">Scheduled surgical procedures. {DEMO_DATA_LABEL}</p>
        </div>
      </header>
      <table class="ehr-table">
        <thead>
          <tr>
            <th>Scheduled</th>
            <th>Patient</th>
            <th>MRN</th>
            <th>Procedure</th>
          </tr>
        </thead>
        <tbody>
          {patients.map((person) => (
            <tr key={person.mrn} class="clickable" onClick={() => go(`/demo/app/patient/${person.mrn}`)}>
              <td>{formatScheduled(person.scheduled)}</td>
              <td>{person.name}</td>
              <td>{person.mrn}</td>
              <td>{person.procedure}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ImagingList({ onOpen, patientMrn }: { onOpen: (value: { patient: DemoPatient; study: DemoStudy }) => void; patientMrn: string | null }) {
  const source = patientMrn ? patients.filter((item) => item.mrn === patientMrn) : patients;
  const rows = source.flatMap((person) => person.studies.filter((study) => !patientMrn || study.modality === 'MRI').map((study) => ({ person, study })));
  return (
    <section>
      <h1>{patientMrn ? 'MRI scans' : 'Imaging'}</h1>
      {rows.length === 0 && <p>No MRI scans are on file for this patient.</p>}
      <table class="ehr-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Patient</th>
            <th>MRN</th>
            <th>Study</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ person, study }) => (
            <tr key={study.id}>
              <td>{study.date}</td>
              <td>{person.name}</td>
              <td>{person.mrn}</td>
              <td>
                {study.modality} {study.sequence}
              </td>
              <td>
                <button type="button" onClick={() => onOpen({ patient: person, study })}>
                  Open viewer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Messages({
  drafts,
  edits,
  panels,
  pendingId,
  onConfirm,
  onCancel,
}: {
  drafts: MessageDraft[];
  edits: readonly ChartEdit[];
  panels: ReturnType<typeof phonePanels>;
  pendingId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const notes = edits.filter((edit) => edit.status === 'pending');
  return (
    <section>
      <header class="cis-head">
        <div>
          <h1>Messages</h1>
          <p class="cis-sub">Clinician approves all patient messages. For communication and education. Not for diagnosis.</p>
        </div>
      </header>
      <div class="ehr-phones">
        {panels.map((panel) => (
          <article key={panel.title} class="ehr-phone">
            <header>
              <strong>{panel.title}</strong>
              <span class={panel.badge === 'LIVE' ? 'ehr-badge live' : 'ehr-badge sim'}>{panel.badge}</span>
            </header>
            <p class="muted">{panel.last4 ? `Phone ending ${panel.last4}` : 'Text HOSPITAL or PATIENT to the line to register.'}</p>
            {panel.messages.length === 0 && <p>No messages on this phone.</p>}
            {panel.messages.map((message) => (
              <div key={message.shareId} class="ehr-bubble">
                <p>{message.text}</p>
                <p class="ehr-timeline">{message.timeline.join(' · ')}</p>
                {message.poll && <p>{message.poll.title} {message.poll.options.join(' / ')}.</p>}
              </div>
            ))}
          </article>
        ))}
      </div>
      <h2>Hospital inbox notes</h2>
      {notes.length === 0 && <p class="muted">No pending chart changes. A change is not written to the patient record until it is confirmed.</p>}
      {notes.map((edit) => {
        const person = patients.find((item) => item.mrn === edit.mrn);
        return (
          <article key={edit.id} class="ehr-pending">
            <p>
              <strong>Note to the hospital inbox</strong> · {person?.name ?? edit.mrn} · Not saved
            </p>
            <p>
              Pending change: {FIELD_LABELS[edit.field]} to {edit.after}. The patient record is unchanged.
            </p>
            {edit.id === pendingId && (
              <div class="ehr-row">
                <button type="button" onClick={onConfirm}>
                  Confirm
                </button>
                <button type="button" class="ghost" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            )}
          </article>
        );
      })}
      {drafts.length === 0 && notes.length === 0 && <p>No messages. This demonstration does not send anything to a patient.</p>}
      {drafts.map((draft) => (
        <article key={draft.id} class="ehr-pending">
          <p>
            <strong>{draft.kind === 'prescription' ? 'Prescription draft' : draft.kind === 'hospital_notes' ? 'Notes for the hospital' : 'Hospital software draft'}</strong> · {draft.patientName} · {draft.status === 'draft' ? 'Draft — not sent' : panels.some((panel) => panel.messages.some((message) => message.shareId === draft.id)) ? 'On the phone' : 'Confirmed — not sent'}
          </p>
          <p class="mri-note-body">{draft.body}</p>
          {draft.id === pendingId && draft.status === 'draft' && (
            <div class="ehr-row">
              <button type="button" onClick={onConfirm}>
                Confirm
              </button>
              <button type="button" class="ghost" onClick={onCancel}>
                Cancel
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function AuditLog({ edits, log }: { edits: readonly ChartEdit[]; log: VoiceMemory['log'] }) {
  return (
    <section>
      <h1>Audit log</h1>
      <p>A saved edit stays out of this log until someone presses Confirm.</p>
      {log.length > 0 && (
        <ul class="ehr-history">
          {log.map((entry, index) => (
            <li key={`${entry.at}-${index}`} class={entry.kind === 'emergency' ? 'ehr-emergency-log' : undefined}>
              {entry.doing}
            </li>
          ))}
        </ul>
      )}
      <AuditTable edits={auditEntries(edits)} />
    </section>
  );
}

function AuditTable({ edits }: { edits: readonly ChartEdit[] }) {
  if (edits.length === 0) return <p class="muted">No confirmed changes.</p>;
  return (
    <table class="ehr-table">
      <thead>
        <tr>
          <th>When</th>
          <th>MRN</th>
          <th>Field</th>
          <th>Change</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        {edits.map((edit) => (
          <tr key={edit.id}>
            <td>{edit.confirmedAt ?? edit.savedAt}</td>
            <td>{edit.mrn}</td>
            <td>{FIELD_LABELS[edit.field]}</td>
            <td>{edit.after}</td>
            <td>{SIGNED_IN_SURGEON}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function WardMap() {
  const occupied = WARDS.reduce((sum, ward) => sum + ward.occupied, 0);
  const beds = WARDS.reduce((sum, ward) => sum + ward.beds, 0);
  return (
    <section>
      <header class="cis-head">
        <div>
          <h1>Ward map</h1>
          <p class="cis-sub">Northbank University Hospital. {DEMO_DATA_LABEL}</p>
        </div>
        <div class="cis-stat">
          <span>Bed occupancy</span>
          <strong>
            {occupied}/{beds}
          </strong>
        </div>
      </header>
      <div class="cis-grid">
        {WARDS.map((ward) => (
          <article key={ward.name} class="cis-card">
            <h2>
              {ward.name} ward · {ward.level}
            </h2>
            <p>
              {ward.occupied} of {ward.beds} beds occupied
            </p>
            <div class="cis-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((ward.occupied / ward.beds) * 100)}%` }} />
            </div>
          </article>
        ))}
        {THEATRE_BOARD.map((theatre) => (
          <article key={theatre.name} class="cis-card">
            <h2>{theatre.name}</h2>
            <p>{theatre.state}</p>
          </article>
        ))}
        <article class="cis-card">
          <h2>System status</h2>
          <ul class="cis-list">
            <li>Clinical record: online</li>
            <li>Messaging: simulated</li>
            <li>Imaging viewer: ready</li>
            <li>{DEMO_SOFTWARE_BANNER}</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

function TheatreSchedule() {
  const rows = [...patients].sort((a, b) => a.scheduled.localeCompare(b.scheduled));
  return (
    <section>
      <header class="cis-head">
        <div>
          <h1>Theatre schedule</h1>
          <p class="cis-sub">Theatre 5 list for this demonstration session. {DEMO_DATA_LABEL}</p>
        </div>
      </header>
      <div class="cis-grid">
        {THEATRE_BOARD.map((theatre) => (
          <article key={theatre.name} class="cis-card">
            <h2>{theatre.name}</h2>
            <p>{theatre.name === 'Theatre 5' ? `${rows.length} demonstration cases` : theatre.state}</p>
          </article>
        ))}
      </div>
      <table class="ehr-table">
        <thead>
          <tr>
            <th>Scheduled</th>
            <th>Theatre</th>
            <th>Patient</th>
            <th>MRN</th>
            <th>Procedure</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => (
            <tr key={person.mrn} class="clickable" onClick={() => go(`/demo/app/patient/${person.mrn}`)}>
              <td>{formatScheduled(person.scheduled)}</td>
              <td>Theatre 5</td>
              <td>{person.name}</td>
              <td>{person.mrn}</td>
              <td>{person.procedure}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Settings({ draft, onChange }: { draft: OnboardingDraft; onChange: (next: OnboardingDraft) => void }) {
  return (
    <section>
      <header class="cis-head">
        <div>
          <h1>Settings</h1>
          <p class="cis-sub">Policies and human-in-the-loop checks for this session. Northbank University Hospital, Theatre 5.</p>
        </div>
      </header>
      <div class="cis-grid">
        <article class="cis-card">
          <h2>Policies</h2>
          <ul class="cis-list">
            {policies.map((policy) => {
              const selected = draft.policyIds.includes(policy.id);
              return (
                <li key={policy.id}>
                  <div>
                    <strong>{policy.name}</strong>
                    {policy.required && <span class="cis-tag">Required</span>}
                    <p>{policy.description}</p>
                  </div>
                  <button type="button" aria-pressed={selected} class={selected ? 'on' : ''} onClick={() => onChange(togglePolicy(draft, policy.id))}>
                    {selected ? 'Selected' : 'Select'}
                  </button>
                </li>
              );
            })}
          </ul>
        </article>
        <article class="cis-card">
          <h2>Human in the loop</h2>
          <ul class="cis-list">
            {hitlItems.map((item) => (
              <li key={item.id}>
                <label>
                  <input type="checkbox" checked={draft.hitl[item.id] === true} onChange={() => onChange(toggleHitl(draft, item.id))} />
                  <span>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

function Dialog({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: JSX.Element | JSX.Element[] }) {
  return (
    <div class="ehr-modal" role="presentation" onClick={onClose}>
      <div class={wide ? 'ehr-dialog wide' : 'ehr-dialog'} role="dialog" aria-modal="true" aria-labelledby="ehr-dialog-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="ehr-dialog-title">{title}</h2>
        {children}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
