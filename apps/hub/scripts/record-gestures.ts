/**
 * Guided gesture recorder. Board only: keyboard gestures are not a source.
 *
 *   pnpm record:gestures
 *   pnpm record:gestures --only wave
 *
 * s then Enter skips the current gesture. q then Enter quits and keeps the samples.
 */
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { SerialPort } from 'serialport';
import { REPO_ROOT, loadConfig } from '../src/config.js';
import { GestureLink, type LinkStatus } from '../src/gesture/link.js';
import { appendSample, sessionFileName } from '../src/gesture/record-store.js';
import {
  GESTURE_INSTRUCTION,
  GESTURE_ORDER,
  GestureRecorder,
  boardFailure,
  deviceLabel,
  formatSummary,
  isRecordGesture,
  summaryRows,
  type RecordGesture,
} from '../src/gesture/recorder.js';

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const onlyName = onlyAt >= 0 ? args[onlyAt + 1] : undefined;
if (onlyAt >= 0 && (!onlyName || !isRecordGesture(onlyName))) {
  console.error(`--only needs one of: ${GESTURE_ORDER.join(', ')}`);
  process.exit(1);
}

const gestures: RecordGesture[] = onlyName && isRecordGesture(onlyName) ? [onlyName] : [...GESTURE_ORDER];
const samplesDir = join(REPO_ROOT, 'data', 'gesture-samples');
const fileName = sessionFileName(new Date());
const recorder = new GestureRecorder(gestures);
let filePath = join(samplesDir, fileName);

function finish(): void {
  const rows = summaryRows(
    Object.fromEntries(GESTURE_ORDER.map((gesture) => [gesture, recorder.count(gesture)])) as Record<RecordGesture, number>,
    gestures,
  );
  console.log(formatSummary(rows, filePath));
}

const cfg = loadConfig().gesture;
const link = new GestureLink(cfg);

const opened = await new Promise<'live' | 'no device' | 'port busy' | 'silent'>((resolve) => {
  const onStatus = (status: LinkStatus) => {
    if (status.state === 'live') resolve('live');
    const reason = boardFailure(status);
    if (reason) resolve(reason);
  };
  link.on('status', onStatus);
  link.start();
});

if (opened !== 'live') {
  await link.stop();
  console.error(opened);
  process.exit(1);
}

const ports = await SerialPort.list().catch(() => []);
console.log(`Connected to ${deviceLabel(ports)}.`);

const input = createInterface({ input: process.stdin });
const keys: string[] = [];
let wake: (() => void) | null = null;
input.on('line', (line) => {
  keys.push(line.trim().toLowerCase());
  wake?.();
});

let tickTimer: NodeJS.Timeout | null = null;
function startTick(): void {
  tickTimer = setInterval(() => {
    const notice = recorder.tick(Date.now());
    if (notice) console.log(notice.line);
  }, 100);
}

link.on('event', (ev) => {
  const notice = recorder.onEvent(ev, Date.now());
  if (!notice) return;
  if (notice.kind === 'progress' || notice.kind === 'next' || notice.kind === 'done') {
    const sample = recorder.samples.at(-1);
    if (sample) filePath = appendSample(samplesDir, fileName, sample);
  }
  console.log(notice.line);
  if (notice.kind === 'next' || notice.kind === 'done') wake?.();
});
link.on('comment', (text) => {
  const notice = recorder.onComment(text, Date.now());
  if (notice) console.log(notice.line);
});

function nextKey(): string | undefined {
  return keys.shift();
}

async function waitKey(ms: number): Promise<string | undefined> {
  const existing = nextKey();
  if (existing) return existing;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve(nextKey());
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve(nextKey());
    };
  });
}

startTick();
for (const gesture of gestures) {
  if (recorder.finished) break;
  console.log(GESTURE_INSTRUCTION[gesture]);
  console.log('Get ready... 3, 2, 1');
  let command: string | undefined;
  for (const step of [3, 2, 1]) {
    console.log(String(step));
    command = await waitKey(1000);
    if (command === 's' || command === 'q') break;
  }
  if (command === 'q') {
    recorder.quit();
    break;
  }
  if (command === 's') {
    const notice = recorder.skip();
    console.log(notice.line);
    continue;
  }
  const advanced = await new Promise<boolean>((resolve) => {
    wake = () => {
      const key = nextKey();
      if (key === 'q') {
        recorder.quit();
        resolve(true);
        return;
      }
      if (key === 's') {
        console.log(recorder.skip().line);
        resolve(true);
        return;
      }
      if (recorder.current !== gesture) resolve(true);
    };
    recorder.arm();
    console.log('Go.');
  });
  if (!advanced) break;
}

if (tickTimer) clearInterval(tickTimer);
input.close();
await link.stop();
finish();
