/**
 * Real NeuroView slices, or a text placeholder when no volume is on disk.
 * This component does not draw an anatomical shape.
 */
import { useEffect, useRef } from 'preact/hooks';
import { Niivue, SLICE_TYPE } from '@niivue/niivue';
import type { NotePointer } from './scan-notes.js';
import { scannerNodes, type NeuroVolume } from './scanner-commands.js';

export interface ScanCursor {
  pointer: NotePointer;
  screen: { x: number; y: number };
}

export function MriScanner({
  volume,
  pins,
  nudge,
  onCursor,
}: {
  volume: NeuroVolume | null;
  pins: readonly { text: string; x: number; y: number }[];
  nudge: { tick: number; delta: -1 | 1 };
  onCursor: (cursor: ScanCursor) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const cursorRef = useRef(onCursor);
  cursorRef.current = onCursor;
  const view = scannerNodes(volume);
  const sliceUrl = view.kind === 'slices' ? view.url : '';
  const caption = view.kind === 'slices' ? view.caption : '';

  useEffect(() => {
    if (!sliceUrl || !canvas.current) return;
    const canvasEl = canvas.current;
    const nv = new Niivue({
      sliceType: SLICE_TYPE.MULTIPLANAR,
      multiplanarForceRender: true,
      backColor: [0, 0, 0, 1],
      dragAndDropEnabled: false,
      isOrientCube: false,
      logLevel: 'warn',
    });
    nvRef.current = nv;
    let cancelled = false;
    const onClick = (event: MouseEvent) => {
      const rect = canvasEl.getBoundingClientRect();
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const sx = rect.width > 0 ? (screen.x / rect.width) * canvasEl.width : screen.x;
      const sy = rect.height > 0 ? (screen.y / rect.height) * canvasEl.height : screen.y;
      let coordinates = { x: Math.round(screen.x), y: Math.round(screen.y), z: 0 };
      let sliceIndex = 0;
      try {
        const frac = nv.canvasPos2frac([sx, sy]);
        const vox = nv.frac2vox(frac);
        const axis = (index: number) => {
          const value = (vox as ArrayLike<number>)[index];
          return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
        };
        coordinates = { x: axis(0), y: axis(1), z: axis(2) };
        sliceIndex = coordinates.z;
      } catch {
        // A click that misses a plane still records the cursor in canvas pixels.
      }
      cursorRef.current({
        pointer: { scanName: caption, sliceIndex, coordinates },
        screen,
      });
    };
    canvasEl.addEventListener('click', onClick);
    void nv.attachToCanvas(canvasEl).then(() => {
      if (cancelled) return;
      nv.setSliceType(SLICE_TYPE.MULTIPLANAR);
      return nv.loadVolumes([{ url: sliceUrl }]);
    });
    return () => {
      cancelled = true;
      canvasEl.removeEventListener('click', onClick);
      nvRef.current = null;
      nv._gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [sliceUrl, caption]);

  useEffect(() => {
    if (!nvRef.current || nudge.tick === 0) return;
    nvRef.current.moveCrosshairInVox(0, 0, nudge.delta);
  }, [nudge.tick, nudge.delta]);

  if (view.kind === 'text') {
    return (
      <p class="mri-empty" data-mri-placeholder="true">
        {view.text}
      </p>
    );
  }

  return (
    <div class="mri-real">
      <p class="mri-caption">{view.caption}. Axial, coronal, sagittal, and 3D. NeuroView case, not this patient's scan.</p>
      <div class="mri-stage">
        <canvas ref={canvas} data-mri-slices="true" aria-label="MRI slices" width={640} height={360} />
        {pins.map((pin, index) => (
          <div key={`${pin.text}-${index}`} class="mri-pin" style={{ left: `${pin.x}px`, top: `${pin.y}px` }}>
            <svg width="72" height="48" aria-hidden="true">
              <line x1="0" y1="0" x2="64" y2="-32" />
            </svg>
            <span class="mri-sticky">{pin.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
