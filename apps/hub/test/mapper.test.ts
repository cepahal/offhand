import type { GestureEvent, ViewerCommand } from '@hoverscan/contracts';
import { describe, expect, it } from 'vitest';
import { GestureMapper } from '../src/gesture/mapper.js';

const g = (name: Extract<GestureEvent, { t: 'g' }>['g'], seq = 1): GestureEvent => ({ t: 'g', g: name, seq, ms: 0 });
const h = (x: number, y: number, z = 0.5, seq = 1): GestureEvent => ({ t: 'h', x, y, z, seq, ms: 0 });
const types = (cmds: ViewerCommand[]) => cmds.map((c) => c.type);

describe('GestureMapper: default map', () => {
  const cases: Array<[Parameters<typeof g>[0], Record<string, unknown>]> = [
    ['left', { type: 'rotate', yawDeg: -10 }],
    ['right', { type: 'rotate', yawDeg: 10 }],
    ['up', { type: 'rotate', pitchDeg: 8 }],
    ['down', { type: 'rotate', pitchDeg: -8 }],
    ['forward', { type: 'zoom', factor: 1.08 }],
    ['backward', { type: 'zoom', factor: 1 / 1.08 }],
    ['cw', { type: 'peel', dir: 'out' }],
    ['ccw', { type: 'peel', dir: 'in' }],
  ];
  for (const [name, expected] of cases) {
    it(`${name} -> ${expected.type}`, () => {
      const m = new GestureMapper();
      const [cmd] = m.handle(g(name), 1000);
      expect(cmd).toMatchObject({ ...expected, source: 'gesture', ts: 1000 });
      expect(cmd?.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  }

  it('wave does nothing (voice is a hover hold)', () => {
    const m = new GestureMapper();
    expect(m.handle(g('wave'), 1000)).toEqual([]);
  });

  it('uses the configured source', () => {
    const m = new GestureMapper('keyboard');
    expect(m.handle(g('left'), 0)[0]?.source).toBe('keyboard');
  });
});

describe('GestureMapper: debounce', () => {
  it('drops a second gesture inside the window and accepts after it', () => {
    const m = new GestureMapper('gesture', { debounceMs: 250 });
    expect(m.handle(g('left'), 1000)).toHaveLength(1);
    expect(m.handle(g('left'), 1100)).toHaveLength(0);
    expect(m.handle(g('left'), 1249)).toHaveLength(0);
    expect(m.handle(g('left'), 1250)).toHaveLength(1);
  });

  it('drops the opposite rebound swipe for 650 ms, then accepts it', () => {
    const m = new GestureMapper('gesture', { debounceMs: 250 });
    expect(m.handle(g('left'), 1000)).toHaveLength(1);
    expect(m.handle(g('right'), 1300)).toHaveLength(0);
    expect(m.handle(g('right'), 1650)).toHaveLength(1);
  });

  it('ignores heartbeats and errors', () => {
    const m = new GestureMapper();
    expect(m.handle({ t: 'hb', fw: 'x', ms: 0 }, 0)).toEqual([]);
    expect(m.handle({ t: 'err', msg: 'x' }, 0)).toEqual([]);
  });
});

describe('GestureMapper: hover to speak', () => {
  const holdStill = (m: GestureMapper, from: number, to: number, x = 0.5) => {
    const out: ViewerCommand[] = [];
    for (let t = from; t <= to; t += 50) out.push(...m.handle(h(x, 0.5), t));
    return out;
  };

  it('toggles listening after 1.5 s of holding still, once per hold', () => {
    const m = new GestureMapper();
    expect(holdStill(m, 0, 1450)).toEqual([]);
    const on = holdStill(m, 1500, 3000);
    expect(types(on)).toEqual(['listen']);
    expect(on[0]).toMatchObject({ type: 'listen', on: true });
    expect(m.isListening).toBe(true);
  });

  it('moving restarts the hold', () => {
    const m = new GestureMapper();
    holdStill(m, 0, 1200);
    expect(holdStill(m, 1250, 2700, 0.9)).toEqual([]);
    expect(types(holdStill(m, 2750, 2750, 0.9))).toEqual(['listen']);
  });

  it('a second hold after the hand leaves toggles listening off', () => {
    const m = new GestureMapper();
    holdStill(m, 0, 1500);
    m.tick(2500); // hand gone
    const off = holdStill(m, 3000, 4500);
    expect(off[0]).toMatchObject({ type: 'listen', on: false });
  });

  it('a gesture during a hold restarts it', () => {
    const m = new GestureMapper();
    holdStill(m, 0, 1200);
    m.handle(g('left'), 1250);
    expect(holdStill(m, 1300, 2750)).toEqual([]);
    expect(types(holdStill(m, 2800, 2800))).toEqual(['listen']);
  });
});
