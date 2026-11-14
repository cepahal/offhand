/**
 * Synthetic dental training meshes for the existing three.js Viewer.
 * Geometry is authored in patient RAS millimetres (x = right, y = anterior, z = superior).
 * These are not clinical scans and must not be shown as a patient's CBCT.
 */
import * as THREE from 'three';
import type { CaseLayer, CasePackManifest } from '@hoverscan/contracts';
import type { LoadedCase } from '../viewer/Viewer.js';

type V3 = [number, number, number];
type Kind = 'molar' | 'premolar' | 'canine' | 'incisor';

const ENAMEL = '#f3eee4';
const GINGIVA = '#d9899a';
const MANDIBLE = '#e6d3b8';
const MAXILLA = '#ddc9b0';
const DISC = '#cbbba6';

const UPPER = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'];
const LOWER = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];

export interface HighlightRegion {
  /** Mesh name inside the highlighted layer. */
  mesh: string;
  /** FDI tooth, when the region belongs to a tooth. */
  fdi: string | null;
  /** Centre of the highlighted region, RAS mm. */
  rasMm: V3;
}

export interface DentalTraining {
  n: 1 | 2 | 3 | 4 | 5;
  title: string;
  explanation: string;
  highlight: HighlightRegion;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function group(...parts: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
}

function toothGeometry(): THREE.LatheGeometry {
  const profile = [
    [0.35, -4.4],
    [1.7, -3.5],
    [2.45, -1.8],
    [2.25, -0.15],
    [1.35, 0.55],
    [1.15, 3.2],
    [0.8, 7.4],
    [0.22, 11.2],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 24);
}

const TOOTH_GEO = toothGeometry();

function kindScale(kind: Kind): V3 {
  if (kind === 'molar') return [1.35, 1, 1.2];
  if (kind === 'premolar') return [1.05, 1, 0.9];
  if (kind === 'canine') return [0.95, 1.12, 0.78];
  return [0.72, 1.05, 0.58];
}

function toothMesh(fdi: string, cervix: V3, root: V3, kind: Kind, name = `fdi-${fdi}`): THREE.Mesh {
  const mesh = new THREE.Mesh(TOOTH_GEO.clone());
  mesh.name = name;
  const scale = kindScale(kind);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, new THREE.Vector3(...root).normalize());
  mesh.position.set(...cervix);
  return mesh;
}

function pose(slot: number, upper: boolean): { fdi: string; cervix: V3; root: V3; kind: Kind } {
  const fdi = (upper ? UPPER : LOWER)[slot]!;
  const ang = -2.15 + (slot / 15) * 4.3;
  const rx = upper ? 26 : 24;
  const ry = upper ? 20 : 18;
  const x = -Math.sin(ang) * rx;
  const y = Math.cos(ang) * ry - 4;
  const z = upper ? 4.2 : -4.2;
  const n = Number(fdi[1]);
  const kind: Kind = n >= 6 ? 'molar' : n >= 4 ? 'premolar' : n === 3 ? 'canine' : 'incisor';
  return { fdi, cervix: [x, y, z], root: upper ? [0, 0, 1] : [0, 0, -1], kind };
}

function placed(fdi: string): { fdi: string; cervix: V3; root: V3; kind: Kind } {
  const upper = UPPER.includes(fdi);
  const list = upper ? UPPER : LOWER;
  return pose(list.indexOf(fdi), upper);
}

function archCurve(upper: boolean, z: number): THREE.CatmullRomCurve3 {
  const pts = [0, 3, 7, 11, 15].map((slot) => {
    const p = pose(slot, upper);
    return new THREE.Vector3(p.cervix[0], p.cervix[1], z);
  });
  return new THREE.CatmullRomCurve3(pts);
}

function tube(curve: THREE.CatmullRomCurve3, radius: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 40, radius, 14, false));
}

function capsule(a: V3, b: V3, radius: number): THREE.Mesh {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const dir = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.2, dir.length()), 6, 16));
  mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  return mesh;
}

const RIGHT_CONDYLE: V3 = [36, -1, 8];
const LEFT_CONDYLE: V3 = [-36, -1, 8];

function condyle(center: V3, flat = false): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4.2, 28, 20));
  mesh.scale.set(flat ? 1.45 : 1.05, flat ? 0.55 : 0.85, 1.15);
  mesh.position.set(...center);
  return mesh;
}

function discMesh(center: V3): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 16));
  mesh.scale.set(1.35, 0.38, 1.05);
  mesh.position.set(...center);
  return mesh;
}

interface BuiltLayer {
  id: string;
  label: string;
  color: string;
  opacity: number;
  peel: number;
  object: THREE.Object3D;
}

function baseJaws(skip: { condyle?: 'right' | 'left'; disc?: 'right' | 'left' }): BuiltLayer[] {
  const mandible = group(
    tube(archCurve(false, -12), 4.6),
    capsule([30, -4, -4], RIGHT_CONDYLE, 5.2),
    capsule([-30, -4, -4], LEFT_CONDYLE, 5.2),
  );
  const condyles = group();
  if (skip.condyle !== 'right') {
    const right = condyle(RIGHT_CONDYLE);
    right.name = 'tmj-condyle-right';
    condyles.add(right);
  }
  if (skip.condyle !== 'left') {
    const left = condyle(LEFT_CONDYLE);
    left.name = 'tmj-condyle-left';
    condyles.add(left);
  }
  mandible.add(condyles);
  const maxilla = group(
    tube(archCurve(true, 12), 4.2),
    new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16)),
  );
  const palate = maxilla.children[1] as THREE.Mesh;
  palate.scale.set(1.15, 0.85, 0.35);
  palate.position.set(0, 6, 14);
  const discs = group();
  if (skip.disc !== 'right') {
    const right = discMesh([RIGHT_CONDYLE[0], RIGHT_CONDYLE[1] + 1.2, RIGHT_CONDYLE[2] + 3.2]);
    right.name = 'tmj-disc-right';
    discs.add(right);
  }
  if (skip.disc !== 'left') {
    const left = discMesh([LEFT_CONDYLE[0], LEFT_CONDYLE[1] + 1.2, LEFT_CONDYLE[2] + 3.2]);
    left.name = 'tmj-disc-left';
    discs.add(left);
  }
  return [
    { id: 'gingiva', label: 'Gingiva', color: GINGIVA, opacity: 0.92, peel: 0, object: group(tube(archCurve(true, 6.2), 3.3), tube(archCurve(false, -6.2), 3.2)) },
    { id: 'maxilla', label: 'Maxilla', color: MAXILLA, opacity: 0.78, peel: 1, object: maxilla },
    { id: 'mandible', label: 'Mandible', color: MANDIBLE, opacity: 0.8, peel: 1, object: mandible },
    { id: 'discs', label: 'Articular discs', color: DISC, opacity: 1, peel: 2, object: discs },
  ];
}

function enamelLayer(exclude: string[]): BuiltLayer {
  const g = group();
  for (const fdi of [...UPPER, ...LOWER]) {
    if (exclude.includes(fdi)) continue;
    const p = placed(fdi);
    g.add(toothMesh(p.fdi, p.cervix, p.root, p.kind));
  }
  return { id: 'enamel', label: 'Enamel', color: ENAMEL, opacity: 1, peel: 2, object: g };
}

function build(n: DentalTraining['n']): { layers: BuiltLayer[]; highlight: HighlightRegion } {
  if (n === 1) {
    const ras: V3 = [RIGHT_CONDYLE[0], RIGHT_CONDYLE[1] + 7.5, RIGHT_CONDYLE[2] + 2.4];
    const mesh = discMesh(ras);
    mesh.name = 'tmj-disc-right';
    mesh.scale.set(1.5, 0.42, 1.15);
    return {
      highlight: { mesh: mesh.name, fdi: null, rasMm: ras },
      layers: [
        ...baseJaws({ disc: 'right' }),
        enamelLayer([]),
        { id: 'highlight', label: 'Primary highlight: right temporomandibular disc', color: '#f5d33b', opacity: 1, peel: 3, object: mesh },
      ],
    };
  }
  if (n === 2) {
    const ras: V3 = [LEFT_CONDYLE[0], LEFT_CONDYLE[1], LEFT_CONDYLE[2]];
    const mesh = condyle(ras, true);
    mesh.name = 'tmj-condyle-left';
    return {
      highlight: { mesh: mesh.name, fdi: null, rasMm: ras },
      layers: [
        ...baseJaws({ condyle: 'left' }),
        enamelLayer([]),
        { id: 'highlight', label: 'Primary highlight: left temporomandibular condyle', color: '#f5d33b', opacity: 1, peel: 3, object: mesh },
      ],
    };
  }
  if (n === 3) {
    const p = placed('36');
    const shell = toothMesh('36', p.cervix, p.root, p.kind, 'fdi-36-shell');
    const pulp = toothMesh('36', p.cervix, p.root, p.kind, 'pulp-36');
    pulp.scale.multiplyScalar(0.42);
    const ras: V3 = [p.cervix[0], p.cervix[1], p.cervix[2] - 1.5];
    return {
      highlight: { mesh: 'pulp-36', fdi: '36', rasMm: ras },
      layers: [
        ...baseJaws({}),
        enamelLayer(['36']),
        { id: 'shell-36', label: 'Tooth 36 crown and root shell', color: ENAMEL, opacity: 0.28, peel: 2, object: shell },
        { id: 'highlight', label: 'Primary highlight: pulp chamber and canals of tooth 36', color: '#f5d33b', opacity: 1, peel: 3, object: pulp },
      ],
    };
  }
  if (n === 4) {
    const p = placed('11');
    const ras: V3 = [p.cervix[0], p.cervix[1], p.cervix[2] + 12.4];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.6, 28, 20));
    mesh.name = 'apex-11';
    mesh.position.set(...ras);
    return {
      highlight: { mesh: mesh.name, fdi: '11', rasMm: ras },
      layers: [
        ...baseJaws({}),
        enamelLayer([]),
        { id: 'highlight', label: 'Primary highlight: periapical region of tooth 11', color: '#f5d33b', opacity: 1, peel: 3, object: mesh },
      ],
    };
  }
  const p = placed('48');
  const mesh = toothMesh('48', p.cervix, [0.55, 0.35, -0.76], 'molar', 'tooth-48');
  mesh.position.set(p.cervix[0] + 1.5, p.cervix[1] - 2, p.cervix[2] + 1);
  const ras: V3 = [mesh.position.x, mesh.position.y, mesh.position.z];
  return {
    highlight: { mesh: mesh.name, fdi: '48', rasMm: ras },
    layers: [
      ...baseJaws({}),
      enamelLayer(['48']),
      { id: 'highlight', label: 'Primary highlight: impacted tooth 48', color: '#f5d33b', opacity: 1, peel: 3, object: mesh },
    ],
  };
}

export const DENTAL_TRAININGS: DentalTraining[] = ([1, 2, 3, 4, 5] as const).map((n) => {
  const built = build(n);
  const copy: Record<DentalTraining['n'], { title: string; explanation: string }> = {
    1: {
      title: 'Training 1 · Right TMJ',
      explanation: 'Synthetic model. Right temporomandibular disc, displaced forward. Not a patient scan.',
    },
    2: {
      title: 'Training 2 · Left TMJ',
      explanation: 'Synthetic model. Left condyle, flattened. A different joint presentation. Not a patient scan.',
    },
    3: {
      title: 'Training 3 · Tooth 36',
      explanation: 'Synthetic model. Pulp chamber and root canals of tooth 36. Not a patient scan.',
    },
    4: {
      title: 'Training 4 · Tooth 11',
      explanation: 'Synthetic model. Periapical region at the apex of tooth 11. Not a patient scan.',
    },
    5: {
      title: 'Training 5 · Tooth 48',
      explanation: 'Synthetic model. Impacted tooth 48 and the nearby mandible. Not a patient scan.',
    },
  };
  return { n, ...copy[n], highlight: built.highlight };
});

function manifest(training: DentalTraining, layers: BuiltLayer[]): CasePackManifest {
  const caseLayers: CaseLayer[] = layers.map((l) => ({
    id: l.id,
    label: l.label,
    file: `synthetic/${l.id}.glb`,
    color: l.color,
    defaultOpacity: l.opacity,
    peelOrder: l.peel,
    kind: 'surface',
  }));
  return {
    schema: 1,
    app: 'jawline',
    caseId: `dental-training-${training.n}`,
    title: `${training.title} (synthetic)`,
    source: {
      dataset: 'HoverScan synthetic dental training geometry',
      url: '',
      license: 'Generated in the browser. Not a clinical scan.',
      citation: 'Synthetic training model. Not CBCT and not a patient.',
      subjectId: 'none',
    },
    deidentified: true,
    coordinateSystem: 'RAS',
    units: 'mm',
    layers: caseLayers,
    volumes: [],
    findings: [],
    share: { templateId: 'dental-training', pollOptions: [] },
    policyId: 'none',
  };
}

/** One Viewer load for training case n (1–5). Objects are in memory, so no GLB is fetched. */
export function dentalCase(n: DentalTraining['n']): LoadedCase {
  const training = DENTAL_TRAININGS[n - 1]!;
  const { layers, highlight } = build(n);
  training.highlight.rasMm = highlight.rasMm;
  return {
    manifest: manifest(training, layers),
    baseUrl: '',
    app: {
      title: training.title,
      scrub: { target: 'clip', axis: 'S', label: 'Clip' },
      credit: 'Synthetic training model. Not a patient scan.',
    },
    objects: Object.fromEntries(layers.map((l) => [l.id, l.object])),
    note: training.explanation,
  };
}
