import type { VerifiedText } from "@hoverscan/contracts";
import { describe, expect, it } from "vitest";
import { FileCaseLookup } from "../src/ai/case-lookup.js";
import type { ClaimChecker } from "../src/ai/claim-checker.js";
import { blockReason, enforceFailClosed, fitToLimit, runExplainFlow, type ExplainRequest } from "../src/ai/explain-flow.js";
import { MockClaimChecker } from "../src/ai/mock-claim-checker.js";
import { MockExplainer } from "../src/ai/mock-explainer.js";
import { AR_RESULT_TYPES } from "../src/ai/statusMapping.js";
import { EXCERPT_BAD, EXCERPT_OK, writeAiTree } from "./ai-fixtures.js";
import { memoryLogger } from "./helpers.js";

const req = (findingId?: string): ExplainRequest => ({ app: "chairside", caseId: "test-pattern", ...(findingId ? { findingId } : {}) });

function deps(tree: ReturnType<typeof writeAiTree>, checker?: ClaimChecker) {
  return {
    cases: new FileCaseLookup(tree.casepackDir, memoryLogger().logger),
    explainer: new MockExplainer(),
    checker: checker ?? new MockClaimChecker(tree.policiesDir),
  };
}

/** A checker that returns fixed results but always claims "verified". */
const lyingChecker = (findings: VerifiedText["findings"]): ClaimChecker => ({
  check: async (text) => ({ text, status: "verified", findings, checker: "mock", policyId: "chairside", checkedAt: new Date().toISOString() }),
});

describe("explain flow", () => {
  it("verifies the unchanged excerpt when every fixture result is VALID", async () => {
    const out = await runExplainFlow(req(), deps(writeAiTree()));
    expect(out).toMatchObject({ ok: true, verified: { text: EXCERPT_OK, status: "verified", checker: "mock", policyId: "chairside" } });
  });

  it("blocks a VALID + INVALID mix and explains why", async () => {
    const out = await runExplainFlow(req("f2"), deps(writeAiTree({ findings: 2 })));
    if (!out.ok) throw new Error(out.reason);
    expect(out.verified).toMatchObject({ text: EXCERPT_BAD, status: "blocked" });
    expect(blockReason(out.verified)).toBe("Blocked. INVALID: Contradicts test rule R2.");
  });

  it("missing fixtures file gives needs_review with 'no fixtures loaded'", async () => {
    const out = await runExplainFlow(req(), deps(writeAiTree({ fixtures: null })));
    if (!out.ok) throw new Error(out.reason);
    expect(out.verified.status).toBe("needs_review");
    expect(out.verified.findings).toEqual([{ type: "NO_FIXTURES", detail: "no fixtures loaded" }]);
    expect(blockReason(out.verified)).toContain("no fixtures loaded");
  });

  it("invalid fixtures file and unmatched text give needs_review", async () => {
    const bad = await runExplainFlow(req(), deps(writeAiTree({ fixtures: "{not json" })));
    const unmatched = await runExplainFlow(req(), deps(writeAiTree({ fixtures: { cases: [] } })));
    for (const out of [bad, unmatched]) {
      if (!out.ok) throw new Error(out.reason);
      expect(out.verified.status).toBe("needs_review");
    }
  });

  it("never verifies unless every result is VALID, even if the checker claims verified", async () => {
    const tree = writeAiTree();
    const nonValid = AR_RESULT_TYPES.filter((t) => t !== "VALID");
    const lists: VerifiedText["findings"][] = [
      [],
      ...nonValid.map((type) => [{ type, detail: "x" }]),
      ...nonValid.map((type) => [{ type: "VALID", detail: "ok" }, { type, detail: "x" }]),
      [{ type: "CHECK_ERROR", detail: "x" }],
    ];
    for (const findings of lists) {
      const out = await runExplainFlow(req(), deps(tree, lyingChecker(findings)));
      if (!out.ok) throw new Error(out.reason);
      expect(out.verified.status, JSON.stringify(findings)).not.toBe("verified");
      expect(out.verified.findings.length).toBeGreaterThan(0);
      expect(blockReason(out.verified)).not.toBe("");
    }
    const allValid = await runExplainFlow(req(), deps(tree, lyingChecker([{ type: "VALID", detail: "ok" }])));
    expect(allValid.ok && allValid.verified.status).toBe("verified");
  });

  it("keeps the stricter status when the checker is stricter than its findings", () => {
    const vt: VerifiedText = { text: "t", status: "blocked", findings: [{ type: "VALID", detail: "" }], checker: "live", policyId: "chairside", checkedAt: new Date().toISOString() };
    expect(enforceFailClosed(vt).status).toBe("blocked");
  });

  it("a malformed checker result is never verified", () => {
    const vt = { text: "t", status: "verified", findings: [{ type: "VALID", detail: "" }], checker: "live", policyId: "chairside", checkedAt: "yesterday" } as VerifiedText;
    expect(enforceFailClosed(vt).status).toBe("needs_review");
  });

  it("a throwing checker rejects; it never resolves to verified", async () => {
    const throwing: ClaimChecker = { check: () => Promise.reject(new Error("boom")) };
    await expect(runExplainFlow(req(), deps(writeAiTree(), throwing))).rejects.toThrow("boom");
  });

  it("reports unknown cases and findings without calling the explainer", async () => {
    const tree = writeAiTree({ findings: 2 });
    expect(await runExplainFlow({ ...req(), caseId: "nope" }, deps(tree))).toEqual({ ok: false, reason: "Case nope is not available." });
    expect(await runExplainFlow({ ...req(), caseId: "../x" }, deps(tree))).toMatchObject({ ok: false });
    expect(await runExplainFlow(req("f9"), deps(tree))).toEqual({ ok: false, reason: "Finding f9 is not in this case." });
    expect(await runExplainFlow(req(), deps(tree))).toMatchObject({ ok: false, reason: expect.stringContaining("Which finding") });
  });
});

describe("fitToLimit", () => {
  it("leaves short text alone and caps long text at 1000 characters", () => {
    expect(fitToLimit("  a  b ")).toBe("a b");
    const long = "This sentence is ten words long and then some more. ".repeat(40);
    const out = fitToLimit(long);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.endsWith(".")).toBe(true);
    expect(fitToLimit("x".repeat(1200)).length).toBeLessThanOrEqual(1000);
  });
});
