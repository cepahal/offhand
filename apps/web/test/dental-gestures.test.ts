import { describe, expect, it } from 'vitest';
import { createGestureGate, DENTAL_LAYER_GESTURES, mapDentalGesture } from '../src/demo/dental-gestures.js';

describe('dental gesture mapping', () => {
  it('maps the board gestures onto the model and nothing else', () => {
    expect(mapDentalGesture('left')).toEqual({ type: 'rotate', yawDeg: -18 });
    expect(mapDentalGesture('right')).toEqual({ type: 'rotate', yawDeg: 18 });
    expect(mapDentalGesture('up')).toEqual({ type: 'rotate', pitchDeg: 12 });
    expect(mapDentalGesture('down')).toEqual({ type: 'rotate', pitchDeg: -12 });
    expect(mapDentalGesture('forward')).toMatchObject({ type: 'zoom' });
    expect(mapDentalGesture('backward')).toMatchObject({ type: 'zoom' });
    expect(mapDentalGesture('cw')).toEqual({ type: 'peel', dir: 'out' });
    expect(mapDentalGesture('ccw')).toEqual({ type: 'peel', dir: 'in' });
    expect(mapDentalGesture('wave')).toEqual({ type: 'note' });
    const forward = mapDentalGesture('forward');
    const backward = mapDentalGesture('backward');
    if (forward.type === 'zoom' && backward.type === 'zoom') expect(forward.factor).toBeGreaterThan(backward.factor);
  });

  it('lets the spin directions be swapped and ignores a repeated event', () => {
    DENTAL_LAYER_GESTURES.clockwise = 'in';
    DENTAL_LAYER_GESTURES.counterclockwise = 'out';
    expect(mapDentalGesture('cw').type === 'peel' && mapDentalGesture('cw')).toMatchObject({ dir: 'in' });
    DENTAL_LAYER_GESTURES.clockwise = 'out';
    DENTAL_LAYER_GESTURES.counterclockwise = 'in';
    const gate = createGestureGate(280);
    expect(gate.accept({ g: 'left', seq: 4 }, 1000)?.type).toBe('rotate');
    expect(gate.accept({ g: 'right', seq: 4 }, 1100)).toBeNull();
    expect(gate.accept({ g: 'right', seq: 5 }, 1200)).toBeNull();
    expect(gate.accept({ g: 'wave', seq: 6 }, 1600)).toEqual({ type: 'note' });
  });
});
