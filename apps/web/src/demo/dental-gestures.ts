/**
 * Gestures drive only the dental model.
 * Clockwise and counterclockwise peel directions are this object, so they can be swapped.
 */
import type { GestureName } from '@hoverscan/contracts';

export const DENTAL_LAYER_GESTURES: { clockwise: 'out' | 'in'; counterclockwise: 'out' | 'in' } = {
  clockwise: 'out',
  counterclockwise: 'in',
};

export type DentalGestureAction =
  | { type: 'rotate'; yawDeg?: number; pitchDeg?: number }
  | { type: 'zoom'; factor: number }
  | { type: 'peel'; dir: 'out' | 'in' }
  | { type: 'wake' };

export function mapDentalGesture(name: GestureName): DentalGestureAction {
  switch (name) {
    case 'left':
      return { type: 'rotate', yawDeg: -18 };
    case 'right':
      return { type: 'rotate', yawDeg: 18 };
    case 'up':
      return { type: 'rotate', pitchDeg: 12 };
    case 'down':
      return { type: 'rotate', pitchDeg: -12 };
    case 'forward':
      return { type: 'zoom', factor: 1.12 };
    case 'backward':
      return { type: 'zoom', factor: 1 / 1.12 };
    case 'cw':
      return { type: 'peel', dir: DENTAL_LAYER_GESTURES.clockwise };
    case 'ccw':
      return { type: 'peel', dir: DENTAL_LAYER_GESTURES.counterclockwise };
    case 'wave':
      return { type: 'wake' };
  }
}

const OPPOSITE: Record<GestureName, GestureName | null> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
  forward: 'backward',
  backward: 'forward',
  cw: 'ccw',
  ccw: 'cw',
  wave: null,
};

export interface GestureGate {
  accept(hit: { g: GestureName; seq: number }, now: number): DentalGestureAction | null;
}

/**
 * Drops a repeated sequence number, anything inside the quiet window,
 * and the opposite gesture that follows a swipe. That return stroke is how the
 * hand gets back into place, so it is not a new command.
 */
export function createGestureGate(debounceMs = 280): GestureGate {
  let lastSeq = -1;
  let lastAt = -Infinity;
  let suppressed: GestureName | null = null;
  return {
    accept(hit, now) {
      if (hit.seq === lastSeq || now - lastAt < debounceMs) return null;
      lastSeq = hit.seq;
      lastAt = now;
      if (hit.g === suppressed) return null;
      suppressed = OPPOSITE[hit.g];
      return mapDentalGesture(hit.g);
    },
  };
}
