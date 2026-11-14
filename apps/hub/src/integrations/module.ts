import type { AppId, BusEnvelope } from "@hoverscan/contracts";
import type { FastifyInstance } from "fastify";
import type { Bus } from "../bus/bus.js";
import type { Logger } from "../log/logger.js";
import { MESSAGING_ORIGIN } from "../messaging/share-flow.js";
import type { HubModule, ModuleHealth } from "../modules.js";
import { assertLiveReady, loadIntegrationsConfig, type IntegrationsConfig } from "./config.js";
import type { Integration, ShareDirectory } from "./integration.js";
import { LogOnlyIntegration } from "./log-only.js";
import { loadPatientMap, MockOpenDental, OpenDentalHttpClient, OpenDentalIntegration } from "./opendental.js";
import { MockStudySource, OrthancDicomWebClient, OrthancIntegration } from "./orthanc.js";
import { FileCaseLookup } from "../ai/case-lookup.js";
import { ClinicInboxIntegration } from "./clinic-inbox.js";
import { assertLocalSlicerUrl, HttpSlicerTransport, RecordingSlicerTransport, SlicerIntegration } from "./slicer.js";

export interface IntegrationsModuleOptions {
  logger: Logger;
  bus: Bus;
  config?: IntegrationsConfig;
  shares: ShareDirectory;
  /** Case packs, so Slicer can load the current case's volume. */
  casepackDir?: string;
  now?: () => number;
}

export type IntegrationsModule = HubModule & {
  readonly config: IntegrationsConfig;
  readonly integrations: readonly Integration[];
  get<T extends Integration>(name: string): T | undefined;
  /** Resolves when every queued call has finished (tests). */
  idle(): Promise<void>;
};

/** Builds the enabled integrations. Off ones are never constructed; live ones refuse to start without settings. */
export function buildIntegrations(cfg: IntegrationsConfig, logger: Logger, now: () => number = Date.now, casepackDir?: string): Integration[] {
  assertLiveReady(cfg);
  const out: Integration[] = [];
  if (cfg.logonly.mode !== "off") out.push(new LogOnlyIntegration(cfg.logonly.apps, logger, now));
  if (cfg.opendental.mode !== "off") {
    const { mode, apps, url, developerKey, customerKey, patientsFile } = cfg.opendental;
    const api = mode === "live" ? new OpenDentalHttpClient({ baseUrl: url, developerKey, customerKey }) : new MockOpenDental(now);
    out.push(new OpenDentalIntegration(mode, apps, api, loadPatientMap(patientsFile), logger));
  }
  if (cfg.slicer.mode !== "off") {
    const { mode, apps, url, sliceMaxIndex } = cfg.slicer;
    const base = assertLocalSlicerUrl(url);
    const transport = mode === "live" ? new HttpSlicerTransport(base) : new RecordingSlicerTransport(now);
    const cases = casepackDir ? { cases: new FileCaseLookup(casepackDir, logger), casepackDir } : {};
    out.push(new SlicerIntegration(mode, apps, transport, sliceMaxIndex, logger, cases));
  }
  if (cfg.orthanc.mode !== "off") {
    const { mode, apps, url, username, password } = cfg.orthanc;
    const source = mode === "live" ? new OrthancDicomWebClient({ baseUrl: url, username, password }) : new MockStudySource();
    out.push(new OrthancIntegration(mode, apps, source, logger));
  }
  if (cfg.clinicinbox.mode !== "off") {
    out.push(new ClinicInboxIntegration(cfg.clinicinbox.mode, cfg.clinicinbox.apps, cfg.clinicinbox.file, logger, now));
  }
  return out;
}

/**
 * Passes bus events to the integrations that support the current app: onState for state, onCommand
 * for commands, onShareEvent for share events (routed by the share's own app). Share events are
 * taken only from the messaging module, so a replayed or client-sent vote can never write a note.
 * Calls to each integration run in order; a failing integration is logged and never affects the others.
 */
export function createIntegrationsModule(opts: IntegrationsModuleOptions): IntegrationsModule {
  const config = opts.config ?? loadIntegrationsConfig();
  const log = opts.logger.child({ module: "integrations" });
  const integrations = buildIntegrations(config, log, opts.now, opts.casepackDir);
  const queues = new Map<string, Promise<void>>(integrations.map((i) => [i.name, Promise.resolve()]));
  const bus = opts.bus;

  const enqueue = (i: Integration, call: () => void | Promise<void>) => {
    const next = queues
      .get(i.name)!
      .then(call)
      .catch((err: unknown) => log.warn({ integration: i.name, err: { name: (err as Error).name, message: (err as Error).message } }, "integration call failed"));
    queues.set(i.name, next);
  };

  const route = (env: BusEnvelope, origin: string) => {
    const targets = (app: AppId | null | undefined) => integrations.filter((i) => !!app && i.apps.includes(app));
    if (env.ch === "state") {
      for (const i of targets(env.state.app)) if (i.onState) enqueue(i, () => i.onState!(env.state));
    } else if (env.ch === "cmd") {
      for (const i of targets(bus.latestState?.app)) if (i.onCommand) enqueue(i, () => i.onCommand!(env.cmd));
    } else if (env.ch === "share" && origin === MESSAGING_ORIGIN) {
      const share = opts.shares.shareInfo(env.ev.shareId);
      for (const i of targets(share?.app ?? bus.latestState?.app)) if (i.onShareEvent) enqueue(i, () => i.onShareEvent!(env.ev, share));
    }
  };

  return {
    name: "integrations",
    config,
    integrations,
    get: <T extends Integration>(name: string) => integrations.find((i) => i.name === name) as T | undefined,

    async start() {
      for (const i of integrations) await i.start();
      if (integrations.length) bus.subscribe(route);
      log.info({ enabled: integrations.map((i) => `${i.name}:${i.mode}`) }, "integrations started");
    },

    registerRoutes(app: FastifyInstance) {
      app.get("/api/integrations", async () => ({
        integrations: integrations.map((i) => ({ name: i.name, mode: i.mode, apps: i.apps, status: i.status() })),
      }));
      for (const i of integrations) i.registerRoutes?.(app);
    },

    health(): ModuleHealth {
      const down = integrations.flatMap((i) => {
        const s = i.status();
        return s.up ? [] : [`${i.name}: ${s.reason}`];
      });
      if (down.length) return { status: "error", detail: down.join("; ") };
      const enabled = integrations.map((i) => `${i.name} (${i.mode})`).join(", ") || "none (all INTEG_* off)";
      return { status: integrations.some((i) => i.mode === "live") ? "live" : "mock", detail: `Enabled: ${enabled}` };
    },

    async idle() {
      await Promise.all(queues.values());
    },

    async stop() {
      await Promise.allSettled(integrations.map((i) => i.stop?.()));
    },
  };
}
