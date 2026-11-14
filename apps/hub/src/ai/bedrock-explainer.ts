import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { converseText, createBedrockClient, type ConverseClient } from "./bedrock-client.js";
import type { AiConfig } from "./config.js";
import type { ExplainContext, Explainer, Finding } from "./explainer.js";
import { loadRulebook } from "./rulebook.js";

export const EXPLAIN_SYSTEM_PROMPT = [
  "You rewrite one measured finding from a medical imaging dataset in plain words.",
  "Use only two inputs: measuredText (the finding's measured sentence) and rulebookTerms (the only terms you may define).",
  "Keep every number, unit and visit exactly as written in measuredText.",
  "You may explain a word only by restating its definition from rulebookTerms.",
  "Never add a medical claim: no diagnosis, cause, prognosis, treatment, risk, comparison to normal, or reassurance.",
  "Do not mention any disease name unless it appears in measuredText.",
  "Write 2 to 4 short sentences at a 6th to 8th grade reading level. Plain text only, no advice, no questions.",
].join(" ");

/** Live only. Gated: throws "not configured" unless AI_MODE=live with a Converse model id. */
export class BedrockExplainer implements Explainer {
  private readonly client: ConverseClient;

  constructor(
    private readonly cfg: AiConfig,
    client?: ConverseClient,
  ) {
    if (cfg.mode !== "live" || !cfg.converseModelId) throw new Error("not configured");
    this.client = client ?? createBedrockClient(cfg.region);
  }

  async explain(finding: Finding, ctx: ExplainContext): Promise<string> {
    if (!finding.reportExcerpt) throw new Error("the finding has no measured text");
    const rulebook = await loadRulebook(this.cfg.policiesDir, ctx.app);
    const input = {
      measuredText: finding.reportExcerpt,
      label: finding.label,
      rulebookTerms: (rulebook?.terms ?? []).map((t) => ({ term: t.term, definition: t.definition })),
    };
    const out = await this.client.send(
      new ConverseCommand({
        modelId: this.cfg.converseModelId,
        system: [{ text: EXPLAIN_SYSTEM_PROMPT }],
        messages: [{ role: "user", content: [{ text: JSON.stringify(input) }] }],
        // ~1000 characters, the VerifiedText limit. TODO(verify) token-to-character ratio for Nova Lite.
        inferenceConfig: { maxTokens: 300, temperature: 0 },
      }),
    );
    const text = converseText(out);
    if (!text) throw new Error("explainer returned no text");
    return text;
  }
}
