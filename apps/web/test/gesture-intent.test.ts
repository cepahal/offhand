import { describe, expect, it } from 'vitest';
import type { GestureName } from '@hoverscan/contracts';
import { GestureIntent, type IntentDecision } from '../src/demo/gesture-intent.js';

let seq = 0;
function feed(intent: GestureIntent, events: [number, GestureName][]): IntentDecision[] {
  return events.map(([ms, g]) => intent.gesture({ g, seq: ++seq, ms }));
}
const acted = (ds: IntentDecision[]) => ds.filter((d) => d.kind === 'act').map((d) => d.gesture);

describe('gesture intent: repeated strokes and their returns', () => {
  it('turns up, down, up, down, up, down into three ups', () => {
    const ds = feed(new GestureIntent(), [[0, 'up'], [520, 'down'], [800, 'up'], [1350, 'down'], [1620, 'up'], [2200, 'down']]);
    expect(acted(ds)).toEqual(['up', 'up', 'up']);
    expect(ds.filter((d) => d.kind === 'return')).toHaveLength(3);
    const streaks = ds.flatMap((d) => (d.kind === 'act' ? [d.streak] : []));
    expect(streaks).toEqual([1, 2, 3]);
  });

  it('turns three pushes (forward then backward each time) into three zoom-ins', () => {
    const ds = feed(new GestureIntent(), [[0, 'forward'], [420, 'backward'], [1150, 'forward'], [1600, 'backward'], [2300, 'forward'], [2700, 'backward']]);
    expect(acted(ds)).toEqual(['forward', 'forward', 'forward']);
  });

  it('turns three pulls that start close to the sensor into three zoom-outs', () => {
    const ds = feed(new GestureIntent(), [[0, 'backward'], [600, 'forward'], [1000, 'backward'], [1650, 'forward'], [2050, 'backward'], [2700, 'forward']]);
    expect(acted(ds)).toEqual(['backward', 'backward', 'backward']);
  });

  it('still lets a single swipe go the other way after a short pause', () => {
    const ds = feed(new GestureIntent(), [[0, 'up'], [500, 'down'], [2200, 'down'], [2700, 'up']]);
    expect(acted(ds)).toEqual(['up', 'down']);
  });

  it('treats a second opposite in a row as a deliberate reversal', () => {
    const ds = feed(new GestureIntent(), [[0, 'right'], [450, 'left'], [900, 'left']]);
    expect(ds.map((d) => d.kind)).toEqual(['act', 'return', 'act']);
    expect(ds[2]).toMatchObject({ kind: 'act', gesture: 'left', reason: 'reversal' });
  });

  it('starts fresh when the hand leaves the sensor between strokes', () => {
    const intent = new GestureIntent();
    intent.gesture({ g: 'up', seq: ++seq, ms: 1000 });
    intent.hover({ x: 0.5, y: 0.2, ms: 1050 });
    intent.hover({ x: 0.5, y: 0.1, ms: 1100 });
    // nothing in view for ~800 ms, then a deliberate down
    expect(intent.gesture({ g: 'down', seq: ++seq, ms: 1900 })).toMatchObject({ kind: 'act', gesture: 'down' });
  });

  it('starts fresh when the hand holds still in view first', () => {
    const intent = new GestureIntent();
    intent.gesture({ g: 'up', seq: ++seq, ms: 1000 });
    for (let ms = 1050; ms <= 1750; ms += 50) intent.hover({ x: 0.52, y: 0.48, ms });
    expect(intent.gesture({ g: 'down', seq: ++seq, ms: 1800 })).toMatchObject({ kind: 'act', gesture: 'down' });
  });

  it('absorbs a return when the hand only crosses the sensor briefly', () => {
    const intent = new GestureIntent();
    intent.gesture({ g: 'up', seq: ++seq, ms: 1000 });
    for (const [ms, y] of [[1150, 0.8], [1200, 0.6], [1250, 0.4], [1300, 0.2]] as const) intent.hover({ x: 0.5, y, ms });
    expect(intent.gesture({ g: 'down', seq: ++seq, ms: 1450 })).toMatchObject({ kind: 'return' });
  });

  it('drops a double report of one pass and a repeated sequence number', () => {
    const intent = new GestureIntent();
    expect(intent.gesture({ g: 'left', seq: 50, ms: 0 }).kind).toBe('act');
    expect(intent.gesture({ g: 'left', seq: 50, ms: 10 })).toMatchObject({ kind: 'drop', reason: 'repeat-seq' });
    expect(intent.gesture({ g: 'left', seq: 51, ms: 90 })).toMatchObject({ kind: 'drop', reason: 'duplicate' });
    expect(intent.gesture({ g: 'left', seq: 52, ms: 600 })).toMatchObject({ kind: 'act', streak: 2 });
  });

  it('ends a run when the hand moves on another axis', () => {
    const ds = feed(new GestureIntent(), [[0, 'up'], [400, 'left'], [800, 'down']]);
    expect(acted(ds)).toEqual(['up', 'left', 'down']);
  });

  it('ignores wave and keeps spin on a short debounce', () => {
    const ds = feed(new GestureIntent(), [[0, 'wave'], [100, 'wave'], [500, 'cw'], [600, 'cw'], [1000, 'ccw']]);
    expect(ds.map((d) => d.kind)).toEqual(['drop', 'drop', 'act', 'drop', 'act']);
    expect(ds[0]).toMatchObject({ reason: 'wave-off' });
  });

  it('speaks after the hand is held still for 1.5 s, once per hold', () => {
    const intent = new GestureIntent();
    const out: string[] = [];
    for (let ms = 0; ms <= 2500; ms += 50) {
      const d = intent.hover({ x: 0.5 + (ms % 100 ? 0.01 : 0), y: 0.5, ms });
      if (d) out.push(d.kind);
    }
    expect(out.filter((k) => k === 'speak')).toHaveLength(1);
    expect(out.indexOf('speak')).toBeGreaterThan(out.indexOf('holding'));
    // first speak lands at 1.5 s
    const again = new GestureIntent();
    let at = -1;
    for (let ms = 0; ms <= 2000 && at < 0; ms += 50) if (again.hover({ x: 0.5, y: 0.5, ms })?.kind === 'speak') at = ms;
    expect(at).toBe(1500);
  });

  it('restarts the hold when the hand moves, leaves, or makes a gesture', () => {
    const intent = new GestureIntent();
    const hold = (from: number, to: number, x = 0.5) => {
      let spoke = false;
      for (let ms = from; ms <= to; ms += 50) if (intent.hover({ x, y: 0.5, ms })?.kind === 'speak') spoke = true;
      return spoke;
    };
    expect(hold(0, 1200)).toBe(false);
    expect(hold(1250, 2000, 0.8)).toBe(false); // moved: timer restarts at 1250
    expect(hold(2050, 2800, 0.8)).toBe(true);
    expect(hold(3500, 4400)).toBe(false); // hand left and came back: new hold
    intent.gesture({ g: 'left', seq: 9001, ms: 4450 });
    expect(hold(4500, 5900)).toBe(false); // a gesture resets the hold
    expect(hold(5950, 6000)).toBe(true);
  });

  it('recovers when the board reboots and its clock restarts', () => {
    const intent = new GestureIntent();
    feed(intent, [[90_000, 'up']]);
    expect(intent.gesture({ g: 'down', seq: ++seq, ms: 300 })).toMatchObject({ kind: 'act', gesture: 'down' });
  });

  it('learns a faster rhythm and shortens the run window', () => {
    const intent = new GestureIntent();
    feed(intent, [[0, 'up'], [380, 'down'], [760, 'up'], [1140, 'down'], [1520, 'up']]);
    expect(intent.windowMs()).toBe(750);
    // 900 ms later the down is a new intent, not a return
    expect(intent.gesture({ g: 'down', seq: ++seq, ms: 2420 })).toMatchObject({ kind: 'act' });
  });
});
