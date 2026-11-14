/** Gesture HUD: last gesture, board link status, mode, scrub bar. Readable from a few metres. */
import { useEffect, useState } from 'preact/hooks';
import { GESTURE_TEXT } from '../viewer/logic.js';
import { ui, useStore } from '../app/store.js';
import { GroupBox } from '../ui/win95.js';

const GLYPH: Record<string, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  forward: '⊕',
  backward: '⊖',
  cw: '↻',
  ccw: '↺',
  wave: '≈',
};

export function GestureHud() {
  const s = useStore(ui);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const g = s.lastGesture;
  const fresh = g && Date.now() - g.at < 1500;
  const link = s.modules['gesture'];
  const mode = s.view?.mode ?? 'orbit';
  const scrub = s.view?.scrub ?? 0;
  const appCfg = s.caseConfig ?? (s.manifest ? s.apps[s.manifest.app] : undefined);
  const scrubLabel = appCfg?.scrub.label ?? 'Scrub';
  return (
    <GroupBox label="Gesture">
      <div class="hud-gesture">
        <div class={`hud-icon ${fresh ? 'flash' : ''}`}>{g ? (GLYPH[g.name] ?? '?') : '·'}</div>
        <div>
          <div>
            <b>{g ? (GESTURE_TEXT[g.name as keyof typeof GESTURE_TEXT] ?? g.name) : 'No gesture yet'}</b>
          </div>
          <div class="small">
            Mode: <span class={`mode-badge ${mode}`}>{mode.toUpperCase()}</span>
            {s.listening && (
              <>
                {' '}
                <span class="mode-badge scrub">LISTEN</span>
              </>
            )}
          </div>
          <div class="small">
            <span class={`dot ${link?.status ?? 'off'}`} />
            {link ? `Board: ${link.status}` : 'Board: hub offline'}
          </div>
        </div>
      </div>
      {link && <div class="small" style={{ marginTop: '4px' }}>{link.detail}</div>}
      <div class="small" style={{ marginTop: '4px' }}>
        {scrubLabel}: {Math.round(scrub * 100)}%{s.hoverMock && ' (hover mock: hold still 1 s)'}
      </div>
      <div class="scrubbar">
        <div style={{ width: `${Math.round(scrub * 100)}%` }} />
      </div>
    </GroupBox>
  );
}
