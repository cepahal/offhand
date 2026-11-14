/**
 * pnpm e2e:live — the NeuroView sequence against the live services, printing PASS or FAIL per step:
 *   1. load the NeuroView case (and its volume into Slicer)
 *   2. "show the finding" moves the view (Converse tool call -> focus_finding -> Slicer camera/slice)
 *   3. "explain it" produces verified text (Converse explainer -> ApplyGuardrail)
 *   4. a Confirm sends the card to the phone (Photon)
 *   5. a vote arrives (Photon poll_option)
 *   6. the vote is written to the clinic inbox
 * Plus the fail-closed test with real ApplyGuardrail results (test/live/fail-closed.live.ts).
 *
 * Runs the real hub modules in this process, with this script as the viewer client. Nothing is
 * mocked: a missing setting or credential makes the steps that need it FAIL, never fall back.
 * Waits E2E_WAIT_S seconds (default 180) for the patient's opt-in and vote.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { emptyViewerState, type BusEnvelope, type CasePackManifest, type ShareEvent, type VerifiedText, type ViewerState } from "@hoverscan/contracts";
import { FileCaseLookup } from "../src/ai/case-lookup.js";
import { loadAiConfig } from "../src/ai/config.js";
import { createAiModule, type AiModule } from "../src/ai/module.js";
import { Bus } from "../src/bus/bus.js";
import { loadConfig, REPO_ROOT, RUN_MODE } from "../src/config.js";
import { ClinicInboxIntegration } from "../src/integrations/clinic-inbox.js";
import { loadIntegrationsConfig } from "../src/integrations/config.js";
import { assertLocalSlicerUrl, HttpSlicerTransport, SlicerIntegration, volumeForState, type SlicerEndpoint, type SlicerMethod } from "../src/integrations/slicer.js";
import { niftiHeader, rasToIndex } from "../src/integrations/slicer-volume.js";
import { checkAwsCredentials, preflight } from "../src/live/preflight.js";
import { createLogger, SessionLog } from "../src/log/logger.js";
import { loadMessagingConfig, maskLine } from "../src/messaging/config.js";
import { createMessagingModule, type MessagingModule } from "../src/messaging/module.js";
import { MESSAGING_ORIGIN } from "../src/messaging/share-flow.js";

const APP = "neuroview" as const;
const CASE_ID = process.env.E2E_CASE ?? "isbi2015-training01";
const WAIT_S = Number(process.env.E2E_WAIT_S ?? 180);
const VIEWER = "ws:e2e-viewer";

type Outcome = { ok: boolean; detail: string };
const results: { name: string; outcome: Outcome }[] = [];
const print = (name: string, o: Outcome) => console.log(`${o.ok ? "PASS" : "FAIL"}  ${name}${o.detail ? ` — ${o.detail}` : ""}`);
function record(name: string, o: Outcome): Outcome {
  results.push({ name, outcome: o });
  print(name, o);
  return o;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined, ms: number, every = 250): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > end) return undefined;
    await sleep(every);
  }
}

if (RUN_MODE !== "live") {
  console.error("e2e:live must run with HOVERSCAN_RUN=live (use `pnpm e2e:live`).");
  process.exit(2);
}

console.log(`HoverScan e2e:live — case ${APP}/${CASE_ID}\n`);

// ---- preflight ---------------------------------------------------------------------------
const pre = preflight();
console.log(`Active Photon transport: ${pre.transport ?? "none (invalid PHOTON_TRANSPORT)"}`);
for (const f of pre.facts) console.log(`  ${f}`);
record("preflight: every live setting present", { ok: pre.ok, detail: pre.ok ? "" : `missing ${pre.missing.join("; ")}` });
const aiCfg = loadAiConfig();
const aws = await checkAwsCredentials(aiCfg.region);
record("preflight: AWS credentials in the standard chain", aws.ok ? { ok: true, detail: `access key ${aws.accessKeyHint}` } : { ok: false, detail: aws.reason });

// ---- live modules ------------------------------------------------------------------------
const cfg = loadConfig();
const logger = createLogger({ level: process.env.LOG_LEVEL ?? "warn" });
const session = new SessionLog(cfg.logDir);
const bus = new Bus(session);
const seen: { env: BusEnvelope; origin: string }[] = [];
bus.subscribe((env, origin) => seen.push({ env, origin }));
const cases = new FileCaseLookup(cfg.casepackDir, logger);

let ai: AiModule | undefined;
let aiError = "";
try {
  ai = createAiModule({ logger, bus });
  await ai.start();
} catch (err) {
  aiError = (err as Error).message;
  ai = undefined;
}

let messaging: MessagingModule | undefined;
let messagingError = "";
try {
  const mcfg = loadMessagingConfig();
  messaging = createMessagingModule({ logger, bus, casepackDir: cfg.casepackDir, snapshotDir: cfg.snapshotDir, config: mcfg, announce: (l) => console.log(`  ${l}`) });
  await messaging.start();
  const s = messaging.channel()?.status();
  if (s && !s.up) messagingError = s.reason;
} catch (err) {
  messagingError = (err as Error).message;
}
record("preflight: Photon connected", messagingError ? { ok: false, detail: messagingError } : { ok: true, detail: messaging?.health().detail ?? "" });

const integ = loadIntegrationsConfig();
const slicerCalls: { method: SlicerMethod; endpoint: SlicerEndpoint; params: Record<string, string>; ok: boolean; error?: string }[] = [];
const http = new HttpSlicerTransport(assertLocalSlicerUrl(integ.slicer.url));
const slicer = new SlicerIntegration(
  "live",
  integ.slicer.apps,
  {
    async request(method, endpoint, params) {
      try {
        const r = await http.request(method, endpoint, params);
        slicerCalls.push({ method, endpoint, params, ok: true });
        return r;
      } catch (err) {
        slicerCalls.push({ method, endpoint, params, ok: false, error: (err as Error).message });
        throw err;
      }
    },
  },
  integ.slicer.sliceMaxIndex,
  logger,
  { cases, casepackDir: cfg.casepackDir },
);
const inbox = new ClinicInboxIntegration("live", integ.clinicinbox.apps, integ.clinicinbox.file, logger);
await inbox.start();
let slicerQueue: Promise<void> = Promise.resolve();
bus.subscribe((env, origin) => {
  if (env.ch === "state" && env.state.app === APP) slicerQueue = slicerQueue.then(() => slicer.onState(env.state)).catch(() => undefined);
  if (env.ch === "share" && origin === MESSAGING_ORIGIN) inbox.onShareEvent(env.ev, messaging?.shareInfo(env.ev.shareId));
});

// ---- the viewer (this script) ------------------------------------------------------------
let view: ViewerState = emptyViewerState();
const publishState = (patch: Partial<ViewerState>) => {
  view = { ...view, ...patch };
  bus.publish({ ch: "state", state: view }, VIEWER);
};
const say = (text: string) => bus.publish({ ch: "voice", ev: { kind: "transcript", text } }, VIEWER);
const cmd = (body: Record<string, unknown>) =>
  bus.publish({ ch: "cmd", cmd: { id: randomUUID(), ts: Date.now(), source: "mouse", ...body } as never }, VIEWER);
const since = (n: number) => seen.slice(n);
const ofCh = <C extends BusEnvelope["ch"]>(xs: typeof seen, ch: C) => xs.flatMap((x) => (x.env.ch === ch ? [{ ...x, env: x.env as Extract<BusEnvelope, { ch: C }> }] : []));

let manifest: CasePackManifest | undefined;
let header: Awaited<ReturnType<typeof niftiHeader>> | undefined;

/** What the browser viewer does on focus_finding: aim the camera at the finding and slice through it. */
function moveViewTo(findingId: string): void {
  const f = manifest?.findings.find((x) => x.id === findingId);
  if (!f || !header) return;
  const target: [number, number, number] = [-f.center[0], f.center[2], f.center[1]];
  const idx = rasToIndex(header, f.center);
  publishState({
    focusedFindingId: f.id,
    camera: { position: [target[0], target[1], target[2] + 250], target, up: [0, 1, 0] },
    slice: { plane: "axial", index: idx[2] },
  });
}
bus.subscribe((env, origin) => {
  if (env.ch === "cmd" && origin === "ai" && env.cmd.type === "focus_finding") moveViewTo(env.cmd.findingId);
});

// ---- 1. load the case --------------------------------------------------------------------
{
  manifest = await cases.getCase(APP, CASE_ID);
  if (!manifest) {
    record("1. load the NeuroView case", { ok: false, detail: `casepacks/${APP}/${CASE_ID} is missing or invalid (run pnpm build:neuroview)` });
  } else {
    const ordered = [...(manifest.timepoints ?? [])].sort((a, b) => a.order - b.order);
    const timepoint = Math.max(0, ordered.findIndex((t) => manifest!.findings.filter((f) => f.timepointId === t.id).length === 1));
    const vol = volumeForState(manifest, timepoint);
    header = vol ? await niftiHeader(join(cfg.casepackDir, APP, CASE_ID, vol.file)) : undefined;
    publishState({
      app: APP,
      caseId: CASE_ID,
      timepoint,
      camera: { position: [0, 0, 400], target: [0, 0, 0], up: [0, 1, 0] },
      layers: manifest.layers.map((l) => ({ id: l.id, opacity: l.defaultOpacity, visible: true })),
      slice: { plane: "axial", index: header ? Math.floor(header.dims[2] / 2) : 0 },
    });
    await slicerQueue;
    const loaded = slicerCalls.find((c) => c.method === "POST" && c.endpoint === "/slicer/mrml/file");
    const tpLabel = ordered[timepoint]?.label ?? "?";
    record(
      "1. load the NeuroView case",
      loaded?.ok
        ? { ok: true, detail: `${manifest.title}; ${manifest.findings.length} findings; ${tpLabel} on screen; Slicer loaded ${slicer.loadedVolume()}` }
        : { ok: false, detail: `case loaded, but Slicer did not load the volume: ${loaded?.error ?? slicer.status().up ? "no request" : (slicer.status() as { reason: string }).reason}` },
    );
  }
}

// ---- 2. "show the finding" ---------------------------------------------------------------
{
  const name = '2. "show the finding" moves the view';
  if (!ai) record(name, { ok: false, detail: `AI is not live: ${aiError}` });
  else if (!manifest) record(name, { ok: false, detail: "no case" });
  else {
    const mark = seen.length;
    const callsBefore = slicerCalls.length;
    say("show the finding");
    await ai.idle();
    const focus = ofCh(since(mark), "cmd").find((x) => x.origin === "ai" && x.env.cmd.type === "focus_finding");
    const reply = ofCh(since(mark), "voice").find((x) => x.origin === "ai" && (x.env.ev.kind === "transcript" || x.env.ev.kind === "error"));
    await slicerQueue;
    await sleep(300);
    await slicerQueue;
    const moved = slicerCalls.slice(callsBefore).filter((c) => c.method === "GET");
    if (!focus) record(name, { ok: false, detail: `no focus_finding command; voice said: ${reply?.env.ev.text ?? "(nothing)"}` });
    else {
      const id = (focus.env.cmd as { findingId: string }).findingId;
      const bad = moved.filter((c) => !c.ok);
      record(name, {
        ok: view.focusedFindingId === id && moved.length > 0 && bad.length === 0,
        detail: `focus_finding ${id}; Slicer: ${moved.map((c) => `${c.endpoint}?${new URLSearchParams(c.params)}${c.ok ? "" : ` (${c.error})`}`).join(", ") || "no update"}`,
      });
    }
  }
}

// ---- 3. "explain it" ---------------------------------------------------------------------
let verified: VerifiedText | undefined;
{
  const name = '3. "explain it" produces verified text';
  if (!ai) record(name, { ok: false, detail: `AI is not live: ${aiError}` });
  else {
    const mark = seen.length;
    say("explain it");
    await ai.idle();
    await ai.idle();
    const vt = ofCh(since(mark), "verified").find((x) => x.origin === "ai")?.env.ev;
    const reply = ofCh(since(mark), "voice").find((x) => x.origin === "ai" && x.env.ev.kind !== "tool");
    verified = vt;
    if (!vt) record(name, { ok: false, detail: `no VerifiedText; voice said: ${reply?.env.ev.text ?? "(nothing)"}` });
    else
      record(name, {
        ok: vt.status === "verified" && vt.checker === "live",
        detail: `${vt.status} (${vt.findings.map((f) => f.type).join(", ")}): "${vt.text.slice(0, 160)}${vt.text.length > 160 ? "…" : ""}"`,
      });
  }
}

// ---- 4. Confirm sends the card -------------------------------------------------------------
let shareId: string | undefined;
{
  const name = "4. a Confirm sends the card to the phone";
  if (!messaging || messagingError) record(name, { ok: false, detail: `Photon is not connected: ${messagingError}` });
  else {
    let recipient = messaging.registry.active();
    if (!recipient && verified?.status !== "verified") {
      console.log("  not waiting for an opt-in: there is no verified text to send (the share request below must be refused)");
    } else if (!recipient) {
      const line = maskLine(loadMessagingConfig().line);
      console.log(`  waiting up to ${WAIT_S}s for an opt-in: text ${messaging.config.optInKeyword} to the line ending ${line}`);
      recipient = await until(() => messaging!.registry.active(), WAIT_S * 1000, 1000);
    }
    const mark = seen.length;
    cmd({ type: "share_to_patient", bookmarkIds: [] });
    await messaging.idle();
    const confirmFor = bus.latestState?.pending.confirmFor;
    if (confirmFor) {
      cmd({ type: "confirm", for: confirmFor });
      await messaging.idle();
    }
    const events = ofCh(since(mark), "share").map((x) => x.env.ev);
    const sent = events.find((e) => e.kind === "sent");
    const refused = events.find((e) => e.kind === "error");
    shareId = sent?.shareId;
    record(
      name,
      sent
        ? { ok: true, detail: `sent share ${sent.shareId} to ${recipient?.ref}` }
        : { ok: false, detail: `${refused?.detail ?? "nothing sent"}${verified && verified.status !== "verified" ? " (fail-closed: the text was not verified)" : ""}` },
    );
  }
}

// ---- 5. a vote arrives -------------------------------------------------------------------
let vote: ShareEvent | undefined;
{
  const name = "5. a vote arrives";
  if (!shareId || !messaging) record(name, { ok: false, detail: "no card was sent" });
  else {
    console.log(`  waiting up to ${WAIT_S}s for the patient to tap a poll option on the phone`);
    vote = await until(
      () => ofCh(seen, "share").find((x) => x.origin === MESSAGING_ORIGIN && x.env.ev.kind === "vote" && x.env.ev.shareId === shareId)?.env.ev,
      WAIT_S * 1000,
      500,
    );
    record(name, vote ? { ok: true, detail: `option ${vote.optionId} (${vote.selected === false ? "unselected" : "selected"})` } : { ok: false, detail: `no vote within ${WAIT_S}s` });
  }
}

// ---- 6. the vote is in the clinic inbox ----------------------------------------------------
{
  const name = "6. the vote is written to the clinic inbox";
  if (!vote) record(name, { ok: false, detail: "no vote" });
  else {
    const entry = await until(() => inbox.entries().find((e) => e.shareId === shareId && e.optionId === vote!.optionId), 3000);
    record(name, entry ? { ok: true, detail: `${integ.clinicinbox.file.replace(`${REPO_ROOT}/`, "")}: ${JSON.stringify(entry)}` } : { ok: false, detail: "no matching line" });
  }
}

await Promise.resolve(messaging?.stop()).catch(() => undefined);
await slicer.stop().catch(() => undefined);
await session.close();

// ---- fail-closed test, real ApplyGuardrail ---------------------------------------------------
{
  console.log("\nFail-closed test with real ApplyGuardrail results (10 rulebook sentences):");
  const r = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.live.config.ts", "--reporter", "default"], {
    cwd: join(REPO_ROOT, "apps", "hub"),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: process.env,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const notRun = /NOT RUN: [^\n]*/.exec(out)?.[0];
  record("fail-closed: no false sentence reaches a sent event", r.status === 0 ? { ok: true, detail: "10 sentences checked live" } : { ok: false, detail: notRun ?? "see pnpm --filter @offhand/hub test:live" });
}

const failed = results.filter((r) => !r.outcome.ok);
console.log(`\n${failed.length === 0 ? "PASS" : "FAIL"}: ${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
