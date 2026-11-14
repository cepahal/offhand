/**
 * Hack listens through the existing open microphone after a 1.5 s hover over the gesture board.
 * `heard` carries the words recognised so far, interim results included, so the command bar can
 * show them as they are spoken. Only the finished phrase is interpreted.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { commandFromModel, commandLine, interpretCommand, type HackCommand, type HackPhase } from './hack-commands.js';
import { idleWake, takeCommand, type WakeState } from './wake.js';
import { beginOpenMic } from './voice-listen.js';

export interface HackPending {
  command: Exclude<HackCommand, { command: 'ask' }>;
  label: string;
}

interface HackHandlers {
  showPatient: () => void;
  viewScans: () => void;
  addNote: (text: string) => void;
  applyPrescription: (medication: string) => Promise<void>;
  openBite: () => void;
  simulateBite: (tooth: string) => { ok: true } | { ok: false; question: string };
  showBone: () => void;
  showAnalysis: () => void;
  showAdjustments: () => void;
  replayBite: () => void;
}

const SILENCE_MS = 2000;

type Delivery = { status: 'delivered' | 'failed'; subject?: string; reason?: string; duplicate?: boolean };

function needsConfirm(command: HackCommand): boolean {
  return command.command === 'message_patient' || command.command === 'message_hospital' || command.command === 'change_prescription';
}

export function useHackAssistant(handlers: HackHandlers): {
  phase: HackPhase;
  command: string;
  /** Words recognised so far while listening; empty otherwise. */
  heard: string;
  activity: string;
  log: string[];
  hospitalMessage: string;
  patientMessage: string;
  pending: HackPending | null;
  arm: () => void;
  note: (text: string) => void;
  dismissPatient: () => void;
} {
  const [phase, setPhase] = useState<HackPhase>('Idle');
  const [command, setCommand] = useState('Hover, then speak.');
  const [heard, setHeard] = useState('');
  const [activity, setActivity] = useState('Idle');
  const [log, setLog] = useState<string[]>([]);
  const [hospitalMessage, setHospitalMessage] = useState('');
  const [patientMessage, setPatientMessage] = useState('');
  const [pending, setPending] = useState<HackPending | null>(null);
  const handlersRef = useRef(handlers);
  const pendingRef = useRef<HackPending | null>(null);
  const sending = useRef(false);
  handlersRef.current = handlers;
  pendingRef.current = pending;

  function record(label: string): void {
    setLog((current) => [label, ...current].slice(0, 20));
  }

  function finish(label: string): void {
    record(label);
    setPhase('Completed');
    setActivity('Completed');
    window.setTimeout(() => {
      setPhase('Idle');
      setActivity('Idle');
      setCommand('Hover, then speak.');
    }, 1600);
  }

  function execute(next: HackPending): void {
    const action = next.command;
    setPhase('Executing');
    setActivity('Executing');
    if (action.command === 'show_patient') {
      handlersRef.current.showPatient();
      finish(next.label);
      return;
    }
    if (action.command === 'view_scans') {
      handlersRef.current.viewScans();
      finish(next.label);
      return;
    }
    if (action.command === 'add_note') {
      handlersRef.current.addNote(action.text);
      finish(next.label);
      return;
    }
    if (action.command === 'change_prescription') {
      void handlersRef.current.applyPrescription(action.medication).then(() => finish(next.label));
      return;
    }
    if (action.command === 'open_bite') {
      handlersRef.current.openBite();
      finish(next.label);
      return;
    }
    if (action.command === 'simulate_bite') {
      const result = handlersRef.current.simulateBite(action.tooth);
      if (!result.ok) {
        record(result.question);
        setPhase('Idle');
        setActivity(result.question);
        setCommand(result.question);
        return;
      }
      finish(next.label);
      return;
    }
    if (action.command === 'show_bone') {
      handlersRef.current.showBone();
      finish(next.label);
      return;
    }
    if (action.command === 'show_analysis') {
      handlersRef.current.showAnalysis();
      finish(next.label);
      return;
    }
    if (action.command === 'show_adjustments') {
      handlersRef.current.showAdjustments();
      finish(next.label);
      return;
    }
    if (action.command === 'replay_bite') {
      handlersRef.current.replayBite();
      finish(next.label);
      return;
    }
    const role = action.command === 'message_hospital' ? 'hospital' : 'patient';
    if (sending.current) return;
    sending.current = true;
    const clientId = crypto.randomUUID();
    if (role === 'hospital') setHospitalMessage('Sending');
    else setPatientMessage('Sending');
    setActivity('Sending');
    void fetch('/api/dental/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, role, body: action.text, confirmed: true, clinicianApproved: true }),
    })
      .then(async (response) => ({ ok: response.ok, result: (await response.json()) as Delivery }))
      .then(({ result }) => {
        const status = result.status === 'delivered' ? 'Delivered' : 'Failed';
        const detail = result.status === 'delivered' ? (result.subject ?? next.label) : (result.reason ?? 'Photon send failed');
        const line = `${role === 'hospital' ? 'Hospital' : 'Patient'} message ${status.toLowerCase()}: ${detail}`;
        if (role === 'hospital') setHospitalMessage(`${status}: ${detail}`);
        else if (result.status === 'delivered') setPatientMessage(`${status}: ${detail}`);
        else {
          setPatientMessage('');
          setCommand(`Failed: ${detail}`);
        }
        if (!result.duplicate) record(line);
        setActivity(status);
        if (result.status === 'delivered') {
          setPhase('Completed');
          window.setTimeout(() => {
            setPhase('Idle');
            setActivity('Idle');
            setCommand('Hover, then speak.');
          }, 1600);
        } else {
          setPhase('Idle');
          setActivity('Failed');
          setCommand('Hover, then speak.');
        }
      })
      .catch(() => {
        if (role === 'hospital') setHospitalMessage('Failed: Photon listener is not connected');
        else setPatientMessage('');
        record(`${role === 'hospital' ? 'Hospital' : 'Patient'} message failed: Photon listener is not connected`);
        setPhase('Idle');
        setActivity('Failed');
        setCommand('Hover, then speak.');
      })
      .finally(() => {
        sending.current = false;
      });
  }

  function stage(next: HackCommand): void {
    const label = commandLine(next);
    setCommand(label);
    if (next.command === 'ask') {
      setPending(null);
      setPhase('Idle');
      setActivity(next.question);
      setCommand('Hover, then speak.');
      return;
    }
    if (needsConfirm(next)) {
      setPending({ command: next, label });
      setPhase('Awaiting Confirmation');
      setActivity('Hover to confirm');
      setCommand(`${label}. Hover to confirm.`);
      if (next.command === 'message_patient') setPatientMessage('Prepared');
      if (next.command === 'message_hospital') setHospitalMessage('Prepared');
      return;
    }
    setPending(null);
    execute({ command: next, label });
  }

  const wakeRef = useRef<WakeState>(idleWake());
  const micRef = useRef<{ stop: () => void } | null>(null);
  const timerRef = useRef(0);
  const spokenRef = useRef('');

  function stopMic(): void {
    window.clearTimeout(timerRef.current);
    micRef.current?.stop();
    micRef.current = null;
    setHeard('');
    wakeRef.current = idleWake();
    spokenRef.current = '';
  }

  function hearCapture(transcript: string, interim: boolean): void {
    if (wakeRef.current.phase !== 'capture') return;
    const cleaned = transcript.replace(/^(?:hack[\s,.:;-]*)+/i, '').trim();
    if (!interim && cleaned) spokenRef.current = `${spokenRef.current} ${cleaned}`.trim();
    const buffer = (interim ? `${spokenRef.current} ${cleaned}` : spokenRef.current).trim();
    if (!buffer) return;
    setHeard(buffer);
    wakeRef.current = { phase: 'capture', buffer, lastVoiceAt: Date.now() };
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const taken = takeCommand(wakeRef.current, Date.now());
      wakeRef.current = taken.state;
      const heard = taken.command;
      if (!heard) return;
      stopMic();
      setHeard('');
      setPhase('Understanding');
      setActivity('Understanding');
      setCommand(heard);
      void fetch('/api/voice/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: heard, patients: [{ name: 'Alex Johnson', mrn: 'synthetic' }] }),
      })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((raw: unknown) => {
          setPhase('Preparing');
          setActivity('Preparing');
          const local = interpretCommand(heard);
          const fromModel = raw ? commandFromModel(raw) : null;
          stage(local.command !== 'ask' ? local : fromModel && fromModel.command !== 'ask' ? fromModel : local);
        })
        .catch(() => {
          setPhase('Preparing');
          stage(interpretCommand(heard));
        });
    }, SILENCE_MS);
  }

  function arm(): void {
    if (pendingRef.current) {
      const held = pendingRef.current;
      if (sending.current) return;
      pendingRef.current = null;
      setPending(null);
      execute(held);
      return;
    }
    stopMic();
    spokenRef.current = '';
    wakeRef.current = { phase: 'capture', buffer: '', lastVoiceAt: Date.now() };
    setPhase('Listening');
    setActivity('Listening');
    setCommand('Listening.');
    micRef.current = beginOpenMic({
      onInterim(value) {
        hearCapture(value, true);
      },
      onText(value) {
        hearCapture(value, false);
      },
      onError(message) {
        stopMic();
        setPhase('Idle');
        const shown = /denied|not-allowed/i.test(message)
          ? 'Microphone access is blocked. Allow it in the browser’s site settings, then hover again.'
          : message;
        setActivity(shown);
        setCommand(shown);
      },
    });
  }

  useEffect(() => () => stopMic(), []);

  return {
    phase,
    command,
    heard,
    activity,
    log,
    hospitalMessage,
    patientMessage,
    pending,
    arm,
    note(text: string) {
      record(text);
      setActivity(text);
    },
    dismissPatient() {
      setPatientMessage('');
    },
  };
}
