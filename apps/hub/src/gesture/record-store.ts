/**
 * Append-only gesture samples. The directory is git-ignored with the rest of data/.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GestureSample } from './recorder.js';

export function sessionFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${stamp}.jsonl`;
}

export function appendSample(dir: string, fileName: string, sample: GestureSample): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, fileName);
  appendFileSync(file, `${JSON.stringify(sample)}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}
