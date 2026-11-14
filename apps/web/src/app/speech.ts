/**
 * Browser speech, both directions.
 *
 * Recognition uses Chrome's Web Speech API, which streams the microphone audio to Google's speech
 * service (see docs/safety.md). Other browsers either lack it or route it elsewhere, so it is
 * offered only in Google Chrome.
 *
 * Read-aloud takes a VerifiedText, not a string, and refuses anything that is not "verified":
 * the on-screen text is the source of truth and speech never says blocked or needs-review text.
 */
import type { VerifiedText } from '@hoverscan/contracts';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

export const VOICE_NEEDS_CHROME = 'Voice needs Google Chrome.';

function isGoogleChrome(): boolean {
  const brands = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  if (brands) return brands.some((b) => b.brand === 'Google Chrome');
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\/|OPR\/|SamsungBrowser\//.test(ua);
}

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return ctor && isGoogleChrome() ? ctor : null;
}

export function voiceSupported(): boolean {
  return recognitionCtor() !== null;
}

export interface ListenHandlers {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onError(message: string): void;
  onEnd(): void;
}

/** One utterance. Returns a stop function, or null when voice is unsupported. */
export function listenOnce(h: ListenHandlers): (() => void) | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = navigator.language || 'en-US';
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) h.onFinal(res[0].transcript);
      else interim += res[0].transcript;
    }
    if (interim) h.onInterim(interim);
  };
  r.onerror = (e) => h.onError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech recognition error: ${e.error}`);
  r.onend = () => h.onEnd();
  r.start();
  return () => r.stop();
}

export function readAloudSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Speaks vt.text only when vt.status is "verified". Returns false (and says nothing) otherwise. */
export function readAloud(vt: VerifiedText | null, onEnd: () => void): boolean {
  if (!vt || vt.status !== 'verified' || !readAloudSupported()) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(vt.text);
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.speak(u);
  return true;
}

export function stopReading(): void {
  if (readAloudSupported()) window.speechSynthesis.cancel();
}
