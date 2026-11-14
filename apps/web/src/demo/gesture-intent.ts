/**
 * Turns raw PAJ7620 gestures (+ hover samples) into what the clinician meant.
 *
 * The sensor reports every pass of the hand, so repeating a swipe produces stroke, return, stroke,
 * return (up, down, up, down), and a push always arrives as forward + backward. Recorded board
 * sessions (715 gestures) show stroke→return gaps of 450–720 ms (90th percentile ~1.2–1.5 s) and the
 * hand leaving the sensor for only ~150–280 ms during a return.
 *
 * Model, per axis (yaw = left/right, pitch = up/down, zoom = toward/away):
 * - A run starts with the first stroke. It executes at once and sets the run's direction.
 * - One return per stroke: the next opposite gesture is absorbed as that stroke's return.
 *   A second opposite in a row is a deliberate reversal and executes.
 * - Same-direction gestures in the run execute (that is how "up, up, up" works).
 * - The run ends, so the next gesture is a fresh stroke, after a quiet gap scaled to the user's own
 *   rhythm, when the hand leaves the sensor for a while, or when it holds still in view (a pause).
 * - Push/pull: whichever of the pair comes first decides. Pushes start with the hand far away,
 *   pulls start with it close, which is the order the sensor already reports them in.
 * Voice: holding the hand still over the sensor for HOVER_TO_SPEAK_MS starts listening (or confirms
 * a pending command). Wave is ignored: it fired too easily. The hand must move or leave before the
 * next hold counts.
 * Pure and clock-injected (board milliseconds), so every rule is unit-tested.
 */
import type { GestureName } from '@hoverscan/contracts';
import { mapDentalGesture, type DentalGestureAction } from './dental-gestures.js';

export type GestureAxis = 'yaw' | 'pitch' | 'zoom';

const AXES: Partial<Record<GestureName, { axis: GestureAxis; sign: 1 | -1 }>> = {
  left: { axis: 'yaw', sign: -1 },
  right: { axis: 'yaw', sign: 1 },
  up: { axis: 'pitch', sign: 1 },
  down: { axis: 'pitch', sign: -1 },
  forward: { axis: 'zoom', sign: 1 },
  backward: { axis: 'zoom', sign: -1 },
};

export interface IntentConfig {
  /** Quiet gap that ends a run before the user's rhythm is known. */
  windowMs: number;
  minWindowMs: number;
  maxWindowMs: number;
  /** Run window = this × the median gap between gestures in recent runs. */
  rhythmFactor: number;
  /** Hand out of the sensor's view at least this long ends the run. */
  absentMs: number;
  /** Hand holding still in view at least this long ends the run. */
  holdMs: number;
  /** Largest hover movement (0..1 units) that still counts as holding still. */
  holdTolerance: number;
  /** The same gesture again within this is the sensor reporting one pass twice. */
  duplicateMs: number;
  /** Spin: quiet window between accepted events. */
  otherDebounceMs: number;
  /** Hold the hand still this long to speak / confirm. */
  hoverToSpeakMs: number;
}

export const DEFAULT_INTENT: IntentConfig = {
  windowMs: 1100,
  minWindowMs: 750,
  maxWindowMs: 1400,
  rhythmFactor: 1.7,
  absentMs: 750,
  holdMs: 650,
  holdTolerance: 0.08,
  duplicateMs: 160,
  otherDebounceMs: 280,
  hoverToSpeakMs: 1500,
};

export const HOVER_TO_SPEAK_MS = DEFAULT_INTENT.hoverToSpeakMs;

export type IntentDecision =
  | {
      kind: 'act';
      gesture: GestureName;
      action: DentalGestureAction;
      /** Consecutive same-direction strokes in this run (1 = single). */
      streak: number;
      reason: 'stroke' | 'repeat' | 'reversal' | 'other';
    }
  | { kind: 'return'; gesture: GestureName; of: GestureName }
  | { kind: 'drop'; gesture: GestureName; reason: 'repeat-seq' | 'duplicate' | 'debounce' | 'wave-off' };

/** What a hover sample means for voice: still building a hold, or the hold just completed. */
export type HoverDecision = { kind: 'holding'; progress: number } | { kind: 'speak' } | null;

interface AxisRun {
  dir: 1 | -1 | null;
  /** The last stroke has not had its return yet. */
  owed: boolean;
  lastAt: number;
  lastStrokeAt: number;
  lastStroke: GestureName | null;
  streak: number;
}

const freshRun = (): AxisRun => ({ dir: null, owed: false, lastAt: -Infinity, lastStrokeAt: -Infinity, lastStroke: null, streak: 0 });

export class GestureIntent {
  readonly cfg: IntentConfig;
  private runs: Record<GestureAxis, AxisRun> = { yaw: freshRun(), pitch: freshRun(), zoom: freshRun() };
  private lastSeq = -1;
  private lastTime = -Infinity;
  private lastOther: { g: GestureName; at: number } = { g: 'cw', at: -Infinity };
  private gaps: number[] = [];
  // Hover tracking since the last directional gesture.
  private lastHoverAt = -Infinity;
  private refAt = -Infinity;
  private maxGap = 0;
  private maxStill = 0;
  private still: { x: number; y: number; since: number } | null = null;
  /** Speak hold: anchor of the current hold and whether it already fired. */
  private hold: { x: number; y: number; since: number; fired: boolean } | null = null;

  constructor(cfg: Partial<IntentConfig> = {}) {
    this.cfg = { ...DEFAULT_INTENT, ...cfg };
  }

  /** Current run window, learned from the user's rhythm. */
  windowMs(): number {
    if (this.gaps.length < 3) return this.cfg.windowMs;
    const sorted = [...this.gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    return Math.min(this.cfg.maxWindowMs, Math.max(this.cfg.minWindowMs, median * this.cfg.rhythmFactor));
  }

  hover(sample: { x: number; y: number; ms: number }): HoverDecision {
    const t = sample.ms;
    if (t < this.lastTime - 5000) this.reset();
    const speak = this.trackHold(sample, t);
    const from = Math.max(this.lastHoverAt, this.refAt);
    if (Number.isFinite(from)) this.maxGap = Math.max(this.maxGap, t - from);
    const tol = this.cfg.holdTolerance;
    const continuous = t - this.lastHoverAt <= 160;
    if (!this.still || !continuous || Math.abs(sample.x - this.still.x) > tol || Math.abs(sample.y - this.still.y) > tol) {
      this.still = { x: sample.x, y: sample.y, since: t };
    }
    if (this.still.since >= this.refAt) this.maxStill = Math.max(this.maxStill, t - this.still.since);
    this.lastHoverAt = t;
    this.lastTime = Math.max(this.lastTime, t);
    return speak;
  }

  /** Hand-still hold for voice. Resets when the hand moves, leaves, or a gesture is made. */
  private trackHold(sample: { x: number; y: number }, t: number): HoverDecision {
    const tol = this.cfg.holdTolerance;
    const continuous = t - this.lastHoverAt <= 200;
    const moved = !this.hold || !continuous || Math.abs(sample.x - this.hold.x) > tol || Math.abs(sample.y - this.hold.y) > tol;
    if (moved) {
      this.hold = { x: sample.x, y: sample.y, since: t, fired: false };
      return null;
    }
    const h = this.hold!;
    if (h.fired) return null;
    const progress = (t - h.since) / this.cfg.hoverToSpeakMs;
    if (progress >= 1) {
      h.fired = true;
      return { kind: 'speak' };
    }
    return progress > 0.15 ? { kind: 'holding', progress } : null;
  }

  gesture(hit: { g: GestureName; seq: number; ms: number }): IntentDecision {
    const t = hit.ms;
    if (hit.seq === this.lastSeq) return { kind: 'drop', gesture: hit.g, reason: 'repeat-seq' };
    this.lastSeq = hit.seq;
    if (t < this.lastTime - 5000) this.reset(); // board rebooted, its clock restarted
    this.lastTime = Math.max(this.lastTime, t);

    // Any gesture is movement: a speak hold in progress starts over.
    this.hold = null;
    if (hit.g === 'wave') return { kind: 'drop', gesture: hit.g, reason: 'wave-off' };
    const mapped = AXES[hit.g];
    if (!mapped) return this.other(hit.g, t);

    // Did the hand leave, or pause, since the last gesture? Only when hover samples are streaming.
    const streaming = t - this.lastHoverAt < 4000;
    const tail = t - Math.max(this.lastHoverAt, this.refAt);
    const absent = streaming && Math.max(this.maxGap, tail) >= this.cfg.absentMs;
    const paused = streaming && this.maxStill >= this.cfg.holdMs;

    // Moving on another axis is a new intent: other runs end.
    for (const axis of Object.keys(this.runs) as GestureAxis[]) if (axis !== mapped.axis) this.runs[axis] = freshRun();
    const run = this.runs[mapped.axis];
    const gap = t - run.lastAt;
    const fresh = run.dir === null || gap > this.windowMs() || absent || paused;
    if (fresh) {
      Object.assign(run, freshRun());
    } else {
      this.gaps = [...this.gaps.slice(-7), gap];
    }
    this.markEvent(t);

    let decision: IntentDecision;
    if (run.dir === null) {
      decision = this.stroke(run, hit.g, mapped.sign, t, 'stroke');
    } else if (mapped.sign === run.dir) {
      if (t - run.lastStrokeAt < this.cfg.duplicateMs && run.lastStroke === hit.g) {
        decision = { kind: 'drop', gesture: hit.g, reason: 'duplicate' };
      } else {
        decision = this.stroke(run, hit.g, mapped.sign, t, 'repeat');
      }
    } else if (run.owed) {
      run.owed = false;
      decision = { kind: 'return', gesture: hit.g, of: run.lastStroke ?? hit.g };
    } else {
      decision = this.stroke(run, hit.g, mapped.sign, t, 'reversal');
    }
    run.lastAt = t;
    return decision;
  }

  reset(): void {
    this.runs = { yaw: freshRun(), pitch: freshRun(), zoom: freshRun() };
    this.lastTime = -Infinity;
    this.lastHoverAt = -Infinity;
    this.refAt = -Infinity;
    this.maxGap = 0;
    this.maxStill = 0;
    this.still = null;
    this.hold = null;
  }

  private stroke(run: AxisRun, g: GestureName, sign: 1 | -1, t: number, reason: 'stroke' | 'repeat' | 'reversal'): IntentDecision {
    run.streak = reason === 'repeat' ? run.streak + 1 : 1;
    run.dir = sign;
    run.owed = true;
    run.lastStrokeAt = t;
    run.lastStroke = g;
    return { kind: 'act', gesture: g, action: mapDentalGesture(g), streak: run.streak, reason };
  }

  private other(g: GestureName, t: number): IntentDecision {
    if (t - this.lastOther.at < this.cfg.otherDebounceMs) return { kind: 'drop', gesture: g, reason: 'debounce' };
    this.lastOther = { g, at: t };
    this.runs = { yaw: freshRun(), pitch: freshRun(), zoom: freshRun() };
    this.markEvent(t);
    return { kind: 'act', gesture: g, action: mapDentalGesture(g), streak: 1, reason: 'other' };
  }

  private markEvent(t: number): void {
    this.refAt = t;
    this.maxGap = 0;
    this.maxStill = 0;
    this.still = null;
  }
}
