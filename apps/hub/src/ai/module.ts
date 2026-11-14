import type { BusEnvelope, CasePackManifest, ViewerCommand } from "@hoverscan/contracts";
import type { Bus } from "../bus/bus.js";
import { redactPhone, type Logger } from "../log/logger.js";
import type { HubModule, ModuleHealth } from "../modules.js";
import { FileCaseLookup, type CaseLookup } from "./case-lookup.js";
import type { ClaimChecker } from "./claim-checker.js";
import { assertLiveReady, loadAiConfig, type AiConfig } from "./config.js";
import { blockReason, runExplainFlow } from "./explain-flow.js";
import type { Explainer } from "./explainer.js";
import { MockClaimChecker } from "./mock-claim-checker.js";
import { MockExplainer } from "./mock-explainer.js";
import { MockVoiceAgent } from "./mock-voice-agent.js";
import type { VoiceAgent, VoiceContext, VoiceEnvelope } from "./voice-agent.js";

/** Origin recorded for everything this module publishes. */
export const AI_ORIGIN = "ai";

export interface AiDeps {
  voice: VoiceAgent;
  explainer: Explainer;
  checker: ClaimChecker;
  cases: CaseLookup;
}

export interface AiModuleOptions {
  logger: Logger;
  bus: Bus;
  config?: AiConfig;
  /** Replaces the mode-selected implementations (tests). */
  deps?: Partial<AiDeps>;
}

/** Findings of the visit on screen: those tagged with the current timepoint, or all when none are tagged. */
export function findingsOnScreen(m: CasePackManifest, timepoint: number): CasePackManifest["findings"] {
  const ordered = [...(m.timepoints ?? [])].sort((a, b) => a.order - b.order);
  const tp = ordered[timepoint]?.id;
  if (!tp || !m.findings.some((f) => f.timepointId)) return m.findings;
  return m.findings.filter((f) => f.timepointId === tp);
}

/** Voice transcripts are taken only from browser clients (the voice panel), never from hub modules. */
const isClientOrigin = (origin: string) => origin.startsWith("ws:");

export type AiModule = HubModule & {
  readonly config: AiConfig;
  /** Resolves when every in-flight voice and explain task has finished (tests). */
  idle(): Promise<void>;
};

async function liveDeps(cfg: AiConfig, logger: Logger): Promise<Omit<AiDeps, "cases"> & { checkerFailed: () => boolean }> {
  const [{ createBedrockClient }, { ConverseVoiceAgent }, { BedrockExplainer }, { AutomatedReasoningChecker }] = await Promise.all([
    import("./bedrock-client.js"),
    import("./converse-voice-agent.js"),
    import("./bedrock-explainer.js"),
    import("./automated-reasoning-checker.js"),
  ]);
  const client = createBedrockClient(cfg.region);
  const checker = new AutomatedReasoningChecker(cfg, logger, client);
  return {
    voice: new ConverseVoiceAgent(cfg, logger, client),
    explainer: new BedrockExplainer(cfg, client),
    checker,
    checkerFailed: () => checker.lastCallFailed,
  };
}

/**
 * Listens for voice transcripts (from browser clients) and explain commands (from anyone),
 * and publishes commands, voice replies and VerifiedText.
 * In live mode it refuses to construct without the model and guardrail settings.
 */
export function createAiModule({ logger, bus, config = loadAiConfig(), deps = {} }: AiModuleOptions): AiModule {
  assertLiveReady(config);
  const log = logger.child({ module: "ai" });
  let active: AiDeps | undefined;
  let checkerFailed = () => false;
  let startFailed = false;
  let explainSeq = 0;
  const inflight = new Set<Promise<void>>();

  /** Runs after the triggering envelope has reached clients, so replies never arrive before it. */
  const track = (task: () => Promise<void>) => {
    const p = Promise.resolve().then(task);
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  };

  const publishVoice = (ev: VoiceEnvelope["ev"]) => bus.publish({ ch: "voice", ev }, AI_ORIGIN);

  async function voiceContext(d: AiDeps): Promise<VoiceContext> {
    const state = bus.latestState;
    if (!state) return {};
    const manifest = state.app && state.caseId ? await d.cases.getCase(state.app, state.caseId) : undefined;
    return { state, findings: (manifest ? findingsOnScreen(manifest, state.timepoint) : []).map((f) => ({ id: f.id, label: f.label })) };
  }

  async function onTranscript(d: AiDeps, text: string): Promise<void> {
    try {
      const result = await d.voice.handle(text, await voiceContext(d));
      for (const cmd of result.commands) bus.publish({ ch: "cmd", cmd }, AI_ORIGIN);
      for (const env of result.envelopes) bus.publish(env, AI_ORIGIN);
    } catch (err) {
      log.warn({ err: { name: (err as Error).name, message: redactPhone((err as Error).message) } }, "voice agent failed");
      publishVoice({ kind: "error", text: "Voice control is unavailable. Use the keyboard or the puck." });
    }
  }

  async function onExplain(d: AiDeps, cmd: Extract<ViewerCommand, { type: "explain" }>): Promise<void> {
    const seq = ++explainSeq;
    const state = bus.latestState;
    if (!state?.app || !state.caseId) {
      publishVoice({ kind: "error", text: "No case is loaded." });
      return;
    }
    try {
      const outcome = await runExplainFlow(
        {
          app: state.app,
          caseId: state.caseId,
          ...(cmd.findingId ? { findingId: cmd.findingId } : {}),
          ...(state.focusedFindingId ? { focusedFindingId: state.focusedFindingId } : {}),
        },
        d,
      );
      if (seq !== explainSeq) return;
      if (!outcome.ok) {
        publishVoice({ kind: "error", text: outcome.reason });
        return;
      }
      const vt = outcome.verified;
      if (!bus.publish({ ch: "verified", ev: vt }, AI_ORIGIN).ok) {
        publishVoice({ kind: "error", text: "Needs review. The fact-check result was malformed." });
        return;
      }
      if (vt.status !== "verified") publishVoice({ kind: "error", text: blockReason(vt) });
    } catch (err) {
      log.warn({ err: { name: (err as Error).name, message: redactPhone((err as Error).message) } }, "explain flow failed");
      if (seq === explainSeq) publishVoice({ kind: "error", text: "Needs review. The explanation could not be produced or checked." });
    }
  }

  return {
    name: "ai",
    config,
    async start() {
      const cases = deps.cases ?? new FileCaseLookup(config.casepackDir, log);
      if (config.mode === "live" && !(deps.voice && deps.explainer && deps.checker)) {
        try {
          const live = await liveDeps(config, log);
          checkerFailed = live.checkerFailed;
          active = { voice: live.voice, explainer: live.explainer, checker: live.checker, cases, ...deps };
        } catch (err) {
          startFailed = true;
          throw err;
        }
      } else {
        active = {
          voice: deps.voice ?? new MockVoiceAgent(),
          explainer: deps.explainer ?? new MockExplainer(),
          checker: deps.checker ?? new MockClaimChecker(config.policiesDir),
          cases,
        };
      }
      const d = active;
      bus.subscribe((env: BusEnvelope, origin: string) => {
        if (origin === AI_ORIGIN && env.ch !== "cmd") return;
        if (env.ch === "voice" && env.ev.kind === "transcript" && isClientOrigin(origin) && env.ev.text) {
          const text = env.ev.text;
          track(() => onTranscript(d, text));
        } else if (env.ch === "cmd" && env.cmd.type === "explain") {
          const cmd = env.cmd;
          track(() => onExplain(d, cmd));
        }
      });
      log.info({ mode: config.mode, region: config.region }, "ai module started");
    },
    health(): ModuleHealth {
      if (startFailed) return { status: "error", detail: "Bedrock clients failed to start; explanations are refused." };
      if (checkerFailed()) return { status: "error", detail: "The last Automated Reasoning check failed; results are marked needs review." };
      return config.mode === "live"
        ? { status: "live", detail: `Bedrock in ${config.region}` }
        : { status: "mock", detail: "Mock voice, explainer and fact-check fixtures." };
    },
    async idle() {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
  };
}
