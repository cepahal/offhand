/**
 * Slice panel: one NiiVue 2D view of the case's volume for the current timepoint.
 *
 * The viewer's slice state ({plane, index}) is the single source of truth, in both directions:
 *   - state -> NiiVue: plane picks the NiiVue slice type, index moves the crosshair along that
 *     plane's voxel axis;
 *   - NiiVue -> state: clicking or scrolling in the slice view sends a `slice` command, which goes
 *     through the hub like every other input and comes back as state.
 * Volumes are written by the pipeline in canonical RAS, so voxel axes are R, A, S (PLANE_AXIS).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Niivue, SLICE_TYPE } from '@niivue/niivue';
import type { SlicePlane } from '@hoverscan/contracts';
import { controller } from '../app/controller.js';
import { logLine, ui, useStore } from '../app/store.js';
import { clamp, orderedTimepoints, PLANE_AXIS, volumeForTimepoint } from '../viewer/logic.js';

const send = controller.dispatch.bind(controller);
const PLANES: SlicePlane[] = ['axial', 'coronal', 'sagittal'];
const NV_TYPE: Record<SlicePlane, SLICE_TYPE> = {
  axial: SLICE_TYPE.AXIAL,
  coronal: SLICE_TYPE.CORONAL,
  sagittal: SLICE_TYPE.SAGITTAL,
};

type Vox = [number, number, number];

export function SlicePanel() {
  const s = useStore(ui);
  const canvas = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const [dims, setDims] = useState<Vox | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const m = s.manifest;
  const view = s.view;
  const plane = view?.slice.plane ?? 'axial';
  const vol = m ? volumeForTimepoint(m, view?.timepoint ?? 0) : undefined;
  const url = m && vol ? `/casepacks/${encodeURIComponent(m.app)}/${encodeURIComponent(m.caseId)}/${vol.file}` : null;
  const max = dims ? dims[PLANE_AXIS[plane]] - 1 : 0;
  const index = clamp(view?.slice.index ?? 0, 0, max);
  const cfg = s.caseConfig ?? (m ? s.apps[m.app] : undefined);
  const tp = m ? orderedTimepoints(m)[view?.timepoint ?? 0] : undefined;

  // Latest state for the NiiVue callback (it is registered once).
  const live = useRef({ plane, index, dims });
  live.current = { plane, index, dims };

  useEffect(() => {
    if (!canvas.current) return;
    const nv = new Niivue({
      backColor: [0, 0, 0, 1],
      show3Dcrosshair: false,
      crosshairColor: [1, 1, 0, 0.5],
      dragAndDropEnabled: false,
      isOrientCube: false,
      logLevel: 'warn',
    });
    nvRef.current = nv;
    nv.onLocationChange = (data: unknown) => {
      const st = live.current;
      const v = (data as { vox?: number[] }).vox;
      if (!v || !st.dims) return;
      const i = Math.round(v[PLANE_AXIS[st.plane]] ?? NaN);
      if (Number.isFinite(i) && i !== st.index) send({ type: 'slice', plane: st.plane, index: i }, 'mouse');
    };
    void nv.attachToCanvas(canvas.current);
    return () => {
      nvRef.current = null;
      nv.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || url === loaded) return;
    if (!url) {
      // Never leave another case's images on screen (e.g. next to a mock).
      for (const v of [...nv.volumes]) nv.removeVolume(v);
      nv.drawScene();
      setDims(null);
      setLoaded(null);
      return;
    }
    let cancelled = false;
    nv.loadVolumes([{ url }])
      .then(() => {
        if (cancelled) return;
        const d = nv.volumes[0]?.dimsRAS;
        const next: Vox | null = d ? [d[1]!, d[2]!, d[3]!] : null;
        setDims(next);
        setLoaded(url);
      })
      .catch((e: Error) => logLine(`Slice view could not load ${vol?.file}: ${e.message}`, 'error'));
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Every case load resets the viewer to slice 0, outside the volume's content; start in the middle.
  const centred = useRef(-1);
  useEffect(() => {
    if (!dims || loaded !== url || centred.current === s.loadSeq) return;
    centred.current = s.loadSeq;
    const cur = controller.currentSlice();
    if (cur && cur.index === 0) {
      send({ type: 'slice', plane: cur.plane, index: Math.floor(dims[PLANE_AXIS[cur.plane]] / 2) }, 'system');
    }
  }, [s.loadSeq, dims, loaded]);

  // A newly focused finding: slice through its centre (RAS mm -> this volume's voxel).
  const focusedId = view?.focusedFindingId ?? null;
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !dims || loaded !== url || focusedId === lastFocus.current) return;
    lastFocus.current = focusedId;
    const f = m?.findings.find((x) => x.id === focusedId);
    if (!f) return;
    const vox = nv.frac2vox(nv.mm2frac([f.center[0], f.center[1], f.center[2]])) as unknown as number[];
    const i = Math.round(vox[PLANE_AXIS[plane]] ?? NaN);
    if (Number.isFinite(i) && i !== index) send({ type: 'slice', plane, index: clamp(i, 0, max) }, 'system');
  }, [focusedId, dims, loaded]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !dims || loaded !== url) return;
    nv.setSliceType(NV_TYPE[plane]);
    const cur = nv.frac2vox(nv.scene.crosshairPos) as unknown as number[];
    const vox: Vox = [cur[0] ?? 0, cur[1] ?? 0, cur[2] ?? 0];
    if (Math.round(vox[PLANE_AXIS[plane]]) !== index) {
      vox[PLANE_AXIS[plane]] = index;
      nv.scene.crosshairPos = nv.vox2frac(vox);
    }
    nv.drawScene();
  }, [plane, index, dims, loaded]);

  if (!m) return null;
  return (
    <div class="slicepanel">
      <div class="slice-controls">
        <div class="slice-planes">
          {PLANES.map((p) => (
            <button
              key={p}
              class={p === plane ? 'pressed' : ''}
              disabled={!dims}
              onClick={() => send({ type: 'slice', plane: p, index: dims ? Math.floor(dims[PLANE_AXIS[p]] / 2) : 0 }, 'mouse')}
            >
              {p[0]!.toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={max}
          value={index}
          disabled={!dims}
          onInput={(e) => send({ type: 'slice', plane, index: Number((e.target as HTMLInputElement).value) }, 'mouse')}
        />
        <div class="small">
          {dims ? `${plane} slice ${index} / ${max}` : vol ? 'Loading volume…' : 'No volumes in this case pack.'}
          {tp && ` · ${tp.label}`}
          {vol && <div>{`${vol.modality} ${vol.sequence}`}</div>}
        </div>
        {cfg?.credit ? (
          <div class="small credit">{cfg.credit}</div>
        ) : (
          <div class="small credit">
            Source: {m.source.dataset} ({m.source.subjectId})
          </div>
        )}
      </div>
      <div class="sunken slice-view">
        <canvas ref={canvas} />
        {!vol && <div class="slice-empty">No volumes in this case pack.</div>}
      </div>
    </div>
  );
}
