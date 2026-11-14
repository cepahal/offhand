import {
  ApplyGuardrailCommand,
  type ApplyGuardrailCommandOutput,
  type GuardrailAutomatedReasoningFinding,
  type GuardrailAutomatedReasoningRule,
  type GuardrailAutomatedReasoningTranslation,
} from "@aws-sdk/client-bedrock-runtime";
import type { VerifiedText } from "@hoverscan/contracts";
import type { Logger } from "../log/logger.js";
import { createBedrockClient, type GuardrailClient } from "./bedrock-client.js";
import type { CheckContext, ClaimChecker } from "./claim-checker.js";
import type { AiConfig } from "./config.js";
import { mapStatus } from "./statusMapping.js";

type Result = VerifiedText["findings"][number];

/**
 * User-side context for the check. Per the AWS guide "Integrate Automated Reasoning checks in your
 * application" (read 2026-11-11), a `query` block is optional context and the `guard_content` block
 * supplies the claims; ApplyGuardrail with no agent-side block is a ValidationException.
 */
export const CHECK_QUERY = "Explain this imaging finding to the patient.";

const rules = (rs?: GuardrailAutomatedReasoningRule[]) =>
  rs?.length ? ` Rules: ${rs.map((r) => r.identifier ?? "?").join(", ")}.` : "";
const claims = (t?: GuardrailAutomatedReasoningTranslation) => {
  const c = (t?.claims ?? []).map((s) => s.naturalLanguage).filter(Boolean);
  return c.length ? ` Claims: ${c.join("; ")}.` : "";
};

/** One Automated Reasoning finding as a VerifiedText result. */
export function toResult(f: GuardrailAutomatedReasoningFinding): Result {
  if (f.valid) {
    // A logic warning means the rules made the claim trivially true or false; fail closed.
    // TODO(verify) against AWS guidance on logicWarning before treating these as VALID.
    if (f.valid.logicWarning) {
      return { type: "VALID_WITH_LOGIC_WARNING", detail: `Valid, but the rules raised a logic warning.${claims(f.valid.translation)}` };
    }
    return { type: "VALID", detail: `Consistent with the rulebook.${rules(f.valid.supportingRules)}` };
  }
  if (f.invalid) {
    return { type: "INVALID", detail: `Contradicts the rulebook.${rules(f.invalid.contradictingRules)}${claims(f.invalid.translation)}` };
  }
  if (f.impossible) return { type: "IMPOSSIBLE", detail: `The statements contradict each other or the rulebook.${claims(f.impossible.translation)}` };
  if (f.satisfiable) return { type: "SATISFIABLE", detail: `Could be true or false under the rulebook.${claims(f.satisfiable.translation)}` };
  if (f.translationAmbiguous) return { type: "TRANSLATION_AMBIGUOUS", detail: "The text can be read more than one way." };
  if (f.tooComplex) return { type: "TOO_COMPLEX", detail: "Too complex to check against the rulebook." };
  if (f.noTranslations) return { type: "NO_TRANSLATIONS", detail: "No statements the rulebook covers were found." };
  return { type: "UNKNOWN_FINDING", detail: "The checker returned a result type this version does not understand." };
}

/** All Automated Reasoning results in a response, plus a result if another guardrail policy intervened. */
export function resultsFrom(out: ApplyGuardrailCommandOutput): Result[] {
  const results = (out.assessments ?? []).flatMap((a) => (a.automatedReasoningPolicy?.findings ?? []).map(toResult));
  if (out.action === "GUARDRAIL_INTERVENED" && !results.some((r) => r.type === "INVALID" || r.type === "IMPOSSIBLE")) {
    results.push({ type: "GUARDRAIL_INTERVENED", detail: out.actionReason ?? "Another guardrail policy intervened." });
  }
  return results;
}

/** Live only. Gated: throws "not configured" unless AI_MODE=live with a guardrail id and version. */
export class AutomatedReasoningChecker implements ClaimChecker {
  private readonly client: GuardrailClient;
  /** True when the most recent call failed; drives /api/health. */
  lastCallFailed = false;

  constructor(
    private readonly cfg: AiConfig,
    private readonly logger: Logger,
    client?: GuardrailClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (cfg.mode !== "live" || !cfg.guardrailId || !cfg.guardrailVersion) throw new Error("not configured");
    this.client = client ?? createBedrockClient(cfg.region);
  }

  async check(text: string, ctx: CheckContext): Promise<VerifiedText> {
    const base = {
      text,
      policyId: ctx.policyId,
      checker: "live" as const,
      checkedAt: this.now().toISOString(),
    };
    try {
      const out = await this.client.send(
        new ApplyGuardrailCommand({
          guardrailIdentifier: this.cfg.guardrailId,
          guardrailVersion: this.cfg.guardrailVersion,
          source: "OUTPUT",
          outputScope: "FULL",
          content: [
            { text: { text: CHECK_QUERY, qualifiers: ["query"] } },
            { text: { text, qualifiers: ["guard_content"] } },
          ],
        }),
      );
      this.lastCallFailed = false;
      const findings = resultsFrom(out);
      return { ...base, status: mapStatus(findings), findings };
    } catch (err) {
      this.lastCallFailed = true;
      this.logger.warn({ err: { name: (err as Error).name, message: (err as Error).message } }, "ApplyGuardrail failed");
      return { ...base, status: "needs_review", findings: [{ type: "CHECK_ERROR", detail: "The fact-check could not run." }] };
    }
  }
}
