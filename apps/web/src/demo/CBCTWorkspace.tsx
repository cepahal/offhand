/** Candidate CBCT viewer: ToothFairy2 volumes in NiiVue, labeled surfaces in the existing Three.js Viewer. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Niivue, SLICE_TYPE } from '@niivue/niivue';
import type { CasePackManifest, SlicePlane, ViewerCommand } from '@hoverscan/contracts';
import { makeCommand } from '@hoverscan/contracts';
import { parseAppConfig } from '../viewer/appConfig.js';
import { Viewer } from '../viewer/Viewer.js';
import { PLANE_AXIS } from '../viewer/logic.js';
import type { StageControl } from './DentalStage.js';
import type { CaseNote } from './annotations.js';
import type { DentalTraining } from './dental-anatomy.js';

export type ScanPoint = { candidateId: string; plane: SlicePlane; voxel: [number, number, number] };
export type Candidate = { id: string; subjectId: string; title: string };

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
const NV_TYPE: Record<SlicePlane, SLICE_TYPE> = {
  axial: SLICE_TYPE.AXIAL,
  coronal: SLICE_TYPE.CORONAL,
  sagittal: SLICE_TYPE.SAGITTAL,
};
const DEFAULT_APP = parseAppConfig(undefined);

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

function targetTooth(training: DentalTraining['n']): string | null {
  return training === 3 ? '36' : training === 4 ? '11' : training === 5 ? '48' : null;
}

function applyTargetTint(manifest: CasePackManifest, training: DentalTraining['n']): CasePackManifest {
  const tooth = targetTooth(training);
  if (!tooth) return manifest;
  return {
    ...manifest,
    layers: manifest.layers.map((layer) =>
      new RegExp(`^Tooth ${tooth}\\b`, 'i').test(layer.label)
        ? { ...layer, color: '#d4ae6d', defaultOpacity: 1 }
        : layer,
    ),
  };
}

export function CBCTWorkspace({
  training,
  candidateId,
  notes,
  onCandidateChange,
  onScanPoint,
  bind,
}: {
  training: DentalTraining['n'];
  candidateId: string;
  notes: CaseNote[];
  onCandidateChange: (id: string) => void;
  onScanPoint: (point: ScanPoint) => void;
  bind: (viewer: StageControl | null) => void;
}) {
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
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState<FocusView>('all');
  const [status, setStatus] = useState('Loading candidate scan…');
  const [sourceLine, setSourceLine] = useState('ToothFairy2 · research training data');
  const [surfaceMessage, setSurfaceMessage] = useState('');
  const [sliceIndex, setSliceIndex] = useState<Record<SlicePlane, number>>({ axial: 0, coronal: 0, sagittal: 0 });
  const [sliceMax, setSliceMax] = useState<Record<SlicePlane, number>>({ axial: 0, coronal: 0, sagittal: 0 });

  useEffect(() => {
    if (!surfaceHost.current) return;
    const v = new Viewer(surfaceHost.current);
    viewerRef.current = v;
    v.onInfo = setSurfaceMessage;
    bind({
      apply: (cmd: ViewerCommand) => { v.apply(cmd); },
      peel: (dir) => { v.apply(makeCommand({ type: 'peel', dir }, 'gesture')); },
      reset: () => { v.apply(makeCommand({ type: 'reset_view' }, 'mouse')); },
    });
    setReady(false);
    let alive = true;
    const entries: Partial<Record<SlicePlane, PlaneView>> = {};
    const attachments: Promise<unknown>[] = [];
    for (const plane of PLANES) {
      const canvas = canvasRefs[plane].current;
      if (!canvas) continue;
      const nv = new Niivue({
        backColor: [0.025, 0.027, 0.025, 1],
        crosshairColor: [0.78, 0.65, 0.4, 0.72],
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
          const vox = nv.frac2vox(nv.canvasPos2frac([x, y])) as unknown as ArrayLike<number>;
          const voxel: [number, number, number] = [0, 1, 2].map((axis) => Math.round(Number(vox[axis]) || 0)) as [number, number, number];
          pointCallback.current({ candidateId, plane, voxel });
          setSliceIndex((current) => ({ ...current, [plane]: voxel[PLANE_AXIS[plane]] }));
          for (const item of Object.values(nvRef.current)) {
            if (!item) continue;
            item.nv.scene.crosshairPos = item.nv.vox2frac(voxel);
            item.nv.drawScene();
          }
        } catch {
          // Keep the canvas responsive if a click falls outside the rendered slice area.
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
    setStatus('Loading candidate scan…');
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
        const [apiManifest, appsResponse, localManifest] = await Promise.all([
          fetch(`/api/cases/dental/${encodeURIComponent(candidateId)}`),
          fetch('/api/apps').catch(() => null),
          fetch(`/casepacks/dental/${encodeURIComponent(candidateId)}/manifest.json`),
        ]);
        if (cancelled) return;
        const manifestResponse = apiManifest.ok ? apiManifest : localManifest;
        if (!manifestResponse.ok) throw new Error(`Candidate ${candidateId} could not be loaded (HTTP ${manifestResponse.status}).`);
        const raw = (await manifestResponse.json()) as CasePackManifest;
        const manifest = applyTargetTint(raw, training);
        const appConfigRaw = appsResponse?.ok ? ((await appsResponse.json()) as Record<string, unknown>).dental : undefined;
        const caseConfig = appConfigRaw ? parseAppConfig(appConfigRaw) : DEFAULT_APP;
        const errors = await v.load({ manifest, baseUrl: `/casepacks/dental/${encodeURIComponent(candidateId)}/`, app: caseConfig });
        if (cancelled) return;
        if (errors.length) setSurfaceMessage(`${errors.length} surface layer${errors.length === 1 ? '' : 's'} unavailable`);
        setSourceLine(`${manifest.source.dataset} · ${manifest.source.subjectId} · ${manifest.deidentified ? 'deidentified' : 'identity status unknown'}`);
        const volume = manifest.volumes[0];
        const views = PLANES.map((plane) => [plane, nvRef.current[plane]] as const).filter((entry) => entry[1]);
        if (!volume || !views.length) {
          setStatus('This candidate has no CBCT volume.');
          return;
        }
        const url = `/casepacks/dental/${encodeURIComponent(candidateId)}/${volume.file}`;
        const dims = await Promise.all(views.map(async ([plane, view]) => {
          const { nv } = view!;
          await nv.loadVolumes([{ url }]);
          if (cancelled) return { plane, vox: [0, 0, 0] as [number, number, number], sourceDims: undefined };
          nv.setSliceType(NV_TYPE[plane]!);
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
        setStatus('Research candidate scan · not for diagnosis');
      } catch (error) {
        if (cancelled) return;
        for (const item of Object.values(nvRef.current)) {
          if (!item) continue;
          for (const oldVolume of [...item.nv.volumes]) item.nv.removeVolume(oldVolume);
          item.nv.drawScene();
        }
        await v.load({ manifest: emptyManifest(candidateId), baseUrl: '', app: DEFAULT_APP });
        setStatus((error as Error).message || 'Candidate scan could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
  }, [candidateId, training, ready]);

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
    pointCallback.current({ candidateId, plane, voxel: position.map(Math.round) as [number, number, number] });
  }

  return (
    <div class="dv-imaging-shell">
      <div class="dv-view-tabs" role="tablist" aria-label="Imaging views">
        {([
          ['all', '4-up'],
          ['axial', 'Axial'],
          ['coronal', 'Coronal'],
          ['sagittal', 'Sagittal'],
        ] as const).map(([name, label]) => (
          <button key={name} type="button" role="tab" aria-selected={focus === name} class={focus === name ? 'on' : ''} onClick={() => setFocus(name)}>{label}</button>
        ))}
        <div class="dv-candidate-picker" aria-label="Candidate scan">
          {DENTAL_CANDIDATE_GROUPS[training].map((candidate) => (
          <button key={candidate.id} type="button" aria-pressed={candidate.id === candidateId} class={candidate.id === candidateId ? 'on' : ''} onClick={() => onCandidateChange(candidate.id)}>
              {candidate.id.replace('tf2-', '').toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div class={`dv-viewports focus-${focus}`} data-focus={focus}>
        <div class="dv-jaw">
          <span class="dv-view-label">SEGMENTED SURFACE</span>
          <div class="dv-surface-host" ref={surfaceHost} />
          {surfaceMessage && <span class="dv-surface-message">{surfaceMessage}</span>}
        </div>
        {PLANES.map((plane) => (
          <figure class={`dv-plane dv-plane-${plane} ${focus === plane ? 'on' : ''}`} key={plane}>
            <figcaption>{plane.toUpperCase()}<span>CBCT</span></figcaption>
            <canvas ref={canvasRefs[plane]} aria-label={`${plane} CBCT view`} />
            <input
              class="dv-slice-range"
              type="range"
              min="0"
              max={sliceMax[plane]}
              value={Math.min(sliceIndex[plane], sliceMax[plane])}
              aria-label={`${plane} slice position`}
              onInput={(event) => changeSlice(plane, Number(event.currentTarget.value))}
            />
            <span class="dv-slice-index">{sliceIndex[plane]} / {sliceMax[plane]}</span>
          </figure>
        ))}
        {status !== 'Research candidate scan · not for diagnosis' && <p class="dv-state">{status}</p>}
        {notes.length > 0 && <div class="dv-note-count">{notes.length} scan notes</div>}
      </div>
      <div class="dv-source-line">{sourceLine} · {status === 'Research candidate scan · not for diagnosis' ? 'Not for diagnosis' : status}</div>
    </div>
  );
}
