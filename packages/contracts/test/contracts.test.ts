import { describe, expect, it } from 'vitest';
import {
  BusEnvelope,
  CasePackManifest,
  GestureEvent,
  VerifiedText,
  ViewerCommand,
  ViewerState,
  cameraOrbit,
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

describe('1.1.0 additions', () => {
  const verified = {
    text: 'Test marker placed at the origin offset.',
    status: 'verified',
    findings: [{ type: 'VALID', detail: 'ok' }],
    policyId: 'chairside',
    checkedAt: '2026-11-11T22:00:00Z',
  };

  it('1.0.0 data still validates: camera without orbit fields, bookmark without snapshotUrl, no checker', () => {
    const state = {
      ...emptyViewerState(),
      app: 'test-pattern',
      caseId: 'tp-001',
      bookmarks: [{ id: 'b1', label: 'View 1', state: { ...emptyViewerState(), bookmarks: undefined } }],
    };
    expect(ViewerState.safeParse(state).success).toBe(true);
    expect(VerifiedText.safeParse(verified).success).toBe(true);
  });

  it('accepts the optional camera orbit fields and checker', () => {
    const state = { ...emptyViewerState(), camera: { ...emptyViewerState().camera, azimuth: 0, elevation: 0, distance: 300 } };
    expect(ViewerState.safeParse(state).success).toBe(true);
    expect(VerifiedText.safeParse({ ...verified, checker: 'mock' }).success).toBe(true);
  });

  it('BusEnvelope carries verified text, and still rejects an unknown channel', () => {
    expect(BusEnvelope.safeParse({ ch: 'verified', ev: verified }).success).toBe(true);
    expect(BusEnvelope.safeParse({ ch: 'verified', ev: { ...verified, status: 'approved' } }).success).toBe(false);
    expect(BusEnvelope.safeParse({ ch: 'telepathy', ev: verified }).success).toBe(false);
  });
});

describe('cameraOrbit', () => {
  // Viewer world: three.x = -R, three.y = S, three.z = A.
  it.each([
    [[0, 0, 300], 0, 0],
    [[-300, 0, 0], 90, 0],
    [[0, 0, -300], 180, 0],
    [[300, 0, 0], 270, 0],
    [[0, 300, 0], 0, 90],
    [[0, -300, 0], 0, -90],
  ] as const)('camera at %j: azimuth %d, elevation %d', (position, azimuth, elevation) => {
    expect(cameraOrbit([...position], [0, 0, 0])).toEqual({ azimuth, elevation, distance: 300 });
  });

  it('is relative to the target and handles a camera on its target', () => {
    expect(cameraOrbit([10, 20, 130], [10, 20, 30])).toEqual({ azimuth: 0, elevation: 0, distance: 100 });
    expect(cameraOrbit([1, 2, 3], [1, 2, 3])).toEqual({ azimuth: 0, elevation: 0, distance: 0 });
    expect(cameraOrbit([0, 100, 100], [0, 0, 0]).elevation).toBe(45);
  });

  it('agrees with the default viewer camera (in front of the patient)', () => {
    const { position, target } = emptyViewerState().camera;
    expect(cameraOrbit(position, target)).toEqual({ azimuth: 0, elevation: 0, distance: 300 });
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

  it('1.2.0: a layer may name its timepoint; layers without one still validate', () => {
    const longitudinal = {
      ...ok,
      timepoints: [{ id: 'visit-01', label: 'Visit 1', order: 1 }],
      layers: [...ok.layers, { ...ok.layers[0], id: 'b', file: 'layers/b.glb', timepointId: 'visit-01' }],
    };
    expect(CasePackManifest.safeParse(longitudinal).success).toBe(true);
    expect(CasePackManifest.safeParse({ ...ok, layers: [{ ...ok.layers[0], timepointId: 3 }] }).success).toBe(false);
  });

  it('rejects path traversal in layer files', () => {
    const bad = { ...ok, layers: [{ ...ok.layers[0], file: '../../etc/passwd' }] };
    expect(CasePackManifest.safeParse(bad).success).toBe(false);
  });

  it('rejects non-RAS manifests', () => {
    expect(CasePackManifest.safeParse({ ...ok, coordinateSystem: 'LPS' }).success).toBe(false);
  });
});
