/**
 * Hold-to-talk for the demonstration only. No AWS.
 *
 * Chrome's Web Speech API is the default. When WHISPER_URL is set, audio stays on that
 * local server. The server is checked before any audio is posted:
 *   - GET /v1/models → OpenAI-compatible POST /v1/audio/transcriptions (file, model, response_format=json, {text})
 *   - otherwise OPTIONS /inference → whisper.cpp POST /inference
 *     (confirmed in whisper.cpp examples/server: multipart field "file", response_format "json",
 *     body {"text"}; a missing file is 400 {"error":"no 'file' field in the request"})
 * Anything else is refused. Audio is not sent, and Chrome is not used as a silent fallback.
 */
export type WhisperApi = { kind: 'openai'; path: '/v1/audio/transcriptions' } | { kind: 'whisper.cpp'; path: '/inference' };

export type WhisperProbe = { ok: true; api: WhisperApi } | { ok: false; reason: string };

export function whisperUrl(): string {
  const env = import.meta.env as { WHISPER_URL?: string };
  return (env.WHISPER_URL ?? '').trim().replace(/\/+$/, '');
}

function textFromBody(body: unknown): string {
  if (!body || typeof body !== 'object' || !('text' in body)) return '';
  const text = (body as { text?: unknown }).text;
  return typeof text === 'string' ? text.trim() : '';
}

/** Look at the server before posting audio. */
export async function probeWhisper(base: string, fetchImpl: typeof fetch = fetch): Promise<WhisperProbe> {
  const root = base.replace(/\/+$/, '');
  try {
    const models = await fetchImpl(`${root}/v1/models`);
    if (models.ok) return { ok: true, api: { kind: 'openai', path: '/v1/audio/transcriptions' } };
  } catch (err) {
    return { ok: false, reason: `Whisper server not reachable (${(err as Error).message}).` };
  }
  try {
    const inference = await fetchImpl(`${root}/inference`, { method: 'OPTIONS' });
    if (inference.status !== 404 && inference.status !== 405) return { ok: true, api: { kind: 'whisper.cpp', path: '/inference' } };
  } catch (err) {
    return { ok: false, reason: `Whisper server not reachable (${(err as Error).message}).` };
  }
  return { ok: false, reason: `Whisper server at ${root} did not offer /v1/models or /inference. No audio was sent.` };
}

export async function transcribeWav(base: string, wav: Blob, fetchImpl: typeof fetch = fetch): Promise<string> {
  const probe = await probeWhisper(base, fetchImpl);
  if (!probe.ok) throw new Error(probe.reason);
  const body = new FormData();
  body.append('file', wav, 'speech.wav');
  body.append('response_format', 'json');
  if (probe.api.kind === 'openai') body.append('model', 'whisper-1');
  const response = await fetchImpl(`${base.replace(/\/+$/, '')}${probe.api.path}`, { method: 'POST', body });
  if (!response.ok) throw new Error(`Whisper transcribe failed (HTTP ${response.status}).`);
  const transcript = textFromBody(await response.json());
  if (!transcript) throw new Error('Whisper returned no text.');
  return transcript;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

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
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function speechCtor(): (new () => Recognition) | null {
  if (/Edg\/|OPR\/|SamsungBrowser\//.test(navigator.userAgent)) return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceInputAvailable(): boolean {
  return whisperUrl() !== '' || speechCtor() !== null;
}

/** Ask for the microphone from a click. A wave alone is not a user gesture, so Chrome will not open the mic until this has succeeded once. */
export async function primeMicrophone(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser has no microphone.';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return null;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied.';
    return 'The microphone could not be opened.';
  }
}

export interface HoldSession {
  stop(): void;
}

/**
 * Start listening. Call stop() on pointer-up or key-up.
 * onText receives the transcript once. onInterim updates the command box while listening.
 */
export function beginHold(handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  const url = whisperUrl();
  if (url) return beginWhisper(url, handlers);
  return beginWebSpeech(handlers);
}

/**
 * Keeps the microphone open until stop(). A gesture must not call stop().
 * Each finished phrase is delivered on its own, then listening continues.
 */
export function beginOpenMic(handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  const url = whisperUrl();
  if (url) return beginWhisperLoop(url, handlers);
  return beginSpeechOrHub(handlers);
}

/** Chrome speech first. If it never returns words, record and send the wav to the hub. */
function beginSpeechOrHub(handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  let heard = false;
  let switched = false;
  let hub: HoldSession | null = null;
  let speech: HoldSession | null = null;
  const switchToHub = () => {
    if (switched || heard) return;
    switched = true;
    speech?.stop();
    hub = beginHubWhisper(handlers);
  };
  speech = beginContinuousSpeech({
    onInterim(text) {
      heard = true;
      handlers.onInterim(text);
    },
    onText(text) {
      heard = true;
      handlers.onText(text);
    },
    onError(message) {
      if (/network|service-not-allowed/i.test(message)) {
        switchToHub();
        return;
      }
      handlers.onError(message);
    },
  });
  const timer = window.setTimeout(switchToHub, 2500);
  return {
    stop() {
      window.clearTimeout(timer);
      speech?.stop();
      hub?.stop();
    },
  };
}

function beginHubWhisper(handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  let stopped = false;
  let stopRecord: (() => void) | null = null;
  const cycle = () => {
    if (stopped) return;
    handlers.onInterim('Listening.');
    const timer = setTimeout(() => stopRecord?.(), 4500);
    void recordWav((stop) => {
      stopRecord = () => {
        clearTimeout(timer);
        stop();
      };
    })
      .then(async (wav) => {
        if (stopped || wav.size <= 44) {
          if (!stopped) cycle();
          return;
        }
        const text = await transcribeOnHub(wav);
        if (text.trim()) handlers.onText(text.trim());
        if (!stopped) cycle();
      })
      .catch((err: Error) => {
        if (!stopped) handlers.onError(err.message);
      });
  };
  cycle();
  return {
    stop() {
      stopped = true;
      stopRecord?.();
    },
  };
}

async function transcribeOnHub(wav: Blob): Promise<string> {
  const bytes = new Uint8Array(await wav.arrayBuffer());
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step));
  const response = await fetch('/api/voice/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audioBase64: btoa(binary) }),
  });
  if (response.status === 503) throw new Error('Voice transcription is not configured on the hub.');
  if (!response.ok) throw new Error('Voice transcription failed.');
  const body = (await response.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text : '';
}

function beginWebSpeech(handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  const Ctor = speechCtor();
  if (!Ctor) {
    handlers.onError('Voice needs Google Chrome, or set WHISPER_URL to a local Whisper server.');
    return { stop() {} };
  }
  const recognition = new Ctor();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  let latest = '';
  let sent = false;
  const finish = () => {
    if (sent) return;
    sent = true;
    if (latest.trim()) handlers.onText(latest.trim());
  };
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      if (result.isFinal) latest = `${latest} ${result[0].transcript}`.trim();
      else interim += result[0].transcript;
    }
    handlers.onInterim((interim || latest).trim());
  };
  recognition.onerror = (event) => {
    if (event.error !== 'aborted' && event.error !== 'no-speech') handlers.onError(event.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech recognition error: ${event.error}`);
  };
  recognition.onend = finish;
  recognition.start();
  return {
    stop() {
      recognition.stop();
    },
  };
}

function beginContinuousSpeech(handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  const Ctor = speechCtor();
  if (!Ctor) {
    handlers.onError('Voice needs Google Chrome, or set WHISPER_URL to a local Whisper server.');
    return { stop() {} };
  }
  const recognition = new Ctor();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  let stopped = false;
  let failed = false;
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      const transcript = result[0].transcript.trim();
      if (result.isFinal) {
        if (transcript) handlers.onText(transcript);
      } else interim += result[0].transcript;
    }
    if (interim.trim()) handlers.onInterim(interim.trim());
  };
  recognition.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    failed = true;
    handlers.onError(event.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech recognition error: ${event.error}`);
  };
  recognition.onend = () => {
    if (stopped || failed) return;
    try {
      recognition.start();
    } catch {
      failed = true;
    }
  };
  try {
    recognition.start();
  } catch {
    handlers.onError('Voice needs Google Chrome, or set WHISPER_URL to a local Whisper server.');
    return { stop() {} };
  }
  return {
    stop() {
      stopped = true;
      recognition.stop();
    },
  };
}

function beginWhisperLoop(url: string, handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  let stopped = false;
  let stopRecord: (() => void) | null = null;
  const cycle = () => {
    if (stopped) return;
    const timer = setTimeout(() => stopRecord?.(), 8000);
    void recordWav((stop) => {
      stopRecord = () => {
        clearTimeout(timer);
        stop();
      };
    })
      .then(async (wav) => {
        if (stopped) return;
        if (wav.size > 44) {
          const text = await transcribeWav(url, wav);
          if (text.trim()) handlers.onText(text.trim());
        }
        if (!stopped) cycle();
      })
      .catch((err: Error) => {
        if (!stopped) handlers.onError(err.message);
      });
  };
  cycle();
  return {
    stop() {
      stopped = true;
      stopRecord?.();
    },
  };
}

function beginWhisper(url: string, handlers: { onInterim: (text: string) => void; onText: (text: string) => void; onError: (message: string) => void }): HoldSession {
  let finish: (() => void) | null = null;
  let released = false;
  void recordWav((stop) => {
    finish = stop;
    if (released) stop();
  })
    .then(async (wav) => {
      if (wav.size <= 44) return;
      handlers.onText(await transcribeWav(url, wav));
    })
    .catch((err: Error) => handlers.onError(err.message));
  return {
    stop() {
      released = true;
      finish?.();
    },
  };
}

function recordWav(onReady: (stop: () => void) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(4096, 1, 1);
        const chunks: Float32Array[] = [];
        processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        source.connect(processor);
        const mute = context.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(context.destination);
        onReady(() => {
          processor.disconnect();
          source.disconnect();
          mute.disconnect();
          stream.getTracks().forEach((track) => track.stop());
          const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const merged = new Float32Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          const wav = encodeWav(merged, context.sampleRate);
          void context.close();
          resolve(wav);
        });
      })
      .catch(() => reject(new Error('Microphone permission was denied.')));
  });
}

export function speakReply(text: string): void {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
