import { VerifiedText, type AppId, type VerifiedStatus } from "@hoverscan/contracts";
import { z } from "zod";
import type { CaseLookup } from "./case-lookup.js";
import type { ClaimChecker } from "./claim-checker.js";
import type { Explainer } from "./explainer.js";
import { mapStatus } from "./statusMapping.js";

export const MAX_TEXT = 1000;
const MAX_DETAIL = 2000;

export interface ExplainRequest {
  app: AppId;
  caseId: string;
  /** Explicit finding, else the focused one, else the only one. */
  findingId?: string;
  focusedFindingId?: string;
}

export type ExplainOutcome = { ok: true; verified: VerifiedText } | { ok: false; reason: string };

export interface ExplainFlowDeps {
  cases: CaseLookup;
  explainer: Explainer;
  checker: ClaimChecker;
}

/** Shortens text to the VerifiedText limit at a sentence or word boundary. Runs before the check, so the checked text is the sent text. */
export function fitToLimit(text: string, max = MAX_TEXT): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return `${cut.slice(0, word > 0 ? word : cut.length)}…`;
}

const RANK: Record<VerifiedStatus, number> = { verified: 0, needs_review: 1, blocked: 2 };

/** Stricter than the contract: a checker result that fails this can never be "verified". */
const WellFormedVerifiedText = VerifiedText.extend({
  text: z.string().min(1).max(MAX_TEXT),
  policyId: z.string().min(1),
  checkedAt: z.iso.datetime({ offset: true }),
});

/**
 * Normalizes a checker result so it can never claim more than its findings support:
 * the status is the stricter of the checker's own status and mapStatus(findings),
 * and every non-verified result carries at least one reason.
 */
export function enforceFailClosed(vt: VerifiedText): VerifiedText {
  const mapped = mapStatus(vt.findings);
  let status: VerifiedStatus = RANK[vt.status] >= RANK[mapped] ? vt.status : mapped;
  if (!WellFormedVerifiedText.safeParse(vt).success) status = status === "blocked" ? "blocked" : "needs_review";
  const findings = vt.findings.map((f) => ({ type: f.type, detail: f.detail.slice(0, MAX_DETAIL) }));
  if (status !== "verified" && findings.length === 0) {
    findings.push({ type: "NO_RESULTS", detail: "The fact-check returned no results." });
  }
  return { ...vt, status, findings };
}

/** The text to show on screen for a non-verified result. */
export function blockReason(vt: VerifiedText): string {
  if (vt.status === "verified") return "";
  const label = vt.status === "blocked" ? "Blocked" : "Needs review";
  const reasons = vt.findings.filter((f) => f.type !== "VALID").map((f) => `${f.type}: ${f.detail}`);
  return `${label}. ${reasons.join(" ") || "No reason given."}`.slice(0, MAX_DETAIL);
}

/** A short, secret-free reason for an explainer failure. */
export function explainerFailure(err: unknown): string {
  const e = err as { name?: string; message?: string };
  const name = e?.name ?? "Error";
  if (/Credentials|UnrecognizedClient|ExpiredToken|InvalidSignature|AccessDenied/i.test(`${name} ${e?.message ?? ""}`)) {
    return `AWS credentials are missing, expired or not allowed: ${name}`;
  }
  return name;
}

/** explain command -> Explainer -> ClaimChecker -> VerifiedText. */
export async function runExplainFlow(req: ExplainRequest, deps: ExplainFlowDeps): Promise<ExplainOutcome> {
  const manifest = await deps.cases.getCase(req.app, req.caseId);
  if (!manifest) return { ok: false, reason: `Case ${req.caseId} is not available.` };

  const wanted = req.findingId ?? req.focusedFindingId;
  const finding = wanted
    ? manifest.findings.find((f) => f.id === wanted)
    : manifest.findings.length === 1
      ? manifest.findings[0]
      : undefined;
  if (!finding) {
    return { ok: false, reason: wanted ? `Finding ${wanted} is not in this case.` : "Which finding? Focus one first." };
  }
  if (!finding.reportExcerpt) {
    return { ok: false, reason: `Finding ${finding.id} has no dataset report text, so there is nothing to explain.` };
  }

  let draft: string;
  try {
    draft = fitToLimit(
      await deps.explainer.explain(finding, { app: req.app, caseId: req.caseId, ...(manifest.report ? { report: manifest.report } : {}) }),
    );
  } catch (err) {
    // On screen: the dataset's own measured sentence, marked needs review. It can never be sent.
    return {
      ok: true,
      verified: enforceFailClosed({
        text: fitToLimit(finding.reportExcerpt),
        status: "needs_review",
        findings: [{ type: "EXPLAINER_ERROR", detail: `No explanation could be drafted (${explainerFailure(err)}). Showing the measured text only.` }],
        policyId: manifest.policyId,
        checkedAt: new Date().toISOString(),
      }),
    };
  }
  if (!draft) return { ok: false, reason: "The explainer returned no text." };

  const checked = await deps.checker.check(draft, { app: req.app, policyId: manifest.policyId });
  return { ok: true, verified: enforceFailClosed({ ...checked, text: draft }) };
}
