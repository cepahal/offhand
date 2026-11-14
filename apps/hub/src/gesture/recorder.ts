/**
 * Guided recording session. Pure: the CLI feeds board events and key lines.
 *
 * TODO(verify): firmware contractName() emits only up, down, left, right, forward,
 * backward, cw, ccw, and wave on {"t":"g"}. It does not emit "hold". A hold here is
 * a hand that stays within 0.08 (the mapper's hoverStillTolerance) for 1500 ms (hover to speak) on
 * {"t":"h"} samples, which the firmware sends only while hover output is enabled.
 * "Hand left" is the firmware comment "[HOVER] hand left view", not a gesture event.
 */
import type { GestureEvent, GestureHover } from '@hoverscan/contracts';
import type { LinkStatus, PortInfoLite } from './link.js';
import { KNOWN_BRIDGES } from './link.js';

export const RECORD_TARGET = 5;
export const DETECT_PAUSE_MS = 1500;
export const HOLD_STILL_MS = 1500;
export const HOLD_TOLERANCE = 0.08;
export const HAND_GONE_MS = 400;

export const GESTURE_ORDER = ['left', 'right', 'up', 'down', 'forward', 'backward', 'cw', 'ccw', 'wave', 'hold'] as const;
export type RecordGesture = (typeof GESTURE_ORDER)[number];

export const GESTURE_INSTRUCTION: Record<RecordGesture, string> = {
  left: 'Swipe your hand left, then return it.',
  right: 'Swipe right, then return.',
  up: 'Lift your hand up, then return.',
  down: 'Lower your hand, then return.',
  forward: 'Push your hand toward the sensor, then pull back.',
  backward: 'Pull your hand back, then push forward.',
  cw: 'Spin clockwise.',
  ccw: 'Spin counterclockwise.',
  wave: 'Wave side to side.',
  hold: 'Hold your hand still for one second.',
};

const PROGRESS: Record<RecordGesture, string> = {
  left: 'swipe left',
  right: 'swipe right',
  up: 'swipe up',
  down: 'swipe down',
  forward: 'push forward',
  backward: 'pull back',
  cw: 'spin clockwise',
  ccw: 'spin counterclockwise',
  wave: 'wave',
  hold: 'hold',
};

export interface GestureSample {
  gesture: RecordGesture;
  seq: number;
  ms: number;
  label: RecordGesture;
  event: GestureEvent;
}

export interface GestureSummaryRow {
  gesture: RecordGesture;
  count: number;
  status: 'OK' | 'LOW';
}

export function isRecordGesture(name: string): name is RecordGesture {
  return (GESTURE_ORDER as readonly string[]).includes(name);
}

/** The three board failures the recorder prints. Never includes a port path. */
export function boardFailure(status: LinkStatus): 'no device' | 'port busy' | 'silent' | null {
  if (status.state === 'no_device' || status.state === 'off') return 'no device';
  if (status.state === 'silent') return 'silent';
  if (status.state === 'error') return 'port busy';
  return null;
}

/** Device name only. A port path or USB serial number is not included. */
export function deviceLabel(ports: readonly PortInfoLite[]): string {
  const match = ports.find((port) => port.vendorId && KNOWN_BRIDGES[port.vendorId.toLowerCase()]);
  const vid = match?.vendorId?.toLowerCase();
  if (vid && KNOWN_BRIDGES[vid]) return KNOWN_BRIDGES[vid];
  return 'gesture board';
}

export function summaryRows(counts: Readonly<Record<RecordGesture, number>>, gestures: readonly RecordGesture[]): GestureSummaryRow[] {
  return gestures.map((gesture) => {
    const count = counts[gesture] ?? 0;
    return { gesture, count, status: count >= RECORD_TARGET ? 'OK' : 'LOW' };
  });
}

export function formatSummary(rows: readonly GestureSummaryRow[], file: string): string {
  const nameW = Math.max(7, ...rows.map((row) => row.gesture.length));
  const lines = [`${'gesture'.padEnd(nameW)}  recorded  status`];
  for (const row of rows) lines.push(`${row.gesture.padEnd(nameW)}  ${String(row.count).padStart(8)}  ${row.status}`);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  lines.push(`file: ${file}`);
  lines.push(`total: ${total}`);
  for (const row of rows) {
    if (row.status === 'LOW') lines.push(`LOW: ${row.gesture} did not reach ${RECORD_TARGET}. Re-record with: pnpm record:gestures --only ${row.gesture}`);
  }
  return lines.join('\n');
}

export interface RecorderNotice {
  kind: 'progress' | 'miss' | 'next' | 'done' | 'skip' | 'quit';
  line: string;
}

/**
 * One recording pass. Call arm() after the countdown. Events before that, and events
 * sooner than 1.5 s after the previous accepted detection, are ignored.
 */
export class GestureRecorder {
  readonly samples: GestureSample[] = [];
  private readonly counts: Record<RecordGesture, number>;
  private index = 0;
  private phase: 'wait' | 'live' = 'wait';
  private lastAcceptAt = -Infinity;
  private handPresent = false;
  private countedThisPresence = false;
  private lastHoverAt = -Infinity;
  private anchor: { x: number; y: number; z: number; at: number } | null = null;
  private holdCounted = false;

  constructor(readonly gestures: readonly RecordGesture[]) {
    this.counts = { left: 0, right: 0, up: 0, down: 0, forward: 0, backward: 0, cw: 0, ccw: 0, wave: 0, hold: 0 };
  }

  get current(): RecordGesture | null {
    return this.gestures[this.index] ?? null;
  }

  get finished(): boolean {
    return this.index >= this.gestures.length;
  }

  count(gesture: RecordGesture): number {
    return this.counts[gesture];
  }

  arm(): void {
    if (this.finished) return;
    this.phase = 'live';
    this.handPresent = false;
    this.countedThisPresence = false;
    this.anchor = null;
    this.holdCounted = false;
  }

  onEvent(ev: GestureEvent, now: number): RecorderNotice | null {
    if (this.phase !== 'live' || this.finished) return null;
    if (now - this.lastAcceptAt < DETECT_PAUSE_MS) return null;
    const gesture = this.current;
    if (!gesture) return null;
    if (ev.t === 'h') return this.onHover(ev, gesture, now);
    if (ev.t !== 'g' || ev.g !== gesture) return null;
    return this.accept(gesture, ev, now);
  }

  onComment(text: string, now: number): RecorderNotice | null {
    if (this.phase !== 'live' || this.finished) return null;
    if (now - this.lastAcceptAt < DETECT_PAUSE_MS) return null;
    if (!/hand left view/i.test(text)) return null;
    return this.handLeft();
  }

  /** Call while waiting so a hand that vanishes without a "left view" line is not counted. */
  tick(now: number): RecorderNotice | null {
    if (this.phase !== 'live' || this.finished) return null;
    if (now - this.lastAcceptAt < DETECT_PAUSE_MS) return null;
    if (!this.handPresent || this.countedThisPresence) return null;
    if (now - this.lastHoverAt <= HAND_GONE_MS) return null;
    return this.handLeft();
  }

  skip(): RecorderNotice {
    const gesture = this.current;
    this.phase = 'wait';
    this.index += 1;
    const line = gesture ? `${gesture} skipped` : 'nothing to skip';
    return { kind: this.finished ? 'done' : 'skip', line };
  }

  quit(): RecorderNotice {
    this.phase = 'wait';
    this.index = this.gestures.length;
    return { kind: 'quit', line: 'quit' };
  }

  private onHover(ev: GestureHover, gesture: RecordGesture, now: number): RecorderNotice | null {
    this.handPresent = true;
    this.lastHoverAt = now;
    if (gesture !== 'hold') return null;
    const moved = !this.anchor || Math.abs(ev.x - this.anchor.x) > HOLD_TOLERANCE || Math.abs(ev.y - this.anchor.y) > HOLD_TOLERANCE || Math.abs(ev.z - this.anchor.z) > HOLD_TOLERANCE;
    if (moved) {
      this.anchor = { x: ev.x, y: ev.y, z: ev.z, at: now };
      this.holdCounted = false;
      return null;
    }
    if (this.holdCounted || now - this.anchor!.at < HOLD_STILL_MS) return null;
    this.holdCounted = true;
    return this.accept('hold', ev, now);
  }

  private handLeft(): RecorderNotice | null {
    const present = this.handPresent;
    this.handPresent = false;
    this.anchor = null;
    this.holdCounted = false;
    if (!present || this.countedThisPresence) return null;
    this.countedThisPresence = false;
    return { kind: 'miss', line: 'not counted, try again' };
  }

  private accept(gesture: RecordGesture, ev: GestureEvent, now: number): RecorderNotice {
    this.lastAcceptAt = now;
    this.countedThisPresence = true;
    this.counts[gesture] += 1;
    const count = this.counts[gesture];
    const seq = ev.t === 'g' || ev.t === 'h' ? ev.seq : 0;
    const ms = ev.t === 'hb' ? ev.ms : ev.t === 'err' ? 0 : ev.ms;
    this.samples.push({ gesture, seq, ms, label: gesture, event: ev });
    const progress = `${PROGRESS[gesture]} ${count}/${RECORD_TARGET} ✓`;
    if (count < RECORD_TARGET) return { kind: 'progress', line: progress };
    this.phase = 'wait';
    this.index += 1;
    const next = this.current;
    const line = next ? `${progress}\n${gesture} done, next: ${next}` : `${progress}\n${gesture} done`;
    return { kind: this.finished ? 'done' : 'next', line };
  }
}
