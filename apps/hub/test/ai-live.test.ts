import type {
  ApplyGuardrailCommand,
  ApplyGuardrailCommandOutput,
  ContentBlock,
  ConverseCommand,
  ConverseCommandOutput,
  GuardrailAutomatedReasoningFinding,
} from "@aws-sdk/client-bedrock-runtime";
import { ViewerCommand } from "@hoverscan/contracts";
import { describe, expect, it } from "vitest";
import { AutomatedReasoningChecker } from "../src/ai/automated-reasoning-checker.js";
import { BedrockExplainer } from "../src/ai/bedrock-explainer.js";
import { ConverseVoiceAgent } from "../src/ai/converse-voice-agent.js";
import { TOOL_ALIASES, buildToolSpecs, toolCallToCommand } from "../src/ai/tools.js";
import { UNMATCHED_REPLY } from "../src/ai/voice-agent.js";
import { aiConfig, memoryLogger } from "./helpers.js";

const live = aiConfig({ mode: "live", converseModelId: "test-model", guardrailId: "gr-test", guardrailVersion: "1" });
const ALL_TYPES = ViewerCommand.options.map((o) => o.shape.type.value);

function converseClient(content: ContentBlock[]) {
  const sent: ConverseCommand[] = [];
  return {
    sent,
    send: async (cmd: ConverseCommand) => {
      sent.push(cmd);
      return { output: { message: { role: "assistant", content } }, stopReason: "tool_use" } as unknown as ConverseCommandOutput;
    },
  };
}

function guardrailClient(out: Partial<ApplyGuardrailCommandOutput> | Error) {
  const sent: ApplyGuardrailCommand[] = [];
  return {
    sent,
    send: async (cmd: ApplyGuardrailCommand) => {
      sent.push(cmd);
      if (out instanceof Error) throw out;
      return { action: "NONE", outputs: [], assessments: [], ...out } as ApplyGuardrailCommandOutput;
    },
  };
}

const arOut = (...findings: GuardrailAutomatedReasoningFinding[]): Partial<ApplyGuardrailCommandOutput> => ({
  assessments: [{ automatedReasoningPolicy: { findings } }],
});

describe("generated tools", () => {
  const tools = buildToolSpecs();

  it("has one tool per ViewerCommand type plus the aliases", () => {
    const names = tools.map((t) => t.name);
    for (const type of ALL_TYPES) expect(names).toContain(type);
    expect(names).toEqual([...ALL_TYPES, ...Object.keys(TOOL_ALIASES)]);
    expect(TOOL_ALIASES).toEqual({ explain_finding: "explain", send_to_patient: "share_to_patient" });
  });

  it("strips hub-filled fields and keeps command arguments", () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      for (const k of ["id", "ts", "source", "type"]) expect(t.inputSchema.properties).not.toHaveProperty(k);
      expect(t.description.length).toBeGreaterThan(0);
    }
    expect(tools.find((t) => t.name === "zoom")?.inputSchema.required).toEqual(["factor"]);
    expect(tools.find((t) => t.name === "share_to_patient")?.inputSchema.required).toEqual(["bookmarkIds"]);
  });

  it("toolCallToCommand validates and stamps source voice", () => {
    expect(toolCallToCommand("send_to_patient", { bookmarkIds: [] })).toMatchObject({ ok: true, command: { type: "share_to_patient", source: "voice" } });
    expect(toolCallToCommand("send_to_patient", {}).ok).toBe(false);
    expect(toolCallToCommand("zoom", { factor: "big" }).ok).toBe(false);
    expect(toolCallToCommand("delete_patient", {}).ok).toBe(false);
    expect(toolCallToCommand("zoom", { factor: 1.25, source: "system" })).toMatchObject({ ok: true, command: { source: "voice" } });
  });
});

describe("ConverseVoiceAgent", () => {
  it("throws not configured unless AI_MODE=live", () => {
    expect(() => new ConverseVoiceAgent(aiConfig(), memoryLogger().logger, converseClient([]))).toThrow("not configured");
    expect(() => new ConverseVoiceAgent({ ...live, converseModelId: "" }, memoryLogger().logger)).toThrow("not configured");
  });

  it("sends the model id, system prompt and every tool", async () => {
    const client = converseClient([{ toolUse: { toolUseId: "t1", name: "explain_finding", input: {} } }]);
    const r = await new ConverseVoiceAgent(live, memoryLogger().logger, client).handle("explain it", {});
    expect(r.commands).toMatchObject([{ type: "explain", source: "voice" }]);
    const input = client.sent[0]!.input;
    expect(input.modelId).toBe("test-model");
    expect(input.system?.[0]).toMatchObject({ text: expect.stringContaining("Never invent") });
    expect(input.toolConfig?.tools?.map((t) => t.toolSpec?.name)).toEqual(buildToolSpecs().map((t) => t.name));
  });

  it("drops a tool call with invalid arguments and logs a warning", async () => {
    const { logger, records } = memoryLogger();
    const client = converseClient([{ toolUse: { toolUseId: "t1", name: "zoom", input: { factor: "lots" } } }]);
    const r = await new ConverseVoiceAgent(live, logger, client).handle("zoom a lot", {});
    expect(r.commands).toEqual([]);
    expect(r.envelopes).toEqual([{ ch: "voice", ev: { kind: "transcript", text: UNMATCHED_REPLY } }]);
    expect(records().some((l) => l.msg === "dropped invalid tool call" && l.tool === "zoom")).toBe(true);
  });

  it("keeps only the first valid tool call", async () => {
    const client = converseClient([
      { toolUse: { toolUseId: "t1", name: "zoom", input: { factor: 1.25 } } },
      { toolUse: { toolUseId: "t2", name: "send_to_patient", input: {} } },
    ]);
    const r = await new ConverseVoiceAgent(live, memoryLogger().logger, client).handle("zoom in and send it", {});
    expect(r.commands.map((c) => c.type)).toEqual(["zoom"]);
  });

  it("passes a clarifying question through when there is no tool call", async () => {
    const client = converseClient([{ text: "Which finding do you mean?" }]);
    const r = await new ConverseVoiceAgent(live, memoryLogger().logger, client).handle("that one", {});
    expect(r).toEqual({ commands: [], envelopes: [{ ch: "voice", ev: { kind: "transcript", text: "Which finding do you mean?" } }] });
  });
});

describe("BedrockExplainer", () => {
  it("throws not configured unless AI_MODE=live", () => {
    expect(() => new BedrockExplainer(aiConfig())).toThrow("not configured");
  });
});

describe("AutomatedReasoningChecker", () => {
  const check = (out: Partial<ApplyGuardrailCommandOutput> | Error) => {
    const client = guardrailClient(out);
    const checker = new AutomatedReasoningChecker(live, memoryLogger("error").logger, client);
    return { client, checker, run: () => checker.check("Draft text.", { app: "chairside", policyId: "chairside" }) };
  };

  it("throws not configured unless AI_MODE=live", () => {
    expect(() => new AutomatedReasoningChecker(aiConfig(), memoryLogger().logger)).toThrow("not configured");
  });

  it("sends the guardrail id, version and the text as guard_content", async () => {
    const { client, run } = check(arOut({ valid: {} }));
    await run();
    expect(client.sent[0]!.input).toMatchObject({
      guardrailIdentifier: "gr-test",
      guardrailVersion: "1",
      source: "OUTPUT",
      content: expect.arrayContaining([{ text: { text: "Draft text.", qualifiers: ["guard_content"] } }]),
    });
  });

  it.each([
    [[{ valid: {} }], "verified"],
    [[{ valid: {} }, { invalid: { contradictingRules: [{ identifier: "R2" }] } }], "blocked"],
    [[{ impossible: {} }], "blocked"],
    [[{ satisfiable: {} }], "needs_review"],
    [[{ translationAmbiguous: {} }], "needs_review"],
    [[{ tooComplex: {} }], "needs_review"],
    [[{ noTranslations: {} }], "needs_review"],
    [[{ valid: { logicWarning: { type: "ALWAYS_TRUE" } } }], "needs_review"],
    [[], "needs_review"],
  ] as [GuardrailAutomatedReasoningFinding[], string][])("%j -> %s", async (findings, status) => {
    const vt = await check(arOut(...findings)).run();
    expect(vt).toMatchObject({ status, checker: "live", policyId: "chairside", text: "Draft text." });
  });

  it("a guardrail intervention without AR findings is needs_review", async () => {
    const vt = await check({ action: "GUARDRAIL_INTERVENED", actionReason: "content filter" }).run();
    expect(vt.status).toBe("needs_review");
    expect(vt.findings).toEqual([{ type: "GUARDRAIL_INTERVENED", detail: "content filter" }]);
  });

  it("an API failure is needs_review, never verified, and flips health", async () => {
    const { checker, run } = check(new Error("AccessDeniedException"));
    const vt = await run();
    expect(vt.status).toBe("needs_review");
    expect(vt.findings).toEqual([{ type: "CHECK_ERROR", detail: "The fact-check could not run." }]);
    expect(checker.lastCallFailed).toBe(true);
  });
});
