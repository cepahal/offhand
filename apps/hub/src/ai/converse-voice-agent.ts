import { ConverseCommand, type Tool } from "@aws-sdk/client-bedrock-runtime";
import type { ViewerCommand } from "@hoverscan/contracts";
import { redactPhone, type Logger } from "../log/logger.js";
import { converseText, createBedrockClient, type ConverseClient } from "./bedrock-client.js";
import type { AiConfig } from "./config.js";
import { buildToolSpecs, toolCallToCommand } from "./tools.js";
import { UNMATCHED_REPLY, voiceReply, type VoiceAgent, type VoiceContext, type VoiceResult } from "./voice-agent.js";

export const VOICE_SYSTEM_PROMPT = [
  "You control a 3D medical image viewer for a clinician who cannot touch the screen.",
  "Map the clinician's request to exactly one tool call.",
  "Use only finding ids listed in the context. Use the pending confirmation id from the context for confirm.",
  "If the request is unclear or matches no tool, reply with one short clarifying question and make no tool call.",
  "Never invent or state a medical fact.",
].join(" ");

/** Live only. Gated: throws "not configured" unless AI_MODE=live with a Converse model id. */
export class ConverseVoiceAgent implements VoiceAgent {
  private readonly client: ConverseClient;
  private readonly tools: Tool[];

  constructor(
    private readonly cfg: AiConfig,
    private readonly logger: Logger,
    client?: ConverseClient,
    private readonly now: () => number = Date.now,
  ) {
    if (cfg.mode !== "live" || !cfg.converseModelId) throw new Error("not configured");
    this.client = client ?? createBedrockClient(cfg.region);
    this.tools = buildToolSpecs().map((t) => ({
      toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as never } },
    }));
  }

  async handle(transcript: string, ctx: VoiceContext): Promise<VoiceResult> {
    const context = {
      findings: ctx.findings ?? [],
      focusedFindingId: ctx.state?.focusedFindingId ?? null,
      pendingConfirmation: ctx.state?.pending.confirmFor ?? null,
    };
    const out = await this.client.send(
      new ConverseCommand({
        modelId: this.cfg.converseModelId,
        system: [{ text: VOICE_SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            content: [{ text: `Context: ${JSON.stringify(context)}\nClinician said: ${transcript}` }],
          },
        ],
        toolConfig: { tools: this.tools, toolChoice: { auto: {} } },
        inferenceConfig: { maxTokens: 300, temperature: 0 },
      }),
    );

    const commands: ViewerCommand[] = [];
    for (const block of out.output?.message?.content ?? []) {
      if (!block.toolUse) continue;
      const result = toolCallToCommand(block.toolUse.name, block.toolUse.input, this.now);
      if (!result.ok) {
        this.logger.warn({ tool: block.toolUse.name, reason: redactPhone(result.reason) }, "dropped invalid tool call");
        continue;
      }
      if (commands.length > 0) {
        this.logger.warn({ tool: block.toolUse.name }, "dropped extra tool call; one per request");
        continue;
      }
      commands.push(result.command);
    }

    if (commands.length > 0) {
      return { commands, envelopes: commands.map((c) => ({ ch: "voice", ev: { kind: "tool", tool: c.type } })) };
    }
    return { commands: [], envelopes: [voiceReply(clarifyingReply(converseText(out)))] };
  }
}

/**
 * Without a valid tool call the model may only ask a clarifying question. Anything else (a guess,
 * a statement, possibly a medical one) is replaced by the fixed help text.
 */
export function clarifyingReply(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length > 300 || !t.endsWith("?")) return UNMATCHED_REPLY;
  const sentences = t.split(/(?<=[.!?])\s+/);
  return sentences.length === 1 ? t : UNMATCHED_REPLY;
}
