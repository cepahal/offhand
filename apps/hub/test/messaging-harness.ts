import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BusEnvelope, ShareEvent, ViewerCommand, ViewerCommandBody, ViewerState } from "@hoverscan/contracts";
import Fastify from "fastify";
import { FileCaseLookup } from "../src/ai/case-lookup.js";
import type { ClaimChecker } from "../src/ai/claim-checker.js";
import type { Explainer } from "../src/ai/explainer.js";
import type { FixturesFile } from "../src/ai/mock-claim-checker.js";
import { createAiModule } from "../src/ai/module.js";
import { Bus } from "../src/bus/bus.js";
import { SessionLog } from "../src/log/logger.js";
import type { MessagingConfig } from "../src/messaging/config.js";
import { MockPatientChannel } from "../src/messaging/mock-channel.js";
import { createMessagingModule } from "../src/messaging/module.js";
import type { PhotonSdk } from "../src/messaging/spectrum-sdk.js";
import { loadIntegrationsConfig } from "../src/integrations/config.js";
import { createIntegrationsModule, type IntegrationsModule } from "../src/integrations/module.js";
import { writeAiTree } from "./ai-fixtures.js";
import { aiConfig, memoryLogger, messagingConfig, state, tempDir, viewSnapshot } from "./helpers.js";

export const SNAPSHOT_URL = `/snapshots/${randomUUID()}.png`;
/** Origin of the clinician's viewer, as the hub's WebSocket handler records it. */
export const VIEWER = "ws:viewer01";

export interface HarnessOptions {
  findings?: number;
  fixtures?: FixturesFile | string | null;
  messaging?: Partial<MessagingConfig>;
  explainer?: Explainer;
  /** Replaces the fixture checker, e.g. with the live Automated Reasoning checker. */
  checker?: ClaimChecker;
  /** With messaging.mode "live": the fake spectrum-ts the Photon channel runs on. */
  photonSdk?: PhotonSdk;
  photonBackoffMs?: readonly number[];
  /** Turns on the clinic inbox (mock mode) for the harness case's app, writing to this file. */
  clinicInboxFile?: string;
}

/** The real AI and messaging modules on one bus, with their routes on a Fastify instance. */
export async function harness(opts: HarnessOptions = {}) {
  const tree = writeAiTree({ findings: opts.findings ?? 1, fixtures: opts.fixtures });
  const { logger, lines } = memoryLogger("debug");
  const session = new SessionLog(tempDir("hoverscan-session-"));
  const bus = new Bus(session);
  const ai = createAiModule({
    logger,
    bus,
    config: aiConfig({ casepackDir: tree.casepackDir, policiesDir: tree.policiesDir }),
    deps: { ...(opts.explainer ? { explainer: opts.explainer } : {}), ...(opts.checker ? { checker: opts.checker } : {}) },
  });
  const snapshotDir = tempDir("hoverscan-snap-");
  const messaging = createMessagingModule({
    logger,
    bus,
    casepackDir: tree.casepackDir,
    config: messagingConfig({ ...opts.messaging }),
    snapshotDir,
    cases: new FileCaseLookup(tree.casepackDir, logger),
    ...(opts.photonSdk ? { photonSdk: opts.photonSdk, photonDeliveredPoll: { everyMs: 0, forMs: 0 } } : {}),
    ...(opts.photonBackoffMs ? { photonBackoffMs: opts.photonBackoffMs } : {}),
  });
  let integrations: IntegrationsModule | undefined;
  if (opts.clinicInboxFile) {
    const base = loadIntegrationsConfig({ env: { INTEG_CLINIC_INBOX: "mock", INTEG_CLINIC_INBOX_FILE: opts.clinicInboxFile } });
    const config = { ...base, clinicinbox: { ...base.clinicinbox, apps: [state().app!] } };
    integrations = createIntegrationsModule({ logger, bus, config, shares: messaging });
  }
  const app = Fastify();
  messaging.registerRoutes!(app);
  integrations?.registerRoutes!(app);
  await ai.start();
  await messaging.start();
  await integrations?.start();
  await app.ready();

  let sessionClosed: Promise<void> | undefined;
  const closeSession = () => (sessionClosed ??= session.close());

  const seen: BusEnvelope[] = [];
  bus.subscribe((env) => seen.push(env));
  const channel = messaging.channel() as MockPatientChannel;

  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await ai.idle();
      await messaging.idle();
      await integrations?.idle();
    }
  };

  const h = {
    tree,
    bus,
    ai,
    messaging,
    integrations,
    channel,
    app,
    lines,
    seen,
    session,
    settle,
    setState(overrides: Partial<ViewerState> = {}) {
      bus.publish(
        {
          ch: "state",
          state: state({
            bookmarks: [{ id: "b1", label: "View 1", snapshotUrl: SNAPSHOT_URL, state: viewSnapshot() }],
            ...overrides,
          }),
        },
        VIEWER,
      );
    },
    async cmd(body: ViewerCommandBody, from = VIEWER) {
      bus.publish({ ch: "cmd", cmd: { id: randomUUID(), ts: Date.now(), source: "keyboard", ...body } as ViewerCommand }, from);
      await settle();
    },
    async optIn() {
      const res = await app.inject({ method: "POST", url: "/api/messaging/mock/inbound", payload: { content: { type: "text", text: "HOVERSCAN" } } });
      if (res.statusCode !== 202) throw new Error(`opt-in failed: ${res.body}`);
    },
    async explain(findingId?: string) {
      await h.cmd(findingId ? { type: "explain", findingId } : { type: "explain" });
    },
    confirmFor: () => bus.latestState?.pending.confirmFor,
    async confirm(forId = bus.latestState?.pending.confirmFor ?? "share:none") {
      await h.cmd({ type: "confirm", for: forId });
    },
    shareEvents: (): ShareEvent[] => seen.flatMap((e) => (e.ch === "share" ? [e.ev] : [])),
    errors: () => h.shareEvents().filter((e) => e.kind === "error").map((e) => e.detail ?? ""),
    sentEvents: () => h.shareEvents().filter((e) => e.kind === "sent"),
    /** Every log line, bus envelope and session-file line produced so far. */
    async allOutput(): Promise<string[]> {
      await closeSession();
      return [...lines, ...seen.map((e) => JSON.stringify(e)), ...readFileSync(session.path, "utf8").split("\n")];
    },
    async close() {
      await app.close();
      await messaging.stop();
      await closeSession();
    },
  };
  return h;
}

export type Harness = Awaited<ReturnType<typeof harness>>;
