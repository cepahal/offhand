import { GestureEvent, type ViewerCommand } from '@offhand/contracts';
import type { HubContext, HubModule, ModuleHealth } from '../modules.js';
import { GestureLink, type LinkStatus } from './link.js';
import { GestureMapper } from './mapper.js';

export function linkHealth(s: LinkStatus): ModuleHealth {
  switch (s.state) {
    case 'off':
    case 'searching':
    case 'no_device':
    case 'connecting':
      // Keyboard mock in the viewer stands in for the board.
      return { status: 'mock', detail: `${s.detail} Keyboard mock active.` };
    case 'live':
      return s.paj === 'missing' || s.paj === 'lost'
        ? { status: 'error', detail: s.detail }
        : { status: 'live', detail: s.detail };
    case 'silent':
    case 'lost':
    case 'error':
      return { status: 'error', detail: `${s.detail} Keyboard mock still works.` };
  }
}

/**
 * Gesture module: serial link to the ESP32 + PAJ7620 board, plus the keyboard mock.
 * Raw board events go out on ch:"gesture"; mapped ViewerCommands go out on ch:"cmd".
 * The viewer's keyboard mock sends {ch:"gesture", ev} and goes through the same mapper,
 * so mock and hardware behave identically.
 */
export function createGestureModule(ctx: HubContext): HubModule {
  const { cfg, bus, log } = ctx;
  const mapperCfg = { debounceMs: cfg.gesture.debounceMs };
  const boardMapper = new GestureMapper('gesture', mapperCfg);
  const mockMapper = new GestureMapper('keyboard', mapperCfg);
  const link = new GestureLink(cfg.gesture);
  let ticker: NodeJS.Timeout | null = null;

  const emit = (cmds: ViewerCommand[], origin: string): void => {
    for (const cmd of cmds) {
      const r = bus.publish({ ch: 'cmd', cmd }, origin);
      if (!r.ok) log.warn({ err: r.error, cmd }, 'gesture: mapped command rejected');
    }
  };

  const busLog = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) =>
    bus.publish({ ch: 'log', level, module: 'gesture', msg, ...(data ? { data } : {}) }, 'gesture');

  link.on('status', (s) => {
    const h = linkHealth(s);
    const level = h.status === 'error' ? 'warn' : 'info';
    log[level]({ state: s.state, port: s.port, paj: s.paj }, `gesture: ${s.detail}`);
    busLog(level, s.detail, { state: s.state, paj: s.paj, ...(s.port ? { port: s.port } : {}) });
  });
  link.on('comment', (text) => {
    // Firmware's human-readable serial-monitor lines.
    log.debug(`gesture fw: ${text}`);
    bus.publish({ ch: 'log', level: 'debug', module: 'gesture.fw', msg: text }, 'gesture');
  });
  link.on('invalid', ({ line, error }) => log.debug({ line, error }, 'gesture: ignored line'));
  link.on('event', (ev) => {
    if (ev.t === 'err') log.warn(`gesture board error: ${ev.msg}`);
    if (ev.t !== 'h') log.debug({ ev }, 'gesture event');
    bus.publish({ ch: 'gesture', ev }, 'gesture');
    emit(boardMapper.handle(ev, Date.now()), 'gesture');
  });

  return {
    name: 'gesture',
    start() {
      link.start();
      ticker = setInterval(() => {
        const now = Date.now();
        emit(boardMapper.tick(now), 'gesture');
        emit(mockMapper.tick(now), 'keyboard');
      }, 50);
    },
    async stop() {
      if (ticker) clearInterval(ticker);
      await link.stop();
    },
    health: () => linkHealth(link.status),
    registerRoutes(app) {
      app.get('/api/gesture/status', async () => link.status);
    },
    onClientMessage(raw, clientId) {
      if (typeof raw !== 'object' || raw === null || (raw as { ch?: unknown }).ch !== 'gesture') return false;
      const parsed = GestureEvent.safeParse((raw as { ev?: unknown }).ev);
      if (!parsed.success) return false; // let the bus reject it with a proper error
      const origin = `ws:${clientId}`;
      bus.publish({ ch: 'gesture', ev: parsed.data }, origin);
      emit(mockMapper.handle(parsed.data, Date.now()), origin);
      return true;
    },
  };
}
