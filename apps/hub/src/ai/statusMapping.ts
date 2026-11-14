// PROPOSAL (pending team approval): how claim-check results become a VerifiedText status.
// Fail closed: only a non-empty, all-VALID result list is "verified".
import type { VerifiedStatus } from "@hoverscan/contracts";

export const AR_RESULT_TYPES = [
  "VALID",
  "INVALID",
  "SATISFIABLE",
  "IMPOSSIBLE",
  "TRANSLATION_AMBIGUOUS",
  "TOO_COMPLEX",
  "NO_TRANSLATIONS",
] as const;
export type ArResultType = (typeof AR_RESULT_TYPES)[number];

const BLOCKING = new Set<string>(["INVALID", "IMPOSSIBLE"]);

/**
 * - blocked: any INVALID or IMPOSSIBLE
 * - verified: at least one result, and every result is VALID
 * - needs_review: everything else, including an empty list and any type not listed above
 */
export function mapStatus(results: readonly (string | { type: string })[]): VerifiedStatus {
  const types = results.map((r) => (typeof r === "string" ? r : r.type));
  if (types.some((t) => BLOCKING.has(t))) return "blocked";
  if (types.length > 0 && types.every((t) => t === "VALID")) return "verified";
  return "needs_review";
}
