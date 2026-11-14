/**
 * Hack listens through the existing open microphone and wake word.
 * Interim speech is used only to detect "Hack". It is not shown.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { emptyMessaging, releaseMessage, type MessagingState } from '../../../hub/src/messaging/demo-messages.js';
import { commandFromModel, commandLine, interpretCommand, type HackCommand, type HackPhase } from './hack-commands.js';
import { hear, idleWake, takeCommand, type WakeState } from './wake.js';
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
}

const SILENCE_MS = 2000;

export function useHackAssistant(handlers: HackHandlers): {
  phase: HackPhase;
  command: string;
  activity: string;
  log: string[];
  hospitalMessage: string;
  patientMessage: string;
  dismissPatient: () => void;
} {
  const [phase, setPhase] = useState<HackPhase>('Listening');
  const [command, setCommand] = useState('Say Hack, then a command.');
  const [activity, setActivity] = useState('Listening');
  const [log, setLog] = useState<string[]>([]);
  const [hospitalMessage, setHospitalMessage] = useState('');
  const [patientMessage, setPatientMessage] = useState('');
  const handlersRef = useRef(handlers);
  const messaging = useRef<MessagingState>(emptyMessaging());
  handlersRef.current = handlers;

  function record(label: string): void {
    setLog((current) => [label, ...current].slice(0, 20));
  }

  function finish(label: string): void {
    record(label);
    setPhase('Completed');
    setActivity('Completed');
    window.setTimeout(() => {
      setPhase('Listening');
      setActivity('Listening');
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
    const role = action.command === 'message_hospital' ? 'hospital' : 'patient';
    const released = releaseMessage(messaging.current, {
      shareId: `hack-${role}-${messaging.current.attempted.length + 1}`,
      role,
      text: action.text,
      confirmed: true,
      clinicianApproved: true,
      mode: 'simulated',
      now: new Date().toISOString(),
    });
    if (!released.ok) {
      setPhase('Listening');
      setActivity(released.reason);
      setCommand('The message was not sent.');
      return;
    }
    messaging.current = released.state;
    if (role === 'hospital') setHospitalMessage(action.text);
    else setPatientMessage(action.text);
    finish(next.label);
  }

  function stage(next: HackCommand): void {
    const label = commandLine(next);
    setCommand(label);
    if (next.command === 'ask') {
      setPhase('Listening');
      setActivity(next.question);
      return;
    }
    execute({ command: next, label });
  }

  useEffect(() => {
    let wake: WakeState = idleWake();
    let timer = 0;
    const consider = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const taken = takeCommand(wake, Date.now());
        wake = taken.state;
        const heard = taken.command;
        if (!heard) return;
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
            const fromModel = raw ? commandFromModel(raw) : null;
            stage(fromModel && fromModel.command !== 'ask' ? fromModel : interpretCommand(heard));
          })
          .catch(() => {
            setPhase('Preparing');
            stage(interpretCommand(heard));
          });
      }, SILENCE_MS);
    };
    const mic = beginOpenMic({
      onInterim(value) {
        wake = hear(wake, value, Date.now());
        if (wake.phase === 'capture') consider();
      },
      onText(value) {
        wake = hear(wake, value, Date.now());
        if (wake.phase === 'capture') consider();
      },
      onError(message) {
        setPhase('Listening');
        setActivity(message);
      },
    });
    return () => {
      window.clearTimeout(timer);
      mic.stop();
    };
  }, []);

  return {
    phase,
    command,
    activity,
    log,
    hospitalMessage,
    patientMessage,
    dismissPatient() {
      setPatientMessage('');
    },
  };
}
