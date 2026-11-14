/** Mounts the three.js Viewer and draws the overlays (test-pattern / mock banners). The source credit is in the top bar. */
import { useEffect, useRef } from 'preact/hooks';
import { controller } from '../app/controller.js';
import { ui, useStore } from '../app/store.js';
import { caseBanner } from './logic.js';
import { Viewer } from './Viewer.js';

export function ViewerPane() {
  const host = useRef<HTMLDivElement>(null);
  const s = useStore(ui);

  useEffect(() => {
    if (!host.current) return;
    const v = new Viewer(host.current);
    controller.attach(v);
    // For poking at it from DevTools.
    (window as unknown as { offhand?: unknown }).offhand = { viewer: v, controller };
    return () => {
      controller.detach();
      v.dispose();
    };
  }, []);

  const m = s.manifest;
  const banner = caseBanner(m, s.mock);
  const focused = m?.findings.find((f) => f.id === s.view?.focusedFindingId);

  return (
    <div class="viewport">
      <div class="canvas-host" ref={host} />
      {banner && (
        <div class="banner">
          {banner}
          {s.caseNote && <div class="banner-note">{s.caseNote}</div>}
        </div>
      )}
      {m && (
        <div class="overlay tl">
          {m.title}
          <div class="small" style={{ color: '#c0c0c0', fontWeight: 'normal' }}>
            {m.app} / {m.caseId}
          </div>
        </div>
      )}
      {m && (
        <div class="overlay tr">
          {s.view?.mode === 'scrub' ? 'SCRUB' : 'ORBIT'}
          {focused && <div style={{ color: '#ffff00' }}>● {focused.label}</div>}
        </div>
      )}
      {!m && !s.loading && (
        <div class="empty">
          No case loaded.
          <br />
          Choose a case in the top bar.
        </div>
      )}
      {s.loading && <div class="empty">{s.loading}</div>}
    </div>
  );
}
