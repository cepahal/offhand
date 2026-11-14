/**
 * Keyboard + mouse input. Everything becomes a ViewerCommand (or a mock gesture event that goes
 * through the hub's gesture mapper exactly like the real board).
 *
 * Gesture mock (same keys as the plan):
 *   arrows = swipe left/right/up/down    [ = spin cw    ] = spin ccw
 *   + / =  = push (forward)              - = pull (backward)
 *   w      = wave                        hold h + move mouse = hover (hold still 1 s -> scrub)
 * Viewer shortcuts:
 *   r reset   b bookmark   c capture   n / p next / prev finding   m orbit/scrub
 *   , / .  scrub -/+       1..9 toggle layer   o open case   s slice panel   ? keys   Esc close
 */
import type { GestureName, ViewerCommandBody } from '@offhand/contracts';
import type { Controller } from '../app/controller.js';
import { ui } from '../app/store.js';

const GESTURE_KEYS: Record<string, GestureName> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  '[': 'cw',
  ']': 'ccw',
  '+': 'forward',
  '=': 'forward',
  '-': 'backward',
  _: 'backward',
  w: 'wave',
};

/** Hub mapper defaults, used only when the hub is offline. */
function offlineGesture(g: GestureName): ViewerCommandBody | null {
  switch (g) {
    case 'left':
      return { type: 'rotate', yawDeg: -30 };
    case 'right':
      return { type: 'rotate', yawDeg: 30 };
    case 'up':
      return { type: 'rotate', pitchDeg: 20 };
    case 'down':
      return { type: 'rotate', pitchDeg: -20 };
    case 'forward':
      return { type: 'zoom', factor: 1.25 };
    case 'backward':
      return { type: 'zoom', factor: 0.8 };
    case 'cw':
      return { type: 'peel', dir: 'out' };
    case 'ccw':
      return { type: 'peel', dir: 'in' };
    case 'wave':
      return { type: 'listen', on: !ui.get().listening };
    default:
      return null;
  }
}

export function installKeyboard(ctl: Controller): () => void {
  let hoverTimer: ReturnType<typeof setInterval> | null = null;
  let mouse = { x: 0.5, y: 0.5 };

  const onMove = (e: MouseEvent) => {
    mouse = { x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight };
  };

  const stopHover = () => {
    if (hoverTimer) clearInterval(hoverTimer);
    hoverTimer = null;
    ui.set({ hoverMock: false });
  };

  const onDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
      return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'Escape') {
      ui.set({ dialog: null });
      return;
    }
    if (ui.get().dialog) return;

    const g = GESTURE_KEYS[key];
    if (g) {
      e.preventDefault();
      if (e.repeat) return;
      if (ctl.hub.status === 'open') ctl.mockGesture(g);
      else {
        const body = offlineGesture(g);
        if (body) ctl.dispatch(body, 'keyboard');
        ui.set({ lastGesture: { name: g, at: Date.now() } });
      }
      return;
    }

    if (key === 'h') {
      if (!hoverTimer) {
        ui.set({ hoverMock: true });
        hoverTimer = setInterval(() => ctl.mockHover(mouse.x, mouse.y, 0.6), 50);
      }
      return;
    }
    if (e.repeat) return;

    const view = ui.get().view;
    const manifest = ui.get().manifest;
    const send = (b: ViewerCommandBody) => ctl.dispatch(b, 'keyboard');
    switch (key) {
      case 'r':
        return send({ type: 'reset_view' });
      case 'b':
        return send({ type: 'bookmark' });
      case 'c':
        return send({ type: 'capture', requestId: crypto.randomUUID() });
      case 'n':
        return send({ type: 'focus_finding', findingId: 'next' });
      case 'p':
        return send({ type: 'focus_finding', findingId: 'prev' });
      case 'm':
        return send({ type: 'mode', mode: view?.mode === 'scrub' ? 'orbit' : 'scrub' });
      case ',':
      case '.': {
        const v = (view?.scrub ?? 0) + (key === '.' ? 0.05 : -0.05);
        return send({ type: 'scrub', value: Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000 });
      }
      case 'o':
        return ui.set({ dialog: 'open' });
      case 's':
        return ui.set({ slicePanel: !ui.get().slicePanel });
      case '?':
      case 'F1':
        e.preventDefault();
        return ui.set({ dialog: 'keys' });
      default:
        if (/^[1-9]$/.test(key) && manifest) {
          const layer = manifest.layers[Number(key) - 1];
          const cur = view?.layers.find((l) => l.id === layer?.id);
          if (layer) send({ type: 'set_layer', layerId: layer.id, visible: !(cur?.visible ?? true) });
        }
    }
  };

  const onUp = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'h') stopHover();
  };

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('blur', stopHover);
  return () => {
    stopHover();
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('blur', stopHover);
  };
}
