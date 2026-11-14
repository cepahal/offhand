import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GestureEvent } from '@hoverscan/contracts';
import type { LinkStatus } from '../src/gesture/link.js';
import { appendSample } from '../src/gesture/record-store.js';
import {
  DETECT_PAUSE_MS,
  GESTURE_ORDER,
  GestureRecorder,
  RECORD_TARGET,
  boardFailure,
  deviceLabel,
  formatSummary,
  summaryRows,
} from '../src/gesture/recorder.js';

function hit(g: string, seq: number, ms: number): GestureEvent {
  return { t: 'g', g: g as 'left', seq, ms };
}

function hover(seq: number, ms: number, x = 0.5): GestureEvent {
  return { t: 'h', x, y: 0.5, z: 0.4, seq, ms };
}

describe('gesture recorder', () => {
  it('counts only a matching detection after Go and outside the pause', () => {
    const rec = new GestureRecorder(['left']);
    expect(rec.onEvent(hit('left', 1, 10), 10)).toBeNull();
    rec.arm();
    expect(rec.onEvent(hit('right', 2, 20), 20)).toBeNull();
    expect(rec.onEvent(hit('left', 3, 30), 30)?.line).toBe(`swipe left 1/${RECORD_TARGET} ✓`);
    expect(rec.onEvent(hit('left', 4, 40), 30 + DETECT_PAUSE_MS - 1)).toBeNull();
    expect(rec.count('left')).toBe(1);
    expect(rec.onEvent(hit('left', 5, 50), 30 + DETECT_PAUSE_MS)?.line).toBe(`swipe left 2/${RECORD_TARGET} ✓`);
    expect(rec.count('left')).toBe(2);
  });

  it('ignores a hand-left during the pause and does not count a leave without a gesture', () => {
    const rec = new GestureRecorder(['left']);
    rec.arm();
    expect(rec.onEvent(hit('left', 1, 1), 1000)?.line).toBe(`swipe left 1/${RECORD_TARGET} ✓`);
    expect(rec.onComment('[HOVER] hand left view after 0.4 s', 1000 + DETECT_PAUSE_MS - 1)).toBeNull();
    expect(rec.count('left')).toBe(1);
    rec.arm();
    expect(rec.onEvent(hover(2, 2), 5000)).toBeNull();
    expect(rec.onComment('[HOVER] hand left view after 0.2 s', 5200)?.line).toBe('not counted, try again');
    expect(rec.count('left')).toBe(1);
  });

  it('keeps samples already taken when the gesture is skipped or the session quits', () => {
    const rec = new GestureRecorder(['left', 'right']);
    rec.arm();
    rec.onEvent(hit('left', 1, 1), 0);
    expect(rec.samples).toHaveLength(1);
    expect(rec.skip().line).toBe('left skipped');
    expect(rec.samples).toHaveLength(1);
    rec.arm();
    rec.onEvent(hit('right', 2, 2), DETECT_PAUSE_MS);
    expect(rec.quit().line).toBe('quit');
    expect(rec.samples.map((sample) => sample.gesture)).toEqual(['left', 'right']);
    expect(rec.finished).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'gesture-samples-'));
    const file = appendSample(dir, 'session.jsonl', rec.samples[0]!);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { gesture: string; seq: number; ms: number; label: string; event: GestureEvent };
    expect(saved).toMatchObject({ gesture: 'left', seq: 1, ms: 1, label: 'left', event: { t: 'g', g: 'left' } });
  });

  it('marks 20 as OK and anything below as LOW', () => {
    const counts = Object.fromEntries(GESTURE_ORDER.map((name) => [name, name === 'left' ? RECORD_TARGET : 3])) as Record<(typeof GESTURE_ORDER)[number], number>;
    const rows = summaryRows(counts, ['left', 'wave']);
    expect(rows[0]).toEqual({ gesture: 'left', count: RECORD_TARGET, status: 'OK' });
    expect(rows[1]).toEqual({ gesture: 'wave', count: 3, status: 'LOW' });
    const text = formatSummary(rows, 'data/gesture-samples/session.jsonl');
    expect(text).toMatch(new RegExp(`left\\s+${RECORD_TARGET}\\s+OK`));
    expect(text).toContain('pnpm record:gestures --only wave');
  });

  it('prints a device name and a failure reason with no port path or serial number', () => {
    const secret = '/dev/cu.usbserial-0001';
    const base = { paj: 'ok' as const, since: 0 };
    const status: LinkStatus = { ...base, state: 'silent', detail: `${secret} silent`, port: secret };
    expect(boardFailure(status)).toBe('silent');
    expect(boardFailure({ ...base, state: 'no_device', detail: secret })).toBe('no device');
    expect(boardFailure({ ...base, state: 'error', detail: `EBUSY ${secret}` })).toBe('port busy');
    const label = deviceLabel([{ path: secret, vendorId: '10C4', manufacturer: 'SER-998877' }]);
    const printed = [`Connected to ${label}.`, boardFailure(status), formatSummary(summaryRows({ left: 1 } as never, ['left']), 'data/gesture-samples/session.jsonl')].join('\n');
    expect(label).toBe('Silicon Labs CP210x');
    expect(printed).not.toContain(secret);
    expect(printed).not.toMatch(/SER-998877|COM\d/);
  });
});
