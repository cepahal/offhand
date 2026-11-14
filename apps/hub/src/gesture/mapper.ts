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
  /** Hand held still over the board this long = speak (toggle listening / confirm). */
  hoverHoldMs: number;
  /** Max movement (normalised units, per axis) that still counts as "still". */
  hoverStillTolerance: number;
  /** No hover sample for this long = hand pulled away. */
  hoverLostMs: number;
}

export const DEFAULT_MAPPER_CONFIG: MapperConfig = {
  debounceMs: 250,
  yawStepDeg: 10,
  pitchStepDeg: 8,
  zoomFactor: 1.08,
  hoverHoldMs: 1500,
  hoverStillTolerance: 0.08,
  hoverLostMs: 400,
};

/**
 * Gesture map: left/right yaw, up/down pitch, forward/backward zoom in/out, cw/ccw peel out/in.
 * Wave maps to nothing: it fired too easily. Voice is a 1.5 s hover (see GestureMapper.onHover).
 */
export function gestureToBody(g: GestureName, cfg: MapperConfig): ViewerCommandBody | null {
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
      return null;
  }
}

interface HoverSample {
  x: number;
  y: number;
}

/**
 * Turns raw board events into ViewerCommands. Pure and clock-injected so it is unit-testable:
 * call handle() for every event and tick() periodically (e.g. every 50 ms).
 *
 * Holding the hand still over the board for hoverHoldMs toggles listening ({type:'listen'}), once
 * per hold: the hand must move or leave before another hold counts. A gesture restarts the hold.
 */
export class GestureMapper {
  readonly cfg: MapperConfig;
  private listening = false;
  private lastAcceptedAt = -Infinity;
  private lastGesture: GestureName | null = null;
  private lastDirectionalAt = -Infinity;
  private anchor: HoverSample | null = null;
  private anchorAt = 0;
  private fired = false;
  private lastHoverAt = -Infinity;

  constructor(
    private readonly source: CommandSource = 'gesture',
    cfg: Partial<MapperConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_MAPPER_CONFIG, ...cfg };
  }

  get isListening(): boolean {
    return this.listening;
  }

  handle(ev: GestureEvent, now: number): ViewerCommand[] {
    if (ev.t === 'g') return this.onGesture(ev.g, now);
    if (ev.t === 'h') return this.onHover({ x: ev.x, y: ev.y }, now);
    return [];
  }

  tick(now: number): ViewerCommand[] {
    if (now - this.lastHoverAt > this.cfg.hoverLostMs) {
      this.anchor = null;
      this.fired = false;
    }
    return [];
  }

  private onGesture(g: GestureName, now: number): ViewerCommand[] {
    this.anchor = null; // a gesture is movement, not a hold
    this.fired = false;
    const body = gestureToBody(g, this.cfg);
    if (!body) return [];
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
    return [makeCommand(body, this.source, now)];
  }

  private onHover(s: HoverSample, now: number): ViewerCommand[] {
    const lost = now - this.lastHoverAt > this.cfg.hoverLostMs;
    this.lastHoverAt = now;
    const tol = this.cfg.hoverStillTolerance;
    const moved = lost || !this.anchor || Math.abs(s.x - this.anchor.x) > tol || Math.abs(s.y - this.anchor.y) > tol;
    if (moved) {
      this.anchor = s;
      this.anchorAt = now;
      this.fired = false;
      return [];
    }
    if (this.fired || now - this.anchorAt < this.cfg.hoverHoldMs) return [];
    this.fired = true;
    this.listening = !this.listening;
    return [makeCommand({ type: 'listen', on: this.listening }, this.source, now)];
  }
}
