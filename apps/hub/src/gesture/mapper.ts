import {
  makeCommand,
  type CommandSource,
  type GestureEvent,
  type GestureName,
  type ViewerCommand,
  type ViewerCommandBody,
} from '@hoverscan/contracts';

export interface MapperConfig {
  /** Ignore a gesture that arrives within this many ms of the previous accepted one. */
  debounceMs: number;
  yawStepDeg: number;
  pitchStepDeg: number;
  /** forward = zoom by this factor, backward = 1/factor. */
  zoomFactor: number;
  /** Hand must stay still this long before scrub mode starts. */
  hoverHoldMs: number;
  /** Max movement (normalised units, per axis) that still counts as "still". */
  hoverStillTolerance: number;
  /** No hover sample for this long = hand pulled away. */
  hoverLostMs: number;
  /** Which hover axis drives the scrub value. */
  scrubAxis: 'x' | 'y' | 'z';
  scrubInvert: boolean;
  /** Minimum change before a new scrub command is sent. */
  scrubDeadband: number;
  /** Minimum time between scrub commands (caps the rate at ~20 Hz). */
  scrubMinIntervalMs: number;
}

export const DEFAULT_MAPPER_CONFIG: MapperConfig = {
  debounceMs: 250,
  yawStepDeg: 10,
  pitchStepDeg: 8,
  zoomFactor: 1.08,
  hoverHoldMs: 1000,
  hoverStillTolerance: 0.06,
  hoverLostMs: 400,
  scrubAxis: 'y',
  scrubInvert: false,
  scrubDeadband: 0.01,
  scrubMinIntervalMs: 50,
};

/**
 * Default gesture map (00-plan): left/right yaw -/+30 deg, up/down pitch +/-20 deg,
 * forward/backward zoom in/out, cw/ccw peel out/in, wave toggles push-to-talk.
 */
export function gestureToBody(g: GestureName, cfg: MapperConfig, listening: boolean): ViewerCommandBody {
  switch (g) {
    case 'left':
      return { type: 'rotate', yawDeg: -cfg.yawStepDeg };
    case 'right':
      return { type: 'rotate', yawDeg: cfg.yawStepDeg };
    case 'up':
      return { type: 'rotate', pitchDeg: cfg.pitchStepDeg };
    case 'down':
      return { type: 'rotate', pitchDeg: -cfg.pitchStepDeg };
    case 'forward':
      return { type: 'zoom', factor: cfg.zoomFactor };
    case 'backward':
      return { type: 'zoom', factor: 1 / cfg.zoomFactor };
    case 'cw':
      return { type: 'peel', dir: 'out' };
    case 'ccw':
      return { type: 'peel', dir: 'in' };
    case 'wave':
      return { type: 'listen', on: !listening };
  }
}

interface HoverSample {
  x: number;
  y: number;
  z: number;
}

/**
 * Turns raw board events into ViewerCommands. Pure and clock-injected so it is unit-testable:
 * call handle() for every event and tick() periodically (e.g. every 50 ms).
 */
export class GestureMapper {
  readonly cfg: MapperConfig;
  private mode: 'orbit' | 'scrub' = 'orbit';
  private listening = false;
  private lastAcceptedAt = -Infinity;
  private lastGesture: GestureName | null = null;
  private lastDirectionalAt = -Infinity;
  private anchor: HoverSample | null = null;
  private anchorAt = 0;
  private lastHoverAt = -Infinity;
  private lastScrub = -1;
  private lastScrubAt = -Infinity;

  constructor(
    private readonly source: CommandSource = 'gesture',
    cfg: Partial<MapperConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_MAPPER_CONFIG, ...cfg };
  }

  get currentMode(): 'orbit' | 'scrub' {
    return this.mode;
  }

  handle(ev: GestureEvent, now: number): ViewerCommand[] {
    if (ev.t === 'g') return this.onGesture(ev.g, now);
    if (ev.t === 'h') return this.onHover({ x: ev.x, y: ev.y, z: ev.z }, now);
    return [];
  }

  tick(now: number): ViewerCommand[] {
    const gone = now - this.lastHoverAt > this.cfg.hoverLostMs;
    if (!gone) return [];
    this.anchor = null;
    if (this.mode === 'scrub') return [this.setMode('orbit', now)];
    return [];
  }

  private onGesture(g: GestureName, now: number): ViewerCommand[] {
    // In scrub mode the hand is moving up/down on purpose; only wave gets through.
    if (this.mode === 'scrub' && g !== 'wave') return [];
    // PAJ reports the hand's return-to-center as the opposite gesture. Suppress
    // that rebound briefly, while still allowing deliberate repetitions.
    const opposite: Partial<Record<GestureName, GestureName>> = {
      left: 'right', right: 'left', up: 'down', down: 'up',
      forward: 'backward', backward: 'forward', cw: 'ccw', ccw: 'cw',
    };
    if (this.lastGesture && opposite[this.lastGesture] === g && now - this.lastDirectionalAt < 650) return [];
    if (now - this.lastAcceptedAt < this.cfg.debounceMs) return [];
    this.lastAcceptedAt = now;
    this.lastGesture = g;
    this.lastDirectionalAt = now;
    this.anchor = null; // a swipe is not a hold
    const body = gestureToBody(g, this.cfg, this.listening);
    if (body.type === 'listen') this.listening = body.on;
    return [makeCommand(body, this.source, now)];
  }

  private onHover(s: HoverSample, now: number): ViewerCommand[] {
    this.lastHoverAt = now;
    if (this.mode === 'scrub') return this.maybeScrub(s, now);

    const tol = this.cfg.hoverStillTolerance;
    const moved =
      !this.anchor || Math.abs(s.x - this.anchor.x) > tol || Math.abs(s.y - this.anchor.y) > tol;
    if (moved) {
      this.anchor = s;
      this.anchorAt = now;
      return [];
    }
    if (now - this.anchorAt < this.cfg.hoverHoldMs) return [];
    // Held still long enough -> scrub mode.
    this.lastScrub = -1;
    this.lastScrubAt = -Infinity;
    return [this.setMode('scrub', now), ...this.maybeScrub(s, now)];
  }

  private maybeScrub(s: HoverSample, now: number): ViewerCommand[] {
    let v = s[this.cfg.scrubAxis];
    if (this.cfg.scrubInvert) v = 1 - v;
    v = Math.min(1, Math.max(0, v));
    if (Math.abs(v - this.lastScrub) < this.cfg.scrubDeadband) return [];
    if (now - this.lastScrubAt < this.cfg.scrubMinIntervalMs) return [];
    this.lastScrub = v;
    this.lastScrubAt = now;
    return [makeCommand({ type: 'scrub', value: Math.round(v * 1000) / 1000 }, this.source, now)];
  }

  private setMode(mode: 'orbit' | 'scrub', now: number): ViewerCommand {
    this.mode = mode;
    return makeCommand({ type: 'mode', mode }, this.source, now);
  }
}
