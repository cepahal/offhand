import { describe, expect, it } from 'vitest';
import { parseLine } from '../src/gesture/parser.js';

describe('parseLine', () => {
  it('parses contract lines', () => {
    expect(parseLine('{"t":"g","g":"cw","seq":4,"ms":1234}\r')).toEqual({
      kind: 'event',
      ev: { t: 'g', g: 'cw', seq: 4, ms: 1234 },
    });
    expect(parseLine('{"t":"hb","fw":"offhand-gesture 0.1.0","ms":2000,"paj":"missing"}')).toMatchObject({
      kind: 'event',
      ev: { t: 'hb', paj: 'missing' },
    });
  });

  it('passes firmware test output through as comments', () => {
    expect(parseLine('# [TEST] SPIN detected: clockwise')).toEqual({
      kind: 'comment',
      text: '[TEST] SPIN detected: clockwise',
    });
  });

  it('skips blank lines', () => {
    expect(parseLine('  \r')).toEqual({ kind: 'empty' });
  });

  it('flags ROM boot chatter, bad JSON and contract violations', () => {
    expect(parseLine('ets Jul 29 2019 12:21:46')).toMatchObject({ kind: 'invalid', error: 'not JSON' });
    expect(parseLine('{"t":"g",')).toMatchObject({ kind: 'invalid' });
    const bad = parseLine('{"t":"g","g":"snap","seq":1,"ms":1}');
    expect(bad.kind).toBe('invalid');
    expect(bad.kind === 'invalid' && bad.error).toMatch(/^contract:/);
  });
});
