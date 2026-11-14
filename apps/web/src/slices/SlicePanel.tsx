/**
 * Slice panel. PLACEHOLDER: the NiiVue 2D slice views are not wired yet (see research notes,
 * section "Experiments": NiiVue on the Pi + mesh-over-slice overlay). It already shows the slice
 * state that `slice` / `scrub` commands produce, so the command path can be tested end to end.
 */
import { ui, useStore } from '../app/store.js';

export function SlicePanel() {
  const { manifest, view } = useStore(ui);
  const vols = manifest?.volumes ?? [];
  return (
    <div class="slicepanel">
      {(['axial', 'coronal', 'sagittal'] as const).map((p) => (
        <div class="sunken" key={p}>
          <div>
            <b>{p.toUpperCase()}</b>
            <br />
            {view?.slice.plane === p ? `slice ${view.slice.index}` : '—'}
            <br />
            <span class="small" style={{ color: '#808080' }}>
              Slice viewer (NiiVue) not wired yet.
              <br />
              {vols.length ? `${vols.length} volume(s) in this case pack.` : 'No volumes in this case pack.'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
