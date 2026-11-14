import { describe, expect, it } from 'vitest';
import {
  BusEnvelope,
  CasePackManifest,
  GestureEvent,
  ViewerCommand,
  ViewerState,
  emptyViewerState,
  makeCommand,
} from '../src/index.js';

describe('GestureEvent', () => {
  it('accepts every line shape the firmware emits', () => {
    const lines = [
      '{"t":"g","g":"cw","seq":4,"ms":12034}',
      '{"t":"h","x":0.25,"y":0.5,"z":0.9,"seq":5,"ms":12100}',
      '{"t":"hb","fw":"offhand-fw/0.1.0","ms":14000}',
      '{"t":"hb","fw":"offhand-fw/0.1.0","ms":16000,"paj":"lost"}',
      '{"t":"err","msg":"PAJ7620 not found"}',
    ];
    for (const line of lines) expect(GestureEvent.safeParse(JSON.parse(line)).success).toBe(true);
  });

  it('rejects unknown gestures and out-of-range hover values', () => {
    expect(GestureEvent.safeParse({ t: 'g', g: 'snap', seq: 1, ms: 1 }).success).toBe(false);
    expect(GestureEvent.safeParse({ t: 'h', x: 1.5, y: 0, z: 0, seq: 1, ms: 1 }).success).toBe(false);
  });
});

describe('ViewerCommand', () => {
  it('makeCommand fills the envelope and validates', () => {
    const c = makeCommand({ type: 'rotate', yawDeg: 30 }, 'gesture');
    expect(ViewerCommand.parse(c)).toMatchObject({ type: 'rotate', yawDeg: 30, source: 'gesture' });
  });

  it('rejects a command with a bad source', () => {
    const c = { ...makeCommand({ type: 'reset_view' }, 'mouse'), source: 'telepathy' };
    expect(ViewerCommand.safeParse(c).success).toBe(false);
  });
});

describe('ViewerState / BusEnvelope', () => {
  it('the empty state is valid and wraps in a state envelope', () => {
    const state = ViewerState.parse(emptyViewerState());
    expect(BusEnvelope.safeParse({ ch: 'state', state }).success).toBe(true);
  });
});

describe('CasePackManifest', () => {
  const ok = {
    schema: 1,
    app: 'test-pattern',
    caseId: 'tp-001',
    title: 'TEST PATTERN',
    source: { dataset: 'synthetic', url: '', license: 'MIT', citation: '', subjectId: 'tp-001' },
    deidentified: true,
    coordinateSystem: 'RAS',
    units: 'mm',
    layers: [
      { id: 'a', label: 'A', file: 'layers/a.glb', color: '#ff0000', defaultOpacity: 1, peelOrder: 0, kind: 'surface' },
    ],
    volumes: [],
    findings: [],
    share: { templateId: 't', pollOptions: [] },
    policyId: 'p',
  };

  it('accepts a minimal manifest', () => {
    expect(CasePackManifest.safeParse(ok).success).toBe(true);
  });

  it('rejects path traversal in layer files', () => {
    const bad = { ...ok, layers: [{ ...ok.layers[0], file: '../../etc/passwd' }] };
    expect(CasePackManifest.safeParse(bad).success).toBe(false);
  });

  it('rejects non-RAS manifests', () => {
    expect(CasePackManifest.safeParse({ ...ok, coordinateSystem: 'LPS' }).success).toBe(false);
  });
});
