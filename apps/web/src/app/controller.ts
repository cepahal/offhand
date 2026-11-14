/**
 * Glue between the hub, the 3D viewer and the UI store.
 *
 * Command flow: every input (gesture board, keyboard, mouse, voice, integrations) becomes a
 * ViewerCommand on the hub bus. The viewer sends its own commands to the hub and applies them
 * when they come back, so all inputs take the same path. If the hub is unreachable, mouse and
 * keyboard commands are applied locally instead.
 */
import {
  makeCommand,
  type BusEnvelope,
  type CommandSource,
  type GestureName,
  type ViewerCommand,
  type ViewerCommandBody,
  type ViewerState,
} from '@offhand/contracts';
import { parseAppConfig, type AppConfig } from '../viewer/appConfig.js';
import type { LoadedCase, Viewer } from '../viewer/Viewer.js';
import { api, HubClient } from './hub.js';
import { logLine, ui } from './store.js';

/** Frontend-only case sources (e.g. labelled mocks). Key = manifest.app. */
export interface LocalCaseSource {
  app: string;
  list(): { caseId: string; title: string }[];
  load(caseId: string): Promise<LoadedCase>;
}

export interface LocalCaseEntry {
  app: string;
  caseId: string;
  title: string;
}

export class Controller {
  readonly hub = new HubClient();
  private viewer: Viewer | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = '';
  private hubState: ViewerState | null = null;
  private casesFetched = false;
  private autoloaded = false;
  private seq = 0;
  private local = new Map<string, LocalCaseSource>();

  start(): void {
    this.hub.onStatus((s) => {
      const was = ui.get().hub;
      ui.set({ hub: s });
      if (s === 'open') logLine('Connected to hub.');
      if (s === 'closed' && was === 'open') logLine('Hub disconnected. Retrying...', 'warn');
      if (s === 'open') void this.refreshCases();
    });
    this.hub.on((env) => this.onEnvelope(env));
    this.hub.connect();
    void this.refreshHealth();
    setInterval(() => void this.refreshHealth(), 3000);
  }

  registerLocal(src: LocalCaseSource): void {
    this.local.set(src.app, src);
  }

  /** Cases provided by the frontend itself (listed separately from hub case packs). */
  localCases(): LocalCaseEntry[] {
    return [...this.local.values()].flatMap((src) => src.list().map((c) => ({ app: src.app, ...c })));
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer;
    viewer.onChange = () => this.scheduleState();
    viewer.onInfo = (m) => logLine(m);
    this.maybeAutoload();
  }

  detach(): void {
    this.viewer = null;
  }

  // ------------------------------------------------------------------------------------------
  // Outgoing
  // ------------------------------------------------------------------------------------------
  dispatch(body: ViewerCommandBody, source: CommandSource): void {
    const cmd = makeCommand(body, source);
    if (!this.hub.send({ ch: 'cmd', cmd })) void this.handleCommand(cmd);
  }

  /** Keyboard gesture mock: goes through the hub's gesture mapper, like the real board. */
  mockGesture(g: GestureName): void {
    const ev = { t: 'g' as const, g, seq: ++this.seq, ms: Math.round(performance.now()) };
    if (!this.hub.send({ ch: 'gesture', ev })) logLine('Gesture mock needs the hub (it is offline).', 'warn');
  }

  mockHover(x: number, y: number, z: number): void {
    const r = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    const ev = { t: 'h' as const, x: r(x), y: r(y), z: r(z), seq: ++this.seq, ms: Math.round(performance.now()) };
    this.hub.send({ ch: 'gesture', ev });
  }

  restoreBookmark(id: string): void {
    const b = ui.get().bookmarks.find((x) => x.id === id);
    if (b && this.viewer) this.viewer.restore(b.state);
  }

  highlightLayer(id: string | null): void {
    this.viewer?.highlightLayer(id);
  }

  // ------------------------------------------------------------------------------------------
  // Incoming
  // ------------------------------------------------------------------------------------------
  private onEnvelope(env: BusEnvelope): void {
    switch (env.ch) {
      case 'cmd':
        void this.handleCommand(env.cmd);
        break;
      case 'state':
        // Sent once on connect: the hub's cached state (e.g. after a page reload).
        if (!this.hubState) {
          this.hubState = env.state;
          this.maybeAutoload();
        }
        break;
      case 'gesture':
        if (env.ev.t === 'g') ui.set({ lastGesture: { name: env.ev.g, at: Date.now() } });
        break;
      case 'log': {
        if (env.level === 'debug' && env.module !== 'gesture.fw') break;
        if (env.module === 'gesture.fw' && env.msg.startsWith('[HOVER] x=')) break;
        const level = env.level === 'error' ? 'error' : env.level === 'warn' ? 'warn' : 'info';
        logLine(`[${env.module}] ${env.msg}`, level);
        break;
      }
      default:
        // 'voice' and 'share' belong to the voice/share panels.
        break;
    }
  }

  async handleCommand(cmd: ViewerCommand): Promise<void> {
    ui.set({ lastCommand: { type: cmd.type, source: cmd.source, at: Date.now() } });
    switch (cmd.type) {
      case 'load_case':
        await this.loadCase(cmd.app, cmd.caseId);
        return;
      case 'capture':
        await this.capture(cmd.requestId);
        return;
      case 'bookmark':
        await this.bookmark(cmd.label);
        return;
      case 'listen':
        ui.set({ listening: cmd.on });
        return;
      case 'explain':
      case 'share_to_patient':
      case 'confirm':
      case 'cancel':
        return; // acted on by the voice/share modules
      default:
        if (!this.viewer?.apply(cmd)) logLine(`Viewer not ready for "${cmd.type}".`, 'warn');
    }
  }

  // ------------------------------------------------------------------------------------------
  // Cases
  // ------------------------------------------------------------------------------------------
  async refreshCases(): Promise<void> {
    try {
      const [{ cases, invalid }, rawApps] = await Promise.all([api.cases(), api.apps()]);
      const apps: Record<string, AppConfig> = {};
      for (const [k, v] of Object.entries(rawApps)) apps[k] = parseAppConfig(v);
      ui.set({ cases, invalid, apps });
      for (const bad of invalid) logLine(`Invalid case pack ${bad.path}: ${bad.errors[0] ?? ''}`, 'warn');
    } catch (e) {
      logLine(`Could not list case packs: ${(e as Error).message}`, 'error');
    }
    this.casesFetched = true;
    this.maybeAutoload();
  }

  private maybeAutoload(): void {
    if (this.autoloaded || !this.viewer || !this.casesFetched || ui.get().manifest) return;
    this.autoloaded = true;
    const { cases } = ui.get();
    const s = this.hubState;
    const prev = s?.app && s.caseId ? cases.find((c) => c.app === s.app && c.caseId === s.caseId) : undefined;
    const pick = prev ?? cases[0];
    if (!pick) {
      ui.set({ dialog: 'open' });
      return;
    }
    void this.loadCase(pick.app, pick.caseId).then(() => {
      if (prev && s && this.viewer) {
        this.viewer.restore(s);
        ui.set({ bookmarks: s.bookmarks });
      }
    });
  }

  async loadCase(app: string, caseId: string): Promise<void> {
    if (!this.viewer) return;
    ui.set({ loading: `Loading ${app}/${caseId}...` });
    try {
      const local = this.local.get(app);
      let c: LoadedCase;
      if (local) {
        c = await local.load(caseId);
      } else {
        const manifest = await api.manifest(app, caseId);
        c = {
          manifest,
          baseUrl: `/casepacks/${encodeURIComponent(app)}/${encodeURIComponent(caseId)}/`,
          app: ui.get().apps[app] ?? parseAppConfig(null),
        };
      }
      const errors = await this.viewer.load(c);
      errors.forEach((e) => logLine(`Layer failed to load: ${e}`, 'error'));
      ui.set({
        manifest: c.manifest,
        mock: !!local,
        caseConfig: c.app,
        caseNote: c.note ?? null,
        bookmarks: [],
      });
      logLine(`Loaded "${c.manifest.title}" (${c.manifest.layers.length} layers).`);
    } catch (e) {
      logLine(`Could not load ${app}/${caseId}: ${(e as Error).message}`, 'error');
    } finally {
      ui.set({ loading: null });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Capture + bookmarks
  // ------------------------------------------------------------------------------------------
  private async capture(requestId: string): Promise<void> {
    if (!this.viewer) return;
    try {
      const url = await api.snapshot(requestId, this.viewer.capture());
      logLine(`Snapshot saved: ${url}`);
    } catch (e) {
      logLine(`Snapshot failed: ${(e as Error).message}`, 'error');
    }
  }

  private async bookmark(label?: string): Promise<void> {
    if (!this.viewer || !ui.get().manifest) return;
    const state = this.viewer.snapshot();
    const id = crypto.randomUUID();
    const n = ui.get().bookmarks.length + 1;
    let snapshotUrl: string | undefined;
    try {
      snapshotUrl = await api.snapshot(id, this.viewer.capture());
    } catch {
      snapshotUrl = undefined; // bookmark still works without a picture
    }
    ui.set({ bookmarks: [...ui.get().bookmarks, { id, label: label ?? `View ${n}`, snapshotUrl, state }] });
    logLine(`Bookmarked "${label ?? `View ${n}`}".`);
    this.scheduleState();
  }

  // ------------------------------------------------------------------------------------------
  // State (published to the hub at most 10 Hz)
  // ------------------------------------------------------------------------------------------
  private scheduleState(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.publishState();
    }, 100);
  }

  private publishState(): void {
    if (!this.viewer) return;
    const view = this.viewer.snapshot();
    ui.set({ view });
    if (ui.get().mock) return; // mocks are frontend-only; keep them off the bus
    const state: ViewerState = { ...view, bookmarks: ui.get().bookmarks, pending: {} };
    const json = JSON.stringify(state);
    if (json !== this.lastSent && this.hub.send({ ch: 'state', state })) this.lastSent = json;
  }

  private async refreshHealth(): Promise<void> {
    try {
      const h = await api.health();
      ui.set({ modules: h.modules });
    } catch {
      ui.set({ modules: {} });
    }
  }
}

export const controller = new Controller();
