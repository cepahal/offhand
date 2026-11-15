/**
 * CBCT review workspace: ToothFairy2 volume slices in NiiVue, labelled surfaces in the three.js Viewer.
 * Notes are drawn as callouts anchored on the model (the slice point they were taken at, else the
 * review-focus structure). Gesture feedback and peel depth are drawn over the 3D viewport.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Niivue, SLICE_TYPE } from '@niivue/niivue';
import type { CasePackManifest, SlicePlane, ViewerCommand } from '@hoverscan/contracts';
import { makeCommand } from '@hoverscan/contracts';
import { parseAppConfig } from '../viewer/appConfig.js';
import { Viewer } from '../viewer/Viewer.js';
import { PLANE_AXIS, type Vec3 } from '../viewer/logic.js';
import type { CaseNote } from './annotations.js';
import type { DentalTraining } from './dental-anatomy.js';
import { universalFromFdi } from './bite-scenarios.js';
import { IconArrow, IconExpand, IconHome, IconLayers, IconRotate, IconWave, IconZoomIn, IconZoomOut } from './icons.js';

export type StageControl = {
  apply: (cmd: ViewerCommand) => void;
  peel: (dir: 'out' | 'in') => void;
  reset: () => void;
  /** Move all three slices to a RAS-mm point (a note's pin). */
  goTo: (mm: Vec3) => void;
};
export type ScanPoint = { candidateId: string; plane: SlicePlane; voxel: [number, number, number]; mm?: Vec3; structure?: string };

/** "Tooth 46" for a tooth layer, else the layer's clinical name. */
export function structureName(hit: { id: string; label: string } | null, viewer?: Viewer | null, mm?: Vec3): string | undefined {
  if (!hit) return undefined;
  if (hit.id.startsWith('tooth-')) return `Tooth ${hit.id.slice(6)}`;
  const b = viewer?.layerBoundsRas(hit.id);
  if (b && mm) {
    const side = mm[0] >= (b.min[0] + b.max[0]) / 2 ? 'Right' : 'Left'; // +x is the patient's right
    return `${side} ${hit.label.toLowerCase()}`;
  }
  return hit.label;
}

/** True when a pin is somewhere other than the tooth under review. */
export function offFocus(training: DentalTraining, structure: string | undefined): boolean {
  return !!(training.focusLayer && structure && structure !== `Tooth ${training.fdi}`);
}

/** Where a pin is, in words: "Tooth 46 · Axial −38.9 mm". */
export function pinLabel(point: { plane: SlicePlane; mm?: Vec3; structure?: string }): string {
  const plane = planeLabel(point.plane, point.mm);
  if (point.structure && !point.structure.startsWith('Tooth') && point.mm) {
    const [r, a, s] = point.mm;
    const nb = '\u00a0';
    return `${point.structure} · R${nb}${r.toFixed(0)}${nb}A${nb}${a.toFixed(0)}${nb}S${nb}${s.toFixed(0)}${nb}mm`;
  }
  return point.structure ? `${point.structure} · ${plane}` : plane;
}
export type Candidate = { id: string; subjectId: string; title: string };

/** Gesture feedback for the 3D viewport. `id` changes on every event so the cue replays. */
export type GestureCue = {
  id: number;
  glyph: 'left' | 'right' | 'up' | 'down' | 'zoom-in' | 'zoom-out' | 'peel-out' | 'peel-in' | 'wave' | 'return';
  label: string;
  streak: number;
};

export const DENTAL_CANDIDATE_GROUPS: Record<DentalTraining['n'], Candidate[]> = {
  1: [
    { id: 'tf2-f001', subjectId: 'Candidate_F001', title: 'Right TMJ · F001' },
    { id: 'tf2-f002', subjectId: 'Candidate_F002', title: 'Right TMJ · F002' },
  ],
  2: [
    { id: 'tf2-f003', subjectId: 'Candidate_F003', title: 'Left TMJ · F003' },
    { id: 'tf2-f006', subjectId: 'Candidate_F006', title: 'Left TMJ · F006' },
  ],
  3: [
    { id: 'tf2-f007', subjectId: 'Candidate_F007', title: 'Root canal · 36 · F007' },
    { id: 'tf2-f008', subjectId: 'Candidate_F008', title: 'Root canal · 36 · F008' },
  ],
  4: [
    { id: 'tf2-f009', subjectId: 'Candidate_F009', title: 'Periapical · 11 · F009' },
    { id: 'tf2-f010', subjectId: 'Candidate_F010', title: 'Periapical · 11 · F010' },
  ],
  5: [
    { id: 'tf2-f004', subjectId: 'Candidate_F004', title: 'Impacted tooth · 48 · F004' },
    { id: 'tf2-f005', subjectId: 'Candidate_F005', title: 'Impacted tooth · 48 · F005' },
  ],
};

export const DENTAL_CANDIDATES = ([1, 2, 3, 4, 5] as const).flatMap((training) =>
  DENTAL_CANDIDATE_GROUPS[training].map((candidate) => ({ ...candidate, training })),
);

export function candidateFor(training: DentalTraining['n']): string {
  return DENTAL_CANDIDATE_GROUPS[training][0]!.id;
}

type FocusView = 'all' | SlicePlane;
type PlaneView = { canvas: HTMLCanvasElement; nv: Niivue };
const PLANES: SlicePlane[] = ['axial', 'coronal', 'sagittal'];
const NV_TYPE: Record<SlicePlane, SLICE_TYPE> = { axial: SLICE_TYPE.AXIAL, coronal: SLICE_TYPE.CORONAL, sagittal: SLICE_TYPE.SAGITTAL };
const PLANE_NAME: Record<SlicePlane, string> = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' };
const DEFAULT_APP = parseAppConfig(undefined);
/** Focus tooth: steel blue. Amber is reserved for annotations, rose for nerve canals. */
const TARGET_TINT = '#8fb4d8';
const CANAL_COLOR = '#c4716c';
const CLINICAL_LABEL: Record<string, string> = {
  'lower-jawbone': 'Mandible',
  'upper-jawbone': 'Maxilla',
  'left-ia-canal': 'Inferior alveolar canal (L)',
  'right-ia-canal': 'Inferior alveolar canal (R)',
  'left-maxillary-sinus': 'Maxillary sinus (L)',
  'right-maxillary-sinus': 'Maxillary sinus (R)',
  pharynx: 'Airway',
};
/** Plane coordinate in mm: axial = S, coronal = A, sagittal = R. */
const PLANE_MM: Record<SlicePlane, 0 | 1 | 2> = { axial: 2, coronal: 1, sagittal: 0 };
export function planeLabel(plane: SlicePlane, mm: Vec3 | undefined): string {
  const name = plane[0]!.toUpperCase() + plane.slice(1);
  return mm ? `${name} ${mm[PLANE_MM[plane]].toFixed(1)} mm` : name;
}
const READY = 'ready';

function emptyManifest(caseId: string): CasePackManifest {
  return {
    schema: 1,
    app: 'dental',
    caseId,
    title: 'No scan loaded',
    source: { dataset: 'ToothFairy2', url: '', license: 'CC BY-SA 4.0', citation: 'No scan loaded.', subjectId: 'unknown' },
    deidentified: true,
    coordinateSystem: 'RAS',
    units: 'mm',
    layers: [],
    volumes: [],
    findings: [],
    share: { templateId: 'default', pollOptions: [] },
    policyId: 'default',
  };
}

/** Clinical names, canal colour, and the focus-tooth tint. */
function prepareManifest(manifest: CasePackManifest, training: DentalTraining): CasePackManifest {
  return {
    ...manifest,
    layers: manifest.layers.map((layer) => {
      const label = CLINICAL_LABEL[layer.id] ?? layer.label;
      if (layer.id === training.focusLayer) return { ...layer, label, color: TARGET_TINT, defaultOpacity: 1 };
      if (/-ia-canal$/.test(layer.id)) return { ...layer, label, color: CANAL_COLOR };
      if (layer.id === 'pharynx') return { ...layer, label, defaultOpacity: 0 };
      return { ...layer, label };
    }),
  };
}

/** Plain-language name for a peel group from the labels in it. */
function groupName(labels: string[]): string {
  const text = labels.join(' ').toLowerCase();
  if (/canal/.test(text) && !/tooth|mandible|maxilla/.test(text)) return 'Nerve canals';
  if (/tooth|crown|bridge|implant/.test(text)) return 'Teeth';
  if (/mandible|maxilla|sinus|airway/.test(text)) return 'Bone · sinus · airway';
  return labels[0] ?? 'Layer';
}

/** Home direction for a review focus: [yaw, polar] in degrees (yaw > 0 looks at the patient's left). */
function homeAngles(training: DentalTraining): [number, number] {
  if (training.side) return [training.side === 'left' ? 62 : -62, 82];
  const quadrant = Number(training.fdi[0]);
  const tooth = Number(training.fdi[1]);
  const lateral = tooth <= 2 ? 0 : tooth <= 5 ? 24 : 38;
  const yaw = quadrant === 2 || quadrant === 3 ? lateral : -lateral;
  return [yaw, quadrant >= 3 ? 66 : 96];
}

/** Where a note without a slice point hangs: the review-focus structure. */
function regionAnchor(viewer: Viewer, training: DentalTraining): Vec3 | null {
  if (training.focusLayer) {
    const b = viewer.layerBoundsRas(training.focusLayer);
    if (b) return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  }
  const jaw = viewer.layerBoundsRas('lower-jawbone');
  if (!jaw) return null;
  const size = jaw.max.map((v, i) => v - jaw.min[i]!) as Vec3;
  // Condyle: top, back and outer edge of the mandible on the reviewed side (+x is the patient's right).
  const x = training.side === 'left' ? jaw.min[0] + size[0] * 0.08 : jaw.max[0] - size[0] * 0.08;
  return [x, jaw.min[1] + size[1] * 0.16, jaw.max[2] - size[2] * 0.06];
}

export function CBCTWorkspace({
  training,
  candidateId,
  notes,
  cue,
  onScanPoint,
  onSource,
  bind,
}: {
  training: DentalTraining;
  candidateId: string;
  notes: CaseNote[];
  cue: GestureCue | null;
  onScanPoint: (point: ScanPoint) => void;
  onSource: (line: string) => void;
  bind: (viewer: StageControl | null) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const surfaceHost = useRef<HTMLDivElement>(null);
  const canvasRefs: Record<SlicePlane, { current: HTMLCanvasElement | null }> = {
    axial: useRef<HTMLCanvasElement>(null),
    coronal: useRef<HTMLCanvasElement>(null),
    sagittal: useRef<HTMLCanvasElement>(null),
  };
  const viewerRef = useRef<Viewer | null>(null);
  const nvRef = useRef<Partial<Record<SlicePlane, PlaneView>>>({});
  const pointCallback = useRef(onScanPoint);
  pointCallback.current = onScanPoint;
  const sourceCallback = useRef(onSource);
  sourceCallback.current = onSource;
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState<FocusView>('all');
  const [status, setStatus] = useState('Loading scan…');
  const [surfaceMessage, setSurfaceMessage] = useState('');
  const [peel, setPeel] = useState<{ name: string; shown: boolean; color: string }[]>([]);
  const [planeMm, setPlaneMm] = useState<Vec3 | undefined>(undefined);
  const [windowing, setWindowing] = useState('');
  const [sliceIndex, setSliceIndex] = useState<Record<SlicePlane, number>>({ axial: 0, coronal: 0, sagittal: 0 });
  const [sliceMax, setSliceMax] = useState<Record<SlicePlane, number>>({ axial: 0, coronal: 0, sagittal: 0 });
  const [loadedId, setLoadedId] = useState('');
  const moveRef = useRef<(mm: Vec3) => void>(() => {});

  useEffect(() => {
    if (!surfaceHost.current) return;
    const v = new Viewer(surfaceHost.current);
    viewerRef.current = v;
    v.onInfo = (raw) => {
      const peeled = /^Peeled away: (.*)$/.exec(raw);
      const msg = peeled ? `Peeled away: ${groupName(peeled[1]!.split(', '))}` : raw;
      setSurfaceMessage(msg);
      window.setTimeout(() => setSurfaceMessage((current) => (current === msg ? '' : current)), 2600);
    };
    let peelKey = '';
    v.onChange = () => {
      const next = v.peelStatus().map((g) => ({ name: groupName(g.labels), shown: g.shown, color: g.color }));
      const key = JSON.stringify(next);
      if (key !== peelKey) {
        peelKey = key;
        setPeel(next);
      }
    };
    bind({
      apply: (cmd: ViewerCommand) => { v.apply(cmd); },
      peel: (dir) => { v.apply(makeCommand({ type: 'peel', dir }, 'gesture')); },
      reset: () => { v.apply(makeCommand({ type: 'reset_view' }, 'mouse')); },
      goTo: (mm) => { moveRef.current(mm); },
    });
    setReady(false);
    let alive = true;
    const entries: Partial<Record<SlicePlane, PlaneView>> = {};
    const attachments: Promise<unknown>[] = [];
    for (const plane of PLANES) {
      const canvas = canvasRefs[plane].current;
      if (!canvas) continue;
      const nv = new Niivue({
        backColor: [0.043, 0.047, 0.051, 1],
        crosshairColor: [0.6, 0.72, 0.82, 0.75],
        crosshairWidth: 1,
        isRadiologicalConvention: true,
        isOrientationTextVisible: false,
        textHeight: 0.055,
        fontMinPx: 15,
        dragAndDropEnabled: false,
        isOrientCube: false,
        logLevel: 'warn',
      });
      entries[plane] = { canvas, nv };
      const onClick = (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const x = rect.width ? ((event.clientX - rect.left) / rect.width) * canvas.width : 0;
        const y = rect.height ? ((event.clientY - rect.top) / rect.height) * canvas.height : 0;
        try {
          const frac = nv.canvasPos2frac([x, y]);
          const vox = nv.frac2vox(frac) as unknown as ArrayLike<number>;
          const voxel: [number, number, number] = [0, 1, 2].map((axis) => Math.round(Number(vox[axis]) || 0)) as [number, number, number];
          const mmRaw = nv.frac2mm(frac) as unknown as ArrayLike<number>;
          const mm: Vec3 = [Number(mmRaw[0]) || 0, Number(mmRaw[1]) || 0, Number(mmRaw[2]) || 0];
          const structure = structureName(viewerRef.current?.structureAt(mm) ?? null, viewerRef.current, mm);
          pointCallback.current({ candidateId, plane, voxel, mm, ...(structure ? { structure } : {}) });
          setPlaneMm(mm);
          setSliceIndex((current) => ({ ...current, [plane]: voxel[PLANE_AXIS[plane]] }));
          for (const item of Object.values(nvRef.current)) {
            if (!item) continue;
            item.nv.scene.crosshairPos = item.nv.vox2frac(voxel);
            item.nv.drawScene();
          }
        } catch {
          // A click outside the rendered slice changes nothing.
        }
      };
      canvas.addEventListener('click', onClick);
      (nv as Niivue & { __offhandCleanup?: () => void }).__offhandCleanup = () => canvas.removeEventListener('click', onClick);
      attachments.push(nv.attachToCanvas(canvas));
    }
    nvRef.current = entries;
    void Promise.all(attachments).then(() => { if (alive) setReady(true); });

    return () => {
      alive = false;
      bind(null);
      viewerRef.current = null;
      v.dispose();
      for (const item of Object.values(entries)) {
        if (!item) continue;
        (item.nv as Niivue & { __offhandCleanup?: () => void }).__offhandCleanup?.();
        item.nv.gl?.getExtension('WEBGL_lose_context')?.loseContext();
      }
      nvRef.current = {};
    };
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    let cancelled = false;
    setStatus('Loading scan…');
    setLoadedId('');
    setSurfaceMessage('');
    setSliceIndex({ axial: 0, coronal: 0, sagittal: 0 });
    void v.load({ manifest: emptyManifest(candidateId), baseUrl: '', app: DEFAULT_APP });
    for (const item of Object.values(nvRef.current)) {
      if (!item) continue;
      for (const oldVolume of [...item.nv.volumes]) item.nv.removeVolume(oldVolume);
      item.nv.drawScene();
    }
    void (async () => {
      try {
        const [manifestResponse, appsResponse] = await Promise.all([
          fetch(`/api/cases/dental/${encodeURIComponent(candidateId)}`),
          fetch('/api/apps').catch(() => null),
        ]);
        if (cancelled) return;
        if (!manifestResponse.ok) throw new Error(`Scan ${candidateId.toUpperCase()} could not be loaded (HTTP ${manifestResponse.status}).`);
        const raw = (await manifestResponse.json()) as CasePackManifest;
        const manifest = prepareManifest(raw, training);
        const appConfigRaw = appsResponse?.ok ? ((await appsResponse.json()) as Record<string, unknown>).dental : undefined;
        const caseConfig = appConfigRaw ? parseAppConfig(appConfigRaw) : DEFAULT_APP;
        const errors = await v.load({ manifest, baseUrl: `/casepacks/dental/${encodeURIComponent(candidateId)}/`, app: caseConfig });
        if (cancelled) return;
        if (errors.length) setSurfaceMessage(`${errors.length} surface layer${errors.length === 1 ? '' : 's'} unavailable`);
        sourceCallback.current(`${manifest.source.dataset} · ${manifest.source.subjectId.replace(/^Candidate_/, "Case ")} · ${manifest.source.license} · ${manifest.deidentified ? 'De-identified' : 'Identity status unknown'}`);
        const volume = manifest.volumes[0];
        const views = PLANES.map((plane) => [plane, nvRef.current[plane]] as const).filter((entry) => entry[1]);
        if (!volume || !views.length) {
          setStatus('This scan has no CBCT volume.');
          return;
        }
        const url = `/casepacks/dental/${encodeURIComponent(candidateId)}/${volume.file}`;
        const dims = await Promise.all(views.map(async ([plane, view]) => {
          const { nv } = view!;
          await nv.loadVolumes([{ url }]);
          if (cancelled) return { plane, vox: [0, 0, 0] as [number, number, number], sourceDims: undefined };
          nv.setSliceType(NV_TYPE[plane]);
          const sourceDims = nv.volumes[0]?.dimsRAS;
          const vox: [number, number, number] = [
            Math.floor((sourceDims?.[1] ?? 1) / 2),
            Math.floor((sourceDims?.[2] ?? 1) / 2),
            Math.floor((sourceDims?.[3] ?? 1) / 2),
          ];
          nv.scene.crosshairPos = nv.vox2frac(vox);
          nv.drawScene();
          return { plane, vox, sourceDims };
        }));
        if (cancelled) return;
        const dimension = dims[0]?.sourceDims;
        if (dimension) setSliceMax({ axial: (dimension[3] ?? 1) - 1, coronal: (dimension[2] ?? 1) - 1, sagittal: (dimension[1] ?? 1) - 1 });
        setSliceIndex({ axial: dims[0]?.vox[2] ?? 0, coronal: dims[0]?.vox[1] ?? 0, sagittal: dims[0]?.vox[0] ?? 0 });
        const vol = views[0]?.[1]?.nv.volumes[0] as { cal_min?: number; cal_max?: number } | undefined;
        if (vol && vol.cal_min !== undefined && vol.cal_max !== undefined) {
          setWindowing(`W ${Math.round(vol.cal_max - vol.cal_min)} · L ${Math.round((vol.cal_max + vol.cal_min) / 2)}`);
        }
        // Face the structure under review: oblique from its side, a little above for lower teeth.
        const [yaw, polar] = homeAngles(training);
        v.setHomeView(yaw, polar);
        // Open the slices on the structure under review, not the middle of the volume.
        const focusMm = regionAnchor(v, training);
        if (focusMm) moveRef.current(focusMm);
        setStatus(READY);
        setLoadedId(candidateId);
      } catch (error) {
        if (cancelled) return;
        for (const item of Object.values(nvRef.current)) {
          if (!item) continue;
          for (const oldVolume of [...item.nv.volumes]) item.nv.removeVolume(oldVolume);
          item.nv.drawScene();
        }
        await v.load({ manifest: emptyManifest(candidateId), baseUrl: '', app: DEFAULT_APP });
        setStatus((error as Error).message || 'The scan could not be loaded.');
        sourceCallback.current('ToothFairy2 · scan not loaded');
      }
    })();
    return () => { cancelled = true; };
  }, [candidateId, training.n, ready]);

  /** Put every plane's crosshair on a RAS-mm point. */
  function moveTo(mm: Vec3): void {
    let voxel: [number, number, number] | null = null;
    for (const item of Object.values(nvRef.current)) {
      if (!item?.nv.volumes[0]) continue;
      const frac = item.nv.mm2frac(mm);
      item.nv.scene.crosshairPos = frac;
      item.nv.drawScene();
      if (!voxel) {
        const vox = item.nv.frac2vox(frac) as unknown as ArrayLike<number>;
        voxel = [Math.round(Number(vox[0]) || 0), Math.round(Number(vox[1]) || 0), Math.round(Number(vox[2]) || 0)];
      }
    }
    if (!voxel) return;
    const v3 = voxel;
    setSliceIndex({ axial: v3[2], coronal: v3[1], sagittal: v3[0] });
    setPlaneMm(mm);
  }
  moveRef.current = moveTo;

  function changeSlice(plane: SlicePlane, next: number): void {
    setSliceIndex((current) => ({ ...current, [plane]: next }));
    const view = nvRef.current[plane];
    if (!view?.nv.volumes[0]) return;
    const vox = view.nv.frac2vox(view.nv.scene.crosshairPos) as unknown as ArrayLike<number>;
    const position: [number, number, number] = [Number(vox[0]) || 0, Number(vox[1]) || 0, Number(vox[2]) || 0];
    position[PLANE_AXIS[plane]] = next;
    for (const item of Object.values(nvRef.current)) {
      if (!item?.nv.volumes[0]) continue;
      item.nv.scene.crosshairPos = item.nv.vox2frac(position);
      item.nv.drawScene();
    }
    let mm: Vec3 | undefined;
    try {
      const raw = view.nv.frac2mm(view.nv.vox2frac(position)) as unknown as ArrayLike<number>;
      mm = [Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0];
    } catch {
      mm = undefined;
    }
    if (mm) setPlaneMm(mm);
    const structure = mm ? structureName(viewerRef.current?.structureAt(mm) ?? null, viewerRef.current, mm) : undefined;
    pointCallback.current({ candidateId, plane, voxel: position.map(Math.round) as [number, number, number], ...(mm ? { mm } : {}), ...(structure ? { structure } : {}) });
  }

  const tool = (body: { type: 'zoom'; factor: number } | { type: 'rotate'; yawDeg: number }): void => {
    viewerRef.current?.apply({ id: 'dental-ui', ts: Date.now(), source: 'mouse', ...body });
  };
  const loading = status !== READY;

  return (
    <section class="ws" ref={root}>
      <header class="ws-bar">
        <div class="seg" role="tablist" aria-label="Viewport layout">
          {([['all', '4-Up'], ['axial', 'Axial'], ['coronal', 'Coronal'], ['sagittal', 'Sagittal']] as const).map(([name, label]) => (
            <button key={name} type="button" role="tab" aria-selected={focus === name} class={focus === name ? 'on' : ''} onClick={() => setFocus(name)}>{label}</button>
          ))}
        </div>
        <div class="ws-tools" role="toolbar" aria-label="3D view">
          <button type="button" class="tool" title="Zoom in" aria-label="Zoom in" onClick={() => tool({ type: 'zoom', factor: 1.12 })}><IconZoomIn /></button>
          <button type="button" class="tool" title="Zoom out" aria-label="Zoom out" onClick={() => tool({ type: 'zoom', factor: 1 / 1.12 })}><IconZoomOut /></button>
          <button type="button" class="tool" title="Rotate model" aria-label="Rotate model" onClick={() => tool({ type: 'rotate', yawDeg: 24 })}><IconRotate /></button>
          <span class="tool-gap" />
          <button type="button" class="tool" title="Reset view" aria-label="Reset view" onClick={() => viewerRef.current?.apply(makeCommand({ type: 'reset_view' }, 'mouse'))}><IconHome /></button>
          <button
            type="button"
            class="tool"
            title="Full screen"
            aria-label="Toggle full screen"
            onClick={() => {
              const el = root.current;
              if (!el) return;
              if (document.fullscreenElement) void document.exitFullscreen();
              else void el.requestFullscreen();
            }}
          >
            <IconExpand />
          </button>
        </div>
      </header>
      <div class={`ws-grid focus-${focus}`} data-focus={focus}>
        <div class="vp vp-3d">
          <div class="vp-host" ref={surfaceHost} />
          <span class="vp-tag">3D · Segmented surface</span>
          {!loading && loadedId === candidateId && <Triad viewer={viewerRef} training={training} />}
          {peel.length > 1 && <PeelGauge groups={peel} focus={training.focusLayer ? `${training.fdi} · focus` : null} />}
          {!loading && loadedId === candidateId && <NoteCallouts notes={notes} training={training} viewer={viewerRef} />}
          {surfaceMessage ? <p class="vp-toast" key={surfaceMessage}>{surfaceMessage}</p> : cue && <CueView cue={cue} key={cue.id} />}
        </div>
        {PLANES.map((plane) => (
          <figure class={`vp vp-slice vp-${plane} ${focus === plane ? 'on' : ''}`} key={plane}>
            <div class="vp-image">
              <canvas ref={canvasRefs[plane]} aria-label={`${plane} CBCT view`} />
              <figcaption class={`vp-tag tag-${plane}`}>{planeLabel(plane, planeMm)}</figcaption>
              <EdgeLetters plane={plane} />
            </div>
            <div class="vp-slider">
              <input
                type="range"
                min="0"
                max={sliceMax[plane]}
                value={Math.min(sliceIndex[plane], sliceMax[plane])}
                aria-label={`${PLANE_NAME[plane]} slice`}
                onInput={(event) => changeSlice(plane, Number(event.currentTarget.value))}
              />
              {windowing && <span class="vp-wl">{windowing}</span>}
              <output>{sliceIndex[plane]}<small> / {sliceMax[plane]}</small></output>
            </div>
          </figure>
        ))}
        {loading && (
          <div class="ws-state" role="status">
            {status.startsWith('Loading') ? <span class="ws-spinner" aria-hidden="true"><i /><i /><i /></span> : null}
            <p>{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Radiological convention: patient right on the viewer's left. Sagittal: anterior on the right. */
const EDGES: Record<SlicePlane, [string, string, string, string]> = {
  axial: ['A', 'L', 'P', 'R'],
  coronal: ['S', 'L', 'I', 'R'],
  sagittal: ['S', 'A', 'I', 'P'],
};

function EdgeLetters({ plane }: { plane: SlicePlane }) {
  const [top, right, bottom, left] = EDGES[plane];
  return (
    <>
      <b class="edge e-top" aria-hidden="true">{top}</b>
      <b class="edge e-right" aria-hidden="true">{right}</b>
      <b class="edge e-bottom" aria-hidden="true">{bottom}</b>
      <b class="edge e-left" aria-hidden="true">{left}</b>
    </>
  );
}

function PeelGauge({ groups, focus }: { groups: { name: string; shown: boolean; color: string }[]; focus: string | null }) {
  return (
    <div class="peel" aria-label="Visible layers">
      <span class="peel-title"><IconLayers size={15} />Layers</span>
      <ol>
        {groups.map((g) => (
          <li key={g.name} class={g.shown ? 'on' : ''}>
            <i style={g.shown ? { background: g.color } : undefined} />
            {g.name}
          </li>
        ))}
        {focus && (
          <li class="on focus-row">
            <i style={{ background: TARGET_TINT }} />
            {focus}
          </li>
        )}
      </ol>
    </div>
  );
}

const CUE_ICON: Record<GestureCue['glyph'], () => JSX.Element> = {
  left: () => <IconArrow dir="left" size={44} />,
  right: () => <IconArrow dir="right" size={44} />,
  up: () => <IconArrow dir="up" size={44} />,
  down: () => <IconArrow dir="down" size={44} />,
  'zoom-in': () => <IconZoomIn size={44} />,
  'zoom-out': () => <IconZoomOut size={44} />,
  'peel-out': () => <IconLayers size={44} />,
  'peel-in': () => <IconLayers size={44} />,
  wave: () => <IconWave size={44} />,
  return: () => <IconArrow dir="left" size={20} />,
};

function CueView({ cue }: { cue: GestureCue }) {
  if (cue.glyph === 'return') {
    return <p class="cue-return" role="status">{cue.label}</p>;
  }
  return (
    <div class={`cue cue-${cue.glyph}`} role="status">
      <span class="cue-glyph">{CUE_ICON[cue.glyph]()}</span>
      <span class="cue-label">{cue.label}</span>
    </div>
  );
}

const MAX_CALLOUTS = 4;
const PLATE_W = 286;

export function focusName(training: DentalTraining): string {
  return training.focusLayer ? `Tooth ${training.fdi} (#${universalFromFdi(training.fdi)})` : `${training.side === 'left' ? 'Left' : 'Right'} TMJ region`;
}

/**
 * Orientation triad that turns with the model (R, A, S axes), plus the focus tooth's number
 * pinned on the model.
 */
function Triad({ viewer, training }: { viewer: { current: Viewer | null }; training: DentalTraining }) {
  const axes = useRef<(SVGLineElement | null)[]>([]);
  const labels = useRef<(SVGTextElement | null)[]>([]);
  const tag = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = viewer.current;
      if (!v) return;
      const o = v.projectRas([0, 0, 0]);
      const dirs: Vec3[] = [[40, 0, 0], [0, 40, 0], [0, 0, 40]];
      dirs.forEach((d, i) => {
        const p = v.projectRas(d);
        let dx = p.x - o.x;
        let dy = p.y - o.y;
        const len = Math.hypot(dx, dy) || 1;
        const scale = Math.min(1, len / 40) * 24 / len;
        dx *= scale;
        dy *= scale;
        const line = axes.current[i];
        const text = labels.current[i];
        if (line) { line.setAttribute('x2', (32 + dx).toFixed(1)); line.setAttribute('y2', (32 + dy).toFixed(1)); }
        if (text) { text.setAttribute('x', (32 + dx * 1.32).toFixed(1)); text.setAttribute('y', (32 + dy * 1.32 + 4).toFixed(1)); }
      });
      const el = tag.current;
      if (el && training.focusLayer) {
        const b = v.layerBoundsRas(training.focusLayer);
        if (b) {
          const lower = Number(training.fdi[0]) >= 3;
          const p = v.projectRas([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, lower ? b.max[2] : b.min[2]]);
          el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
          el.style.opacity = p.visible ? '1' : '0';
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [training.n]);
  const names = ['R', 'A', 'S'];
  return (
    <>
      <svg class="triad" width="64" height="64" viewBox="0 0 64 64" aria-label="Orientation">
        <circle cx="32" cy="32" r="30" />
        {names.map((n, i) => (
          <g key={n} class={`axis-${n}`}>
            <line ref={(el) => { axes.current[i] = el; }} x1="32" y1="32" x2="32" y2="32" />
            <text ref={(el) => { labels.current[i] = el; }} text-anchor="middle">{n}</text>
          </g>
        ))}
      </svg>
      {training.focusLayer && <span class="tooth-tag" ref={tag}><span>{training.fdi}<small>#{universalFromFdi(training.fdi)}</small></span></span>}
    </>
  );
}

/** Shorten at a word boundary, never mid-word. */
export function shortLabel(text: string, max = 30): string {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/[.;:,]$/, '');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 12 ? cut.slice(0, at) : clean.slice(0, max)).replace(/[,;:]$/, '')}…`;
}

type Pin = { key: string; numbers: number[]; text: string; ras: Vec3 | null; where: string; off: boolean };
const shownCache = new Map<string, string | null>();

/**
 * Numbered pins on the model with short leader-line plates. Notes that share a point share one pin.
 * Positions are written straight to the DOM each frame (no re-render), so plates stay pinned
 * while the model turns.
 */
function NoteCallouts({ notes, training, viewer }: { notes: CaseNote[]; training: DentalTraining; viewer: { current: Viewer | null } }) {
  const plates = useRef<(HTMLElement | null)[]>([]);
  const lines = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const fallback = useRef<Vec3 | null>(null);

  const pins: Pin[] = [];
  notes.forEach((note, index) => {
    const mm = note.anchor?.mm;
    const key = mm ? mm.map((n) => Math.round(n)).join(',') : 'focus';
    const where = note.anchor ? pinLabel(note.anchor) : focusName(training);
    const off = !!note.anchor && offFocus(training, note.anchor.structure);
    const found = pins.find((p) => p.key === key);
    if (found) {
      found.numbers.push(index + 1);
      found.text = note.text;
    } else pins.push({ key, numbers: [index + 1], text: note.text, ras: mm ?? null, where, off });
  });
  const shown = pins.slice(-MAX_CALLOUTS);

  useEffect(() => {
    fallback.current = null;
  }, [training.n]);

  useEffect(() => {
    if (!shown.length) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = viewer.current;
      if (!v) return;
      if (!fallback.current) fallback.current = regionAnchor(v, training);
      const host = plates.current[0]?.parentElement;
      if (!host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const points = shown.map((pin) => {
        const ras = pin.ras ?? fallback.current;
        return ras ? v.projectRas(ras) : null;
      });
      // Each plate goes on its pin's side, stacked in pin order, so leaders stay short and never cross.
      const side = points.map((p) => (p && p.x < w / 2 ? 'left' : 'right'));
      const tops: number[] = [];
      for (const which of ['left', 'right']) {
        const order = points.map((p, i) => ({ i, y: p?.y ?? 0 })).filter(({ i }) => side[i] === which).sort((a, b) => a.y - b.y);
        let y = which === 'left' ? 56 : 56;
        for (const { i } of order) {
          const el = plates.current[i];
          const height = el?.offsetHeight ?? 52;
          tops[i] = Math.min(y, h - height - (which === 'left' ? 190 : 96));
          y = tops[i]! + height + 8;
        }
      }
      shown.forEach((pin, i) => {
        const left = side[i] === 'left';
        const x = left ? 16 : Math.max(16, w - PLATE_W - 18);
        const el = plates.current[i];
        const line = lines.current[i];
        const dot = dots.current[i];
        const p = points[i];
        if (!el || !line || !dot) return;
        el.style.transform = `translate(${x}px, ${tops[i]}px)`;
        const visible = !!p && p.visible;
        el.classList.toggle('is-floating', !visible);
        // A pin whose structure has been peeled away is shown hollow, its plate dimmed.
        if (pin.ras && !shownCache.has(pin.key)) shownCache.set(pin.key, v.structureAt(pin.ras)?.id ?? null);
        const layerId = pin.ras ? shownCache.get(pin.key) : null;
        const peeled = !!layerId && !v.layerShown(layerId);
        // Hidden behind other geometry, or on a peeled structure: hollow pin, dashed dim leader.
        const hidden = peeled || (pin.ras ? v.occluded(pin.ras) : false);
        el.classList.toggle('is-peeled', hidden);
        dot.classList.toggle('hollow', hidden);
        line.classList.toggle('hidden-pin', hidden);
        if (!visible || !p) {
          line.setAttribute('d', '');
          dot.setAttribute('r', '0');
          return;
        }
        // Leader leaves from the point on the plate nearest the pin and runs straight to it.
        const top = tops[i] ?? 0;
        const height = el.offsetHeight || 52;
        const ex = Math.min(Math.max(p.x, x + 14), x + PLATE_W - 14);
        const ey = Math.min(Math.max(p.y, top), top + height);
        line.setAttribute('d', `M${p.x.toFixed(1)} ${p.y.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`);
        dot.setAttribute('cx', p.x.toFixed(1));
        dot.setAttribute('cy', p.y.toFixed(1));
        dot.setAttribute('r', '4.5');
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown.map((p) => `${p.key}:${p.numbers.join('.')}`).join('|'), training.n]);

  if (!shown.length) return null;
  return (
    <div class="callouts">
      <svg class="callout-lines" aria-hidden="true">
        {shown.map((pin, i) => (
          <g key={pin.key}>
            <path ref={(el) => { lines.current[i] = el; }} pathLength={1} />
            <circle ref={(el) => { dots.current[i] = el; }} r="0" />
          </g>
        ))}
      </svg>
      {shown.map((pin, i) => (
        <article class="callout" key={pin.key} ref={(el) => { plates.current[i] = el; }}>
          <span class="callout-ns">{pin.numbers.map((n) => <span class="callout-n" key={n}>{n}</span>)}</span>
          <div>
            <p>{shortLabel(pin.text, 58)}</p>
            {pin.off ? <em class="off-focus block">not on {training.fdi}</em> : null}
            <small>{pin.where}</small>
          </div>
        </article>
      ))}
    </div>
  );
}
