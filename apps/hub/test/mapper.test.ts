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

  it('wave toggles listen on/off', () => {
    const m = new GestureMapper();
    expect(m.handle(g('wave'), 1000)[0]).toMatchObject({ type: 'listen', on: true });
    expect(m.handle(g('wave'), 2000)[0]).toMatchObject({ type: 'listen', on: false });
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

describe('GestureMapper: hover hold -> scrub', () => {
  const holdStill = (m: GestureMapper, from: number, to: number, y = 0.5) => {
    const out: ViewerCommand[] = [];
    for (let t = from; t <= to; t += 50) out.push(...m.handle(h(0.5, y), t));
    return out;
  };

  it('enters scrub mode after holding still for hoverHoldMs', () => {
    const m = new GestureMapper();
    expect(holdStill(m, 0, 950)).toEqual([]);
    const cmds = holdStill(m, 1000, 1000, 0.5);
    expect(types(cmds)).toEqual(['mode', 'scrub']);
    expect(cmds[0]).toMatchObject({ mode: 'scrub' });
    expect(cmds[1]).toMatchObject({ value: 0.5 });
    expect(m.currentMode).toBe('scrub');
  });

  it('moving resets the hold timer', () => {
    const m = new GestureMapper();
    holdStill(m, 0, 800);
    m.handle(h(0.5, 0.9), 850); // hand jumped, then holds still at the new height
    expect(holdStill(m, 900, 1800, 0.9)).toEqual([]);
    expect(types(holdStill(m, 1850, 1850, 0.9))).toEqual(['mode', 'scrub']);
  });

  it('hand height drives scrub value, with deadband', () => {
    const m = new GestureMapper();
    holdStill(m, 0, 1000, 0.2);
    expect(m.handle(h(0.5, 0.205), 1100)).toEqual([]); // inside deadband
    expect(m.handle(h(0.5, 0.6), 1200)[0]).toMatchObject({ type: 'scrub', value: 0.6 });
    expect(m.handle(h(0.5, 1.2), 1300)[0]).toMatchObject({ type: 'scrub', value: 1 }); // clamped
  });

  it('respects scrubInvert and scrubAxis', () => {
    const m = new GestureMapper('gesture', { scrubAxis: 'z', scrubInvert: true });
    for (let t = 0; t <= 1000; t += 50) m.handle(h(0.5, 0.5, 0.3), t);
    expect(m.handle(h(0.5, 0.5, 0.1), 1100)[0]).toMatchObject({ type: 'scrub', value: 0.9 });
  });

  it('suppresses swipes while scrubbing, but wave still works', () => {
    const m = new GestureMapper();
    holdStill(m, 0, 1000);
    expect(m.handle(g('up'), 1100)).toEqual([]);
    expect(m.handle(g('wave'), 1200)[0]).toMatchObject({ type: 'listen' });
  });

  it('pulling the hand away exits scrub mode', () => {
    const m = new GestureMapper('gesture', { hoverLostMs: 400 });
    holdStill(m, 0, 1000);
    expect(m.tick(1300)).toEqual([]);
    const out = m.tick(1401);
    expect(types(out)).toEqual(['mode']);
    expect(out[0]).toMatchObject({ mode: 'orbit' });
    expect(m.currentMode).toBe('orbit');
    expect(m.tick(1500)).toEqual([]);
  });

  it('a swipe during a hold cancels the hold', () => {
    const m = new GestureMapper();
    holdStill(m, 0, 700);
    m.handle(g('left'), 750);
    expect(holdStill(m, 800, 1000)).toEqual([]);
  });
});
