/** Wake word "hack", then capture until about 1.2 s of silence. */
export const WAKE_WORD = 'hack';
export const COMMAND_SILENCE_MS = 1200;

export interface WakeState {
  phase: 'idle' | 'capture';
  buffer: string;
  lastVoiceAt: number;
}

export function idleWake(now = 0): WakeState {
  return { phase: 'idle', buffer: '', lastVoiceAt: now };
}

function afterWake(text: string): string | null {
  const lower = text.toLowerCase();
  const at = lower.lastIndexOf(WAKE_WORD);
  if (at < 0) return null;
  return text.slice(at + WAKE_WORD.length).replace(/^[\s,.:;-]+/, '').trim();
}

export function hear(state: WakeState, transcript: string, now: number): WakeState {
  const command = afterWake(transcript);
  if (command != null) {
    return { phase: command ? 'capture' : 'capture', buffer: command, lastVoiceAt: now };
  }
  if (state.phase !== 'capture') return state;
  const extra = transcript.trim();
  if (!extra) return state;
  return { phase: 'capture', buffer: `${state.buffer} ${extra}`.trim(), lastVoiceAt: now };
}

/** Returns the command once silence has lasted long enough. */
export function takeCommand(state: WakeState, now: number): { state: WakeState; command: string | null } {
  if (state.phase !== 'capture' || !state.buffer) return { state, command: null };
  if (now - state.lastVoiceAt < COMMAND_SILENCE_MS) return { state, command: null };
  return { state: idleWake(now), command: state.buffer };
}
