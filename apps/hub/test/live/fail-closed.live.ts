/**
 * Fail-closed test against the REAL ApplyGuardrail (Automated Reasoning) results for the 10
 * NeuroView rulebook test sentences. No mock verdicts. Needs AI_GUARDRAIL_ID, AI_GUARDRAIL_VERSION,
 * AWS_REGION and AWS credentials from the standard chain; without them every test fails as NOT RUN.
 *
 * Run: pnpm --filter @offhand/hub test:live
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AutomatedReasoningChecker } from "../../src/ai/automated-reasoning-checker.js";
import { loadAiConfig, missingLiveSettings } from "../../src/ai/config.js";
import { loadRulebook } from "../../src/ai/rulebook.js";
import { REPO_ROOT } from "../../src/config.js";
import { checkAwsCredentials } from "../../src/live/preflight.js";
import { harness } from "../messaging-harness.js";
import { memoryLogger } from "../helpers.js";

const cfg = loadAiConfig({ env: { ...process.env, AI_MODE: "live" } });
const rulebook = await loadRulebook(join(REPO_ROOT, "policies"), "neuroview");
const missing = missingLiveSettings(cfg);
const creds = missing.length ? undefined : await checkAwsCredentials(cfg.region);
const notRun = missing.length
  ? `NOT RUN: missing ${missing.join(", ")}`
  : creds && !creds.ok
    ? `NOT RUN: no AWS credentials in the standard chain (${creds.reason})`
    : !rulebook || rulebook.testSentences.length !== 10
      ? "NOT RUN: policies/neuroview/rulebook.json must hold exactly 10 test sentences"
      : undefined;

describe("fail closed with real Automated Reasoning results (10 rulebook sentences)", () => {
  if (notRun) {
    it("live prerequisites", () => {
      throw new Error(notRun);
    });
    return;
  }
  const sentences = rulebook!.testSentences;
  const checker = new AutomatedReasoningChecker(cfg, memoryLogger("warn").logger);

  it("no false sentence is ever verified by the live check", async () => {
    const report: string[] = [];
    for (const s of sentences) {
      const vt = await checker.check(s.text, { app: "neuroview", policyId: rulebook!.policyId });
      report.push(`${s.expected.padEnd(5)} ${vt.status.padEnd(12)} [${vt.findings.map((f) => f.type).join(",")}] ${s.text}`);
      if (s.expected === "false") expect(vt.status, `false sentence verified: ${s.text}`).not.toBe("verified");
    }
    console.log(`ApplyGuardrail results (${cfg.guardrailId} v${cfg.guardrailVersion}, ${cfg.region}):\n${report.join("\n")}`);
    expect(checker.lastCallFailed, "the last ApplyGuardrail call failed").toBe(false);
  }, 180_000);

  it("no false sentence reaches a sent event through the full share path", async () => {
    let current = sentences[0]!.text;
    const h = await harness({ explainer: { explain: async () => current }, checker });
    try {
      await h.optIn();
      h.setState();
      for (const s of sentences) {
        const before = h.sentEvents().length;
        current = s.text;
        await h.explain();
        const vt = h.seen.flatMap((e) => (e.ch === "verified" ? [e.ev] : [])).at(-1);
        expect(vt?.text).toBe(s.text);
        expect(vt?.checker).toBe("live");
        await h.cmd({ type: "share_to_patient", bookmarkIds: [] });
        await h.confirm();
        const sent = h.sentEvents().length > before;
        if (s.expected === "false") expect(sent, `false sentence was SENT: ${s.text}`).toBe(false);
        if (sent) expect(vt?.status).toBe("verified");
      }
      const sentTexts = [...h.channel.sent.values()].map((m) => m.request.verified.text);
      for (const s of sentences.filter((x) => x.expected === "false")) expect(sentTexts).not.toContain(s.text);
    } finally {
      await h.close();
    }
  }, 300_000);
});
