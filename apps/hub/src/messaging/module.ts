import type { ShareEvent } from "@hoverscan/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FileCaseLookup, type CaseLookup } from "../ai/case-lookup.js";
import type { Bus } from "../bus/bus.js";
import type { ShareContext } from "../integrations/integration.js";
import type { Logger } from "../log/logger.js";
import type { HubModule, ModuleHealth } from "../modules.js";
import { assertLiveReady, loadMessagingConfig, maskLine, type MessagingConfig } from "./config.js";
import { DemoRoleBook } from "./demo-role-book.js";
import { CLINICIAN_APPROVAL_POLICY, SIDE_EFFECT_OPTIONS, releaseMessage, type DemoRole } from "./demo-messages.js";
import { InboundRouter, ShareLedger } from "./inbound.js";
import { MockPatientChannel } from "./mock-channel.js";
import type { PatientChannel } from "./patient-channel.js";
import { phonePageHtml, sharePageHtml } from "./phone-page.js";
import { PhotonChannel, POLL_TITLE, RECONNECTING } from "./photon-channel.js";
import type { PhotonSdk } from "./spectrum-sdk.js";
import { RecipientRegistry } from "./recipients.js";
import { MESSAGING_ORIGIN, ShareFlow } from "./share-flow.js";

/** What the simulated phone may post: the Spectrum text and poll_option shapes. */
const SimulatedInbound = z.object({
  content: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string().min(1).max(160) }),
    z.object({
      type: z.literal("poll_option"),
      option: z.object({ title: z.string().min(1).max(120), optionIdentifier: z.string().min(1).max(128).optional() }),
      pollMessageGuid: z.string().min(1).max(200),
      selected: z.boolean(),
    }),
  ]),
});

export interface MessagingModuleOptions {
  logger: Logger;
  bus: Bus;
  /** Case packs, for the poll options of the loaded case. */
  casepackDir: string;
  config?: MessagingConfig;
  /** Where POST /api/snapshots stores PNGs. */
  snapshotDir: string;
  cases?: CaseLookup;
  /** Replaces the mode-selected channel (tests). Receives the shared registry, ledger and router. */
  channel?: (parts: { registry: RecipientRegistry; ledger: ShareLedger; router: InboundRouter }) => PatientChannel;
  /** Live mode: replaces the installed spectrum-ts (tests). */
  photonSdk?: PhotonSdk;
  photonBackoffMs?: readonly number[];
  photonDeliveredPoll?: { everyMs: number; forMs: number };
  /** Also receives the Photon startup line (start:live prints it to stdout). */
  announce?: (line: string) => void;
  now?: () => number;
}

export type MessagingModule = HubModule & {
  readonly config: MessagingConfig;
  readonly registry: RecipientRegistry;
  channel(): PatientChannel | undefined;
  flow(): ShareFlow | undefined;
  /** Share lookup for the integrations module; never exposes a phone number. */
  shareInfo(shareId: string): ShareContext | undefined;
  /** Resolves when queued bus input has been handled (tests). */
  idle(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Patient messaging. Mock by default; PHOTON_MODE=live uses Photon Spectrum and refuses to
 * construct without PHOTON_PROJECT_ID and PHOTON_API_KEY. Bus input is handled strictly in order.
 */
export function createMessagingModule(opts: MessagingModuleOptions): MessagingModule {
  const config = opts.config ?? loadMessagingConfig();
  assertLiveReady(config);
  const log = opts.logger.child({ module: "messaging" });
  const now = opts.now ?? Date.now;
  const registry = new RecipientRegistry(config.recipientsFile, { optIn: config.optInKeyword, optOut: config.optOutKeyword }, now);
  const demoRoles = new DemoRoleBook(config.recipientsFile, () => new Date(now()).toISOString());
  const ledger = new ShareLedger();
  const bus = opts.bus;
  let channel: PatientChannel | undefined;
  let flow: ShareFlow | undefined;
  let queue: Promise<void> = Promise.resolve();
  let lastStatusUp = true;
  let stopping = false;

  const publish = (ev: ShareEvent) => {
    if (!bus.publish({ ch: "share", ev }, MESSAGING_ORIGIN).ok) log.warn({ kind: ev.kind }, "dropped an invalid ShareEvent");
  };
  const router = new InboundRouter({
    registry,
    ledger,
    emit: publish,
    logger: log,
    now,
    onText: (handle, text) => {
      demoRoles.ingest(handle, text);
    },
    onOptIn: (o) =>
      bus.publish({ ch: "log", level: "info", module: "messaging", msg: `Patient ${o.ref} ${o.kind === "opted_in" ? "opted in" : "opted out"}.` }, MESSAGING_ORIGIN),
  });

  /** Puts a channel outage on the timeline once per transition. */
  let lastReason: string | undefined;
  const watchStatus = () => {
    const s = channel?.status();
    if (!s || stopping) return;
    const reason = s.up ? undefined : s.reason;
    if (s.up === lastStatusUp && reason === lastReason) return;
    const wasUp = lastStatusUp;
    lastStatusUp = s.up;
    lastReason = reason;
    let msg: string;
    if (s.up) msg = wasUp ? "" : "messaging: connected";
    else if (s.reason === RECONNECTING) msg = "messaging: reconnecting";
    else msg = `messaging: unavailable (${s.reason})`;
    if (msg) bus.publish({ ch: "log", level: s.up ? "info" : s.reason === RECONNECTING ? "warn" : "error", module: "messaging", msg }, MESSAGING_ORIGIN);
  };

  return {
    name: "messaging",
    config,
    registry,
    channel: () => channel,
    flow: () => flow,
    shareInfo: (shareId: string) => flow?.shareInfo(shareId),

    async start() {
      const parts = { registry, ledger, router };
      if (opts.channel) channel = opts.channel(parts);
      else if (config.mode === "live") {
        channel = new PhotonChannel(config, {
          ...parts,
          logger: log,
          snapshotDir: opts.snapshotDir,
          resolveHandle: (ref) => demoRoles.handleFor(ref),
          now,
          ...(opts.photonSdk ? { sdk: opts.photonSdk } : {}),
          ...(opts.photonBackoffMs ? { backoffMs: opts.photonBackoffMs } : {}),
          deliveredPoll: opts.photonDeliveredPoll ?? { everyMs: 3_000, forMs: 60_000 },
          announce: (line) => {
            log.info(line);
            opts.announce?.(line);
          },
        });
      } else {
        channel = new MockPatientChannel({ ...parts, mockRead: config.mockRead, now });
      }
      channel.onEvent(publish);
      channel.onStatusChange?.(() => watchStatus());
      try {
        await channel.start();
      } catch (err) {
        log.error({ err: { name: (err as Error).name } }, "messaging channel failed to start; shares will be refused");
      }
      watchStatus();

      flow = new ShareFlow({
        bus,
        channel,
        registry,
        cases: opts.cases ?? new FileCaseLookup(opts.casepackDir, log),
        logger: log,
        pendingTtlMs: config.pendingTtlMs,
        optInKeyword: config.optInKeyword,
        now,
      });
      const f = flow;
      bus.subscribe((env, origin) => {
        if (env.ch !== "cmd" && env.ch !== "verified") return;
        queue = queue
          .then(() => f.handle(env, origin))
          .catch((err: unknown) => log.error({ err: { name: (err as Error).name } }, "share flow failed"))
          .finally(watchStatus);
      });
      log.info({ mode: config.mode, channel: channel.kind }, "messaging module started");
    },

    registerRoutes(app: FastifyInstance) {
      // Raw bytes: the Spectrum signature is computed over the exact body, so it must not be re-encoded.
      void app.register(async (scope) => {
        scope.removeAllContentTypeParsers();
        scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
        scope.post("/webhooks/photon", async (req, reply) => {
          if (!(channel instanceof PhotonChannel)) return reply.code(404).send({ error: "not configured: PHOTON_MODE=live with PHOTON_TRANSPORT=webhook" });
          const headers = Object.fromEntries(
            Object.entries(req.headers).flatMap(([k, v]) => (typeof v === "string" ? [[k.toLowerCase(), v]] : Array.isArray(v) ? [[k.toLowerCase(), v.join(",")]] : [])),
          );
          const body = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
          const res = await channel.handleWebhook({ body, headers });
          return reply.code(res.status).headers(res.headers).send(Buffer.from(res.body));
        });
      });

      app.get<{ Params: { shareId: string } }>("/share/:shareId", async (req, reply) => {
        const text = channel instanceof PhotonChannel ? channel.sharedText(req.params.shareId) : undefined;
        if (text === undefined) return reply.code(404).type("text/plain; charset=utf-8").send("Not found.");
        return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(sharePageHtml(text));
      });

      app.get("/phone", async (_req, reply) => {
        if (!(channel instanceof MockPatientChannel)) return reply.code(404).send({ error: "the simulated phone exists only in PHOTON_MODE=mock" });
        return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(phonePageHtml());
      });

      app.get("/api/messaging/mock/inbox", async (_req, reply) => {
        if (!(channel instanceof MockPatientChannel)) return reply.code(404).send({ error: "mock only" });
        const { optedIn, messages } = channel.inbox();
        return {
          optedIn,
          keyword: config.optInKeyword,
          messages: messages.map((m) => ({
            shareId: m.shareId,
            text: m.updates.at(-1)?.verified?.text ?? m.request.verified.text,
            snapshots: m.request.bookmarks.map((b) => ({ url: b.snapshotUrl, label: b.label })),
            poll: { guid: m.pollGuid, title: POLL_TITLE, options: m.request.pollOptions },
            sentAt: m.sentAt,
          })),
        };
      });

      app.get("/api/demo/messaging", async () => ({
        mode: config.mode,
        lineLast4: maskLine(config.line),
        roles: demoRoles.state.roles.map((role) => ({ ref: role.ref, role: role.role, last4: role.last4 })),
      }));

      const DemoSend = z.object({
        shareId: z.uuid(),
        role: z.enum(["hospital", "patient"]),
        text: z.string().min(1).max(1000),
        confirmed: z.literal(true),
        clinicianApproved: z.boolean(),
      });
      app.post("/api/demo/messaging/send", { bodyLimit: 16 * 1024 }, async (req, reply) => {
        const parsed = DemoSend.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid demonstration message" });
        const role = parsed.data.role as DemoRole;
        const planned = releaseMessage(demoRoles.state, {
          shareId: parsed.data.shareId,
          role,
          text: parsed.data.text,
          confirmed: parsed.data.confirmed,
          clinicianApproved: parsed.data.clinicianApproved,
          mode: config.mode === "live" ? "live" : "simulated",
          now: new Date(now()).toISOString(),
        });
        if (!planned.ok) return reply.code(409).send({ error: planned.reason });
        demoRoles.state = planned.state;
        if (planned.transport !== "photon" || !(channel instanceof PhotonChannel)) {
          return { transport: "simulated" as const, error: config.mode === "live" ? "not configured" : undefined };
        }
        try {
          await channel.send({
            shareId: parsed.data.shareId,
            recipientRef: planned.state.events.find((event) => event.shareId === parsed.data.shareId)?.recipientRef ?? "",
            bookmarks: [],
            verified: {
              text: parsed.data.text,
              status: "verified",
              findings: [],
              policyId: CLINICIAN_APPROVAL_POLICY,
              checkedAt: new Date(now()).toISOString(),
              checker: "mock",
            },
            pollOptions: role === "patient" ? SIDE_EFFECT_OPTIONS.map((label) => ({ id: label.toLowerCase().replace(/\s+/g, "-"), label })) : [],
          });
          return { transport: "photon" as const };
        } catch (err) {
          log.warn({ shareId: parsed.data.shareId, err: { name: (err as Error).name } }, "demonstration send refused");
          return reply.code(503).send({ error: "not configured" });
        }
      });

      app.post("/api/messaging/mock/inbound", { bodyLimit: 16 * 1024 }, async (req, reply) => {
        if (!(channel instanceof MockPatientChannel)) return reply.code(404).send({ error: "mock only" });
        const parsed = SimulatedInbound.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid simulated message" });
        const outcome = channel.inbound(parsed.data.content);
        return reply.code(202).send({ accepted: true, optIn: outcome?.kind ?? null });
      });
    },

    health(): ModuleHealth {
      const s = channel?.status();
      if (s && !s.up) return { status: "error", detail: `Messaging is down: ${s.reason}. Shares are refused.` };
      return config.mode === "live"
        ? { status: "live", detail: `Photon (${config.transport}), line ${maskLine(config.line)}` }
        : { status: "mock", detail: "Simulated phone at /phone." };
    },

    idle: () => queue,

    async stop() {
      stopping = true;
      flow?.close();
      await channel?.stop();
    },
  };
}
