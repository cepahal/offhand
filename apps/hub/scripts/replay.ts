/**
 * Replay a recorded session into a running hub, with the original timing.
 *
 *   pnpm replay logs/session-<ts>.jsonl              commands only (default)
 *   pnpm replay <file> --gestures                    raw gesture events instead (re-mapped by the hub)
 *   pnpm replay <file> --speed 2                     twice as fast
 *   pnpm replay <file> --url ws://127.0.0.1:8787/ws
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusEnvelope } from '@hoverscan/contracts';
import { loadConfig, REPO_ROOT } from '../src/config.js';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(['--speed', '--url']);
let file: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (VALUED.has(a)) i++;
  else if (!a.startsWith('--')) {
    file = a;
    break;
  }
}
if (!file) {
  console.error('usage: pnpm replay <session.jsonl> [--gestures] [--speed N] [--url ws://...]');
  process.exit(1);
}
const cfg = loadConfig();
const speed = Number(opt('speed') ?? 1) || 1;
const url = opt('url') ?? `ws://127.0.0.1:${cfg.port}/ws`;
const gestures = args.includes('--gestures');

interface Rec {
  t: number;
  from: string;
  env: unknown;
}
const path = resolve(process.env.INIT_CWD ?? REPO_ROOT, file);
const recs: Rec[] = readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Rec)
  .filter((r) => {
    const env = BusEnvelope.safeParse(r.env);
    if (!env.success) return false;
    // Commands the hub itself derived from gestures would be produced again from the gestures.
    if (gestures) return env.data.ch === 'gesture';
    return env.data.ch === 'cmd';
  });

if (!recs.length) {
  console.error(`nothing to replay in ${path}`);
  process.exit(1);
}

const ws = new WebSocket(url);
await new Promise<void>((res, rej) => {
  ws.addEventListener('open', () => res());
  ws.addEventListener('error', () => rej(new Error(`cannot connect to ${url} - is the hub running?`)));
});
console.log(`replaying ${recs.length} ${gestures ? 'gesture events' : 'commands'} from ${path} at ${speed}x`);

const t0 = recs[0]!.t;
const start = Date.now();
for (const r of recs) {
  const due = start + (r.t - t0) / speed;
  const wait = due - Date.now();
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  ws.send(JSON.stringify(r.env));
  const env = r.env as { ch: string; cmd?: { type: string }; ev?: { t: string; g?: string } };
  console.log(`+${((r.t - t0) / 1000).toFixed(2)}s ${env.cmd?.type ?? `${env.ev?.t}${env.ev?.g ? ` ${env.ev.g}` : ''}`}`);
}
ws.close();
console.log('done');
