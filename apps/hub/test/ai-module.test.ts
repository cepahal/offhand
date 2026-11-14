import { writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import type { BusEnvelope } from "@hoverscan/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertLiveReady, loadAiConfig } from "../src/ai/config.js";
import { createAiModule, type AiModule } from "../src/ai/module.js";
import { UNMATCHED_REPLY } from "../src/ai/voice-agent.js";
import { Bus } from "../src/bus/bus.js";
import { EXCERPT_OK, writeAiTree } from "./ai-fixtures.js";
import { aiConfig, memoryLogger, state, tempDir } from "./helpers.js";

let bus: Bus;
let mod: AiModule;
let seen: BusEnvelope[];
let network: string[];

async function setup(tree = writeAiTree(), focusedFindingId?: string) {
  const { logger } = memoryLogger("warn");
  bus = new Bus();
  mod = createAiModule({ logger, bus, config: aiConfig({ casepackDir: tree.casepackDir, policiesDir: tree.policiesDir }) });
  await mod.start();
  seen = [];
  bus.subscribe((env) => seen.push(env));
  bus.publish({ ch: "state", state: state(focusedFindingId ? { focusedFindingId } : {}) }, VIEWER);
}

const VIEWER = "ws:viewer01";

async function say(text: string, from = VIEWER) {
  bus.publish({ ch: "voice", ev: { kind: "transcript", text } }, from);
  await mod.idle();
  return seen.filter((e) => e.ch !== "state");
}

beforeEach(() => {
  network = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    network.push(`fetch ${String(input)}`);
    throw new Error("network blocked in tests");
  });
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (this: net.Socket) {
    network.push("socket connect");
    throw new Error("network blocked in tests");
  });
});

afterEach(() => {
  expect(network).toEqual([]);
  vi.restoreAllMocks();
});

describe("ai module (mock mode, no network)", () => {
  it("reports mock health", async () => {
    await setup();
    expect(mod.health()).toMatchObject({ status: "mock" });
  });

  it("voice -> focus + explain -> verified envelope", async () => {
    await setup();
    const out = await say("show me the finding and explain it");
    expect(out.filter((e) => e.ch === "cmd").map((e) => e.cmd.type)).toEqual(["focus_finding", "explain"]);
    expect(out.filter((e) => e.ch === "voice" && e.ev.kind !== "transcript")).toEqual([
      { ch: "voice", ev: { kind: "tool", tool: "focus_finding" } },
      { ch: "voice", ev: { kind: "tool", tool: "explain" } },
    ]);
    const verified = out.filter((e) => e.ch === "verified");
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({ ev: { text: EXCERPT_OK, status: "verified", checker: "mock" } });
  });

  it("a blocked result is published with its reason as a voice error", async () => {
    await setup(writeAiTree({ findings: 2 }), "f2");
    const out = await say("explain it");
    expect(out.find((e) => e.ch === "verified")).toMatchObject({ ev: { status: "blocked" } });
    expect(out.find((e) => e.ch === "voice" && e.ev.kind === "error")).toEqual({
      ch: "voice",
      ev: { kind: "error", text: "Blocked. INVALID: Contradicts test rule R2." },
    });
  });

  it("missing fixtures: needs_review with the reason on screen", async () => {
    await setup(writeAiTree({ fixtures: null }));
    const out = await say("explain");
    expect(out.find((e) => e.ch === "verified")).toMatchObject({ ev: { status: "needs_review" } });
    expect(out.find((e) => e.ch === "voice" && e.ev.kind === "error")).toMatchObject({ ev: { text: expect.stringContaining("no fixtures loaded") } });
  });

  it("an explain command from the keyboard also runs the flow", async () => {
    await setup();
    bus.publish({ ch: "cmd", cmd: { id: crypto.randomUUID(), ts: Date.now(), source: "keyboard", type: "explain" } }, VIEWER);
    await mod.idle();
    expect(seen.find((e) => e.ch === "verified")).toMatchObject({ ev: { status: "verified" } });
  });

  it("unmatched speech produces no commands", async () => {
    await setup();
    const out = await say("make it purple");
    expect(out.filter((e) => e.ch === "cmd")).toEqual([]);
    expect(out.at(-1)).toEqual({ ch: "voice", ev: { kind: "transcript", text: UNMATCHED_REPLY } });
  });

  it("takes transcripts only from browser clients, never from hub modules", async () => {
    await setup();
    expect(await say("explain it", "messaging")).toHaveLength(1);
    expect(await say("explain it", "gesture")).toHaveLength(2);
    expect(seen.filter((e) => e.ch === "verified" || e.ch === "cmd")).toEqual([]);
  });

  it("reports when no case is loaded", async () => {
    const { logger } = memoryLogger("warn");
    bus = new Bus();
    mod = createAiModule({ logger, bus, config: aiConfig() });
    await mod.start();
    seen = [];
    bus.subscribe((env) => seen.push(env));
    bus.publish({ ch: "cmd", cmd: { id: crypto.randomUUID(), ts: Date.now(), source: "keyboard", type: "explain" } }, VIEWER);
    await mod.idle();
    expect(seen.at(-1)).toEqual({ ch: "voice", ev: { kind: "error", text: "No case is loaded." } });
  });
});

describe("ai config and live gating", () => {
  const emptyConfigDir = () => tempDir("hoverscan-aicfg-");

  it("defaults to mock in us-east-2 from config/ai.json", () => {
    const cfg = loadAiConfig({ env: {} });
    expect(cfg).toMatchObject({ mode: "mock", region: "us-east-2" });
  });

  it("AI_ env vars override the file", () => {
    const dir = emptyConfigDir();
    writeFileSync(join(dir, "ai.json"), JSON.stringify({ mode: "mock", region: "us-west-2", converseModelId: "file-model" }));
    const cfg = loadAiConfig({ configDir: dir, env: { AWS_REGION: "us-east-2", AI_CONVERSE_MODEL_ID: "env-model", AI_GUARDRAIL_ID: "" } });
    expect(cfg).toMatchObject({ region: "us-east-2", converseModelId: "env-model", guardrailId: "" });
  });

  it("AI_MODE=live refuses to start without AI_CONVERSE_MODEL_ID or AI_GUARDRAIL_ID", () => {
    const configDir = emptyConfigDir();
    const live = (env: NodeJS.ProcessEnv) => () => assertLiveReady(loadAiConfig({ configDir, env: { AI_MODE: "live", ...env } }));
    expect(live({})).toThrow(/AI_CONVERSE_MODEL_ID, AI_GUARDRAIL_ID, AI_GUARDRAIL_VERSION/);
    expect(live({ AI_GUARDRAIL_ID: "g", AI_GUARDRAIL_VERSION: "1" })).toThrow(/missing AI_CONVERSE_MODEL_ID$/);
    expect(live({ AI_CONVERSE_MODEL_ID: "m", AI_GUARDRAIL_VERSION: "1" })).toThrow(/missing AI_GUARDRAIL_ID$/);
    expect(live({ AI_CONVERSE_MODEL_ID: "m", AI_GUARDRAIL_ID: "g", AI_GUARDRAIL_VERSION: "1" })).not.toThrow();
  });

  it("the module itself refuses live mode without the ids", () => {
    const { logger } = memoryLogger("warn");
    expect(() => createAiModule({ logger, bus: new Bus(), config: aiConfig({ mode: "live" }) })).toThrow(/refuses to start/);
  });

  it("rejects an unknown AI_MODE", () => {
    expect(() => loadAiConfig({ configDir: emptyConfigDir(), env: { AI_MODE: "yolo" } })).toThrow(/invalid AI config/);
  });
});
