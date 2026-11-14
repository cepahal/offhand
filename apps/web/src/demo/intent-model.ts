/**
 * Local intent model. Centroids are the example phrases in config/voice/intents.json.
 * Slot text is whatever is left after the words shared by every example of the winning intent.
 *
 * TODO(verify): optional Nova Lite parsing when AI_MODE=live. This file only accepts a caller-supplied
 * remote parser and falls back here if that parser throws or scores under the threshold.
 */
import intentsFile from '../../../../config/voice/intents.json';

export const DIDNT_UNDERSTAND = "I didn't understand. Try: change medication, view allergies, view MRI, put a note here, or send to patient.";

export interface IntentExampleFile {
  threshold: number;
  intents: { name: string; examples: string[] }[];
}

export type IntentName = 'change_medication' | 'change_procedure' | 'view_history' | 'view_mri' | 'place_note' | 'send_instructions' | 'compare' | 'confirm' | 'cancel';

export interface IntentHit {
  intent: IntentName | 'unknown';
  confidence: number;
  person: string;
  value: string;
  say: string;
}

const file = intentsFile as IntentExampleFile;
export const INTENT_THRESHOLD = file.threshold;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function vector(words: readonly string[], vocab: readonly string[]): number[] {
  return vocab.map((word) => words.filter((item) => item === word).length);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / Math.sqrt(aa * bb);
}

const vocab = [...new Set(file.intents.flatMap((intent) => intent.examples.flatMap(tokens)))];

const centroids = file.intents.map((intent) => {
  const rows = intent.examples.map((example) => vector(tokens(example), vocab));
  const mean = vocab.map((_, i) => rows.reduce((sum, row) => sum + row[i]!, 0) / rows.length);
  const shared = tokens(intent.examples[0] ?? '').filter((word) => intent.examples.every((example) => tokens(example).includes(word)));
  return { name: intent.name as IntentName, mean, shared };
});

function slots(words: readonly string[], shared: readonly string[]): string[] {
  const spans: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    if (shared.includes(word)) {
      if (current.length) spans.push(current);
      current = [];
    } else current.push(word);
  }
  if (current.length) spans.push(current);
  return spans.map((span) => span.join(' '));
}

export function classifyLocal(text: string): IntentHit {
  const words = tokens(text);
  const probe = vector(words, vocab);
  const ranked = centroids
    .map((centroid) => ({ ...centroid, confidence: cosine(probe, centroid.mean) }))
    .sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  if (!best || best.confidence < INTENT_THRESHOLD) {
    return { intent: 'unknown', confidence: best?.confidence ?? 0, person: '', value: '', say: DIDNT_UNDERSTAND };
  }
  const parts = slots(words, best.shared);
  const person = best.name === 'place_note' || best.name === 'send_instructions' ? '' : (parts[0] ?? '');
  const value = best.name === 'place_note' || best.name === 'send_instructions' ? parts.join(' ') : (parts[1] ?? '');
  return { intent: best.name, confidence: best.confidence, person, value, say: '' };
}

export async function classifyUtterance(text: string, remote?: (text: string) => Promise<IntentHit | null>): Promise<IntentHit> {
  if (remote) {
    try {
      const parsed = await remote(text);
      if (parsed && parsed.intent !== 'unknown' && parsed.confidence >= INTENT_THRESHOLD) return parsed;
    } catch {
      // live parser failed; the local model still answers
    }
  }
  return classifyLocal(text);
}
