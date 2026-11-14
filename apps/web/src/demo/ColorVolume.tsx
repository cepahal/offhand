/** One Niivue view of a real FLAIR volume. Render is the 3D panel; the others are the three planes. */
import { useEffect, useRef } from 'preact/hooks';
import { Niivue, SHOW_RENDER, SLICE_TYPE } from '@niivue/niivue';

const MODE = {
  multi: SLICE_TYPE.MULTIPLANAR,
  render: SLICE_TYPE.RENDER,
  axial: SLICE_TYPE.AXIAL,
  coronal: SLICE_TYPE.CORONAL,
  sagittal: SLICE_TYPE.SAGITTAL,
} as const;

export function ColorVolume({ url, mode }: { url: string; mode: keyof typeof MODE }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const failed = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !url) return;
    const nv = new Niivue({
      sliceType: MODE[mode],
      multiplanarForceRender: mode === 'multi',
      multiplanarShowRender: mode === 'multi' ? SHOW_RENDER.ALWAYS : SHOW_RENDER.NEVER,
      backColor: [0.03, 0.05, 0.09, 1],
      crosshairColor: [1, 0.85, 0.2, 0.8],
      dragAndDropEnabled: false,
      isOrientCube: false,
      isColorbar: false,
      logLevel: 'error',
    });
    let cancelled = false;
    void nv.attachToCanvas(el).then(() => {
      if (cancelled) return;
      nv.setSliceType(MODE[mode]);
      return nv.loadVolumes([{ url, colormap: 'plasma' }]);
    }).catch(() => {
      if (!cancelled && failed.current) failed.current.hidden = false;
    });
    return () => {
      cancelled = true;
      nv.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [url, mode]);

  return (
    <div class="nv-canvas">
      <canvas ref={canvas} />
      <p ref={failed} class="nv-fail" hidden>No MRI loaded. Real scans come from the NeuroView case.</p>
    </div>
  );
}
