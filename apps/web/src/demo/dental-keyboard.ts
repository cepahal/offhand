/**
 * Same keys as the clinician screen's keyboard stand-in.
 * The key becomes a gesture name. The workstation then uses the same handler as the board.
 */
import type { GestureName } from '@hoverscan/contracts';

export const DENTAL_GESTURE_KEYS: Record<string, GestureName> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  '[': 'cw',
  ']': 'ccw',
  '+': 'forward',
  '=': 'forward',
  '-': 'backward',
  _: 'backward',
  w: 'wave',
};

export function gestureFromKey(key: string): GestureName | null {
  const normalized = key.length === 1 ? key.toLowerCase() : key;
  return DENTAL_GESTURE_KEYS[normalized] ?? null;
}
