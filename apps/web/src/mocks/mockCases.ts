/**
 * Frontend-only MOCK samples for the five areas in the product brief
 * (Knee, ACL, Shoulder, Concussion, TMJ).
 *
 * Everything here is built from primitive shapes (capsules, spheres, boxes, rings) so the
 * peel-back / highlight / gesture flow can be shown before real case packs exist.
 * They are NOT anatomy and contain NO patient data:
 *   - every title says MOCK and the viewer shows a "MOCK — NOT ANATOMY" banner,
 *   - layers are named by role ("outer layer", "bone stand-in"), not as real structures,
 *   - highlight targets are listed as "Mock targets", never as findings.
 * Real public sources for each area are listed in research/B-imaging-viewer-hardware.md §6.
 * Replace a mock by building a real case pack with the pipeline; delete it from MOCKS below.
 *
 * Geometry is authored directly in patient RAS millimetres (x = Right, y = Anterior,
 * z = Superior), the same space as real case-pack GLBs, so the viewer treats both the same way.
 */
import * as THREE from 'three';
import type { CaseFinding, CaseLayer, CasePackManifest } from '@hoverscan/contracts';
import type { AppConfig } from '../viewer/appConfig.js';
import type { LoadedCase } from '../viewer/Viewer.js';
import type { LocalCaseSource } from '../app/controller.js';

export const MOCK_APP = 'mock';

type V3 = [number, number, number];
const v = (p: V3): THREE.Vector3 => new THREE.Vector3(...p);
const Y = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------
// Primitive builders (all in RAS mm)
// ---------------------------------------------------------------------------------------------

/** Capsule (rounded rod) between two points. */
function rod(radius: number, a: V3, b: V3): THREE.Mesh {
  const dir = v(b).sub(v(a));
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.1, len), 8, 32, 1));
  m.quaternion.setFromUnitVectors(Y, dir.normalize());
  m.position.copy(v(a).add(v(b)).multiplyScalar(0.5));
  return m;
}

/** Flat disc (short cylinder) centred at c, facing along axis. */
function disc(radius: number, thickness: number, c: V3, axis: V3 = [0, 0, 1]): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, 48, 1));
  m.quaternion.setFromUnitVectors(Y, v(axis).normalize());
  m.position.set(...c);
  return m;
}

/** Sphere / ellipsoid. */
function ball(radius: number, c: V3, scale: V3 = [1, 1, 1]): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32));
  m.position.set(...c);
  m.scale.set(...scale);
  return m;
}

/** Rounded box stand-in (a plain box). */
function block(size: V3, c: V3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size));
  m.position.set(...c);
  return m;
}

/** Ring around an axis. */
function ring(radius: number, tube: number, c: V3, axis: V3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 24, 72));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v(axis).normalize());
  m.position.set(...c);
  return m;
}

/** Half-sphere shell (a cup) whose opening faces `facing`. */
function cup(radius: number, c: V3, facing: V3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2));
  // The cap's pole is +Y; point the pole away from the opening.
  m.quaternion.setFromUnitVectors(Y, v(facing).normalize().negate());
  m.position.set(...c);
  return m;
}

const group = (...parts: THREE.Object3D[]): THREE.Group => {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
};

// ---------------------------------------------------------------------------------------------
// Mock definitions
// ---------------------------------------------------------------------------------------------

/** Shared colours (match the test pattern's spirit: distinct, readable on teal/black). */
const C = {
  outer: '#e3b5a4',
  middle: '#c0504d',
  hard: '#e8e2cf',
  blue: '#5aa9e6',
  amber: '#f2c14e',
  red: '#ff4f4f',
  violet: '#b07cc6',
  fluid: '#7fc8f8',
};

interface MockLayer {
  id: string;
  label: string;
  color: string;
  opacity: number;
  peel: number;
  object: THREE.Object3D;
}

interface MockTarget {
  id: string;
  label: string;
  layerId: string;
  center: V3;
  radiusMm: number;
}

interface MockDef {
  caseId: string;
  title: string;
  note: string;
  scrub: AppConfig['scrub'];
  build(): { layers: MockLayer[]; targets: MockTarget[]; onScrub?: (v: number) => void };
}

const clipS: AppConfig['scrub'] = { target: 'clip', axis: 'S', label: 'Clip (inferior → superior)' };

export const MOCKS: MockDef[] = [
  {
    caseId: 'knee',
    title: 'Knee — MOCK (primitive shapes, not anatomy)',
    note: 'Stand-in for the Knee area. Real source to use: OAIZIB-CM knee MRI masks (femur, tibia, cartilage).',
    scrub: clipS,
    build: () => ({
      layers: [
        { id: 'outer', label: 'Outer layer (skin stand-in)', color: C.outer, opacity: 0.22, peel: 0, object: rod(56, [0, 0, -120], [0, 0, 120]) },
        { id: 'middle', label: 'Middle layer (muscle stand-in)', color: C.middle, opacity: 0.35, peel: 1, object: rod(45, [0, 0, -110], [0, 0, 110]) },
        {
          id: 'cushion',
          label: 'Cushion discs (cartilage stand-in)',
          color: C.blue,
          opacity: 0.95,
          peel: 2,
          object: group(disc(24, 3, [0, 0, 6]), disc(24, 3, [0, 0, -6])),
        },
        {
          id: 'hard',
          label: 'Rods (bone stand-in)',
          color: C.hard,
          opacity: 1,
          peel: 3,
          object: group(
            rod(17, [0, 0, 20], [0, 0, 120]),
            disc(26, 10, [0, 0, 13]),
            rod(15, [0, 0, -120], [0, 0, -20]),
            disc(25, 10, [0, 0, -13]),
          ),
        },
      ],
      targets: [{ id: 'gap', label: 'Mock target: gap between the discs', layerId: 'cushion', center: [14, 0, 0], radiusMm: 9 }],
    }),
  },
  {
    caseId: 'acl',
    title: 'ACL — MOCK (primitive shapes, not anatomy)',
    note: 'Stand-in for the ACL area. Public ACL data (MRNet) has exam-level tear labels only, no ligament masks.',
    scrub: { target: 'clip', axis: 'A', label: 'Clip (posterior → anterior)' },
    build: () => ({
      layers: [
        { id: 'outer', label: 'Outer layer (skin stand-in)', color: C.outer, opacity: 0.2, peel: 0, object: rod(62, [0, 0, -115], [0, 0, 115]) },
        { id: 'middle', label: 'Middle layer (muscle stand-in)', color: C.middle, opacity: 0.32, peel: 1, object: rod(50, [0, 0, -105], [0, 0, 105]) },
        {
          id: 'hard',
          label: 'Blocks (bone stand-in)',
          color: C.hard,
          opacity: 0.85,
          peel: 2,
          object: group(block([64, 54, 88], [0, 0, 56]), block([60, 52, 88], [0, 0, -56])),
        },
        {
          id: 'bands',
          label: 'Crossing bands (ligament stand-in)',
          color: C.red,
          opacity: 1,
          peel: 3,
          object: group(rod(4.5, [-10, -14, -14], [10, 12, 14]), rod(4, [10, -12, -14], [-8, 14, 14])),
        },
      ],
      targets: [{ id: 'band', label: 'Mock target: front band crossing point', layerId: 'bands', center: [0, -1, 0], radiusMm: 8 }],
    }),
  },
  {
    caseId: 'shoulder',
    title: 'Shoulder — MOCK (primitive shapes, not anatomy)',
    note: 'Stand-in for the Shoulder area. Public data: bone masks (TotalSegmentator MRI) and tear labels per exam; no rotator-cuff masks.',
    scrub: clipS,
    build: () => ({
      layers: [
        { id: 'outer', label: 'Outer layer (skin stand-in)', color: C.outer, opacity: 0.2, peel: 0, object: ball(90, [25, 0, 0], [1.35, 0.85, 0.95]) },
        { id: 'middle', label: 'Middle layer (muscle stand-in)', color: C.middle, opacity: 0.32, peel: 1, object: ball(74, [25, 0, 0], [1.35, 0.8, 0.9]) },
        { id: 'collar', label: 'Collar ring (cuff stand-in)', color: C.amber, opacity: 0.95, peel: 2, object: ring(34, 7, [10, 0, 0], [1, 0, 0]) },
        {
          id: 'hard',
          label: 'Ball, rod and cup (bone stand-in)',
          color: C.hard,
          opacity: 1,
          peel: 3,
          object: group(ball(27, [10, 0, 0]), rod(13, [30, 0, 0], [135, 0, -8]), cup(33, [6, 0, 0], [1, 0, 0])),
        },
      ],
      targets: [{ id: 'collar-top', label: 'Mock target: top of the collar ring', layerId: 'collar', center: [10, 0, 34], radiusMm: 9 }],
    }),
  },
  {
    caseId: 'concussion',
    title: 'Concussion — MOCK (primitive shapes, not anatomy)',
    note: 'Stand-in for the Concussion area. Concussion often shows nothing on standard MRI; public lesion data (AIMS-TBI) is moderate–severe TBI.',
    scrub: clipS,
    build: () => ({
      layers: [
        { id: 'outer', label: 'Outer shell (scalp stand-in)', color: C.outer, opacity: 0.18, peel: 0, object: ball(96, [0, 0, 0], [0.82, 1, 0.92]) },
        { id: 'hard', label: 'Hard shell (skull stand-in)', color: C.hard, opacity: 0.3, peel: 1, object: ball(89, [0, 0, 0], [0.82, 1, 0.92]) },
        { id: 'fluid', label: 'Fluid gap (CSF stand-in)', color: C.fluid, opacity: 0.22, peel: 2, object: ball(84, [0, 0, 0], [0.82, 1, 0.92]) },
        {
          id: 'core',
          label: 'Core (brain stand-in)',
          color: C.violet,
          opacity: 1,
          peel: 3,
          object: ball(78, [0, 0, 0], [0.8, 1, 0.9]),
        },
      ],
      // A region on the surface, deliberately not a lesion-like blob.
      targets: [{ id: 'top', label: 'Mock target: top region of the core', layerId: 'core', center: [0, 0, 70], radiusMm: 14 }],
    }),
  },
  {
    caseId: 'tmj',
    title: 'TMJ — MOCK (primitive shapes, not anatomy)',
    note: 'Stand-in for the TMJ area. Hover-scrub opens and closes the hinge (mock motion). No public open/closed-mouth TMJ MRI exists.',
    scrub: { target: 'motion', axis: 'S', label: 'Opening (mock motion)' },
    build: () => {
      // Lower part hangs from a pivot at the knob centre and swings down/forward with scrub.
      const pivotAt: V3 = [0, 0, -4];
      const swing = new THREE.Group();
      swing.position.set(...pivotAt);
      const lower = group(ball(10, [0, 0, 0]), rod(7, [0, 0, 0], [0, -6, -62]), rod(7, [0, -6, -62], [0, 58, -78]));
      swing.add(lower);
      const MAX_DEG = 28;
      const SLIDE_MM = 8;
      return {
        layers: [
          { id: 'outer', label: 'Outer layer (skin stand-in)', color: C.outer, opacity: 0.2, peel: 0, object: ball(72, [0, 10, -22], [0.7, 1.15, 0.95]) },
          { id: 'middle', label: 'Middle layer (muscle stand-in)', color: C.middle, opacity: 0.32, peel: 1, object: ball(56, [0, 6, -28], [0.55, 1.05, 0.85]) },
          { id: 'pad', label: 'Pad (disc stand-in)', color: C.blue, opacity: 1, peel: 2, object: ball(9, [0, 0, 8], [1.2, 1.5, 0.45]) },
          {
            id: 'hard',
            label: 'Block and hinged arm (bone stand-in)',
            color: C.hard,
            opacity: 1,
            peel: 3,
            object: group(block([44, 56, 18], [0, 0, 22]), swing),
          },
        ],
        targets: [{ id: 'pad', label: 'Mock target: pad between block and knob', layerId: 'pad', center: [0, 0, 8], radiusMm: 10 }],
        onScrub: (s: number) => {
          // Rotation about +R by a negative angle moves anterior points down.
          swing.rotation.x = THREE.MathUtils.degToRad(-MAX_DEG * s);
          swing.position.set(pivotAt[0], pivotAt[1] + SLIDE_MM * s, pivotAt[2]);
        },
      };
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Manifest + LoadedCase
// ---------------------------------------------------------------------------------------------

export function mockManifest(def: MockDef, layers: MockLayer[], targets: MockTarget[]): CasePackManifest {
  const caseLayers: CaseLayer[] = layers.map((l) => ({
    id: l.id,
    label: l.label,
    file: `mock/${l.id}`, // never fetched: the objects are passed in memory
    color: l.color,
    defaultOpacity: l.opacity,
    peelOrder: l.peel,
    kind: 'surface',
  }));
  const findings: CaseFinding[] = targets.map((t) => ({
    id: t.id,
    label: t.label,
    layerId: t.layerId,
    center: t.center,
    radiusMm: t.radiusMm,
    // Measured on the mock geometry itself; the UI lists these as "Mock targets", not findings.
    provenance: 'measured',
  }));
  return {
    schema: 1,
    app: MOCK_APP,
    caseId: def.caseId,
    title: def.title,
    source: {
      dataset: 'offhand frontend mock (primitive shapes, no patient data)',
      url: '',
      license: 'Generated in the browser by offhand; no third-party data',
      citation: '',
      subjectId: 'none',
    },
    deidentified: true,
    coordinateSystem: 'RAS',
    units: 'mm',
    layers: caseLayers,
    volumes: [],
    findings,
    share: { templateId: 'mock', pollOptions: [] },
    policyId: 'none',
  };
}

export function buildMock(caseId: string): LoadedCase {
  const def = MOCKS.find((m) => m.caseId === caseId);
  if (!def) throw new Error(`no mock named "${caseId}" (have: ${MOCKS.map((m) => m.caseId).join(', ')})`);
  const { layers, targets, onScrub } = def.build();
  return {
    manifest: mockManifest(def, layers, targets),
    baseUrl: '',
    app: { title: def.title, scrub: def.scrub },
    objects: Object.fromEntries(layers.map((l) => [l.id, l.object])),
    onScrub,
    note: def.note,
  };
}

export const mockSource: LocalCaseSource = {
  app: MOCK_APP,
  list: () => MOCKS.map((m) => ({ caseId: m.caseId, title: m.title })),
  load: async (caseId) => buildMock(caseId),
};
