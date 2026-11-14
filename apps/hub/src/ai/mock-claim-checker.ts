import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VerifiedText } from "@hoverscan/contracts";
import { z } from "zod";
import type { CheckContext, ClaimChecker } from "./claim-checker.js";
import { mapStatus } from "./statusMapping.js";

/**
 * policies/<app>/fixtures.json (PROPOSAL, A to confirm):
 *   { "cases": [ { "text": "...", "results": [ { "type": "VALID", "detail": "..." } ] } ] }
 * A case matches when its text equals the checked text after trimming and collapsing whitespace.
 */
export const FixturesFile = z.object({
  cases: z.array(
    z.object({
      text: z.string().min(1),
      results: z.array(z.object({ type: z.string().min(1), detail: z.string() })),
    }),
  ),
});
export type FixturesFile = z.infer<typeof FixturesFile>;

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

export class MockClaimChecker implements ClaimChecker {
  constructor(
    private readonly policiesDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(text: string, ctx: CheckContext): Promise<VerifiedText> {
    const result = (findings: VerifiedText["findings"], status = mapStatus(findings)): VerifiedText => ({
      text,
      status,
      findings,
      policyId: ctx.policyId,
      checker: "mock",
      checkedAt: this.now().toISOString(),
    });

    let raw: string;
    try {
      raw = await readFile(join(this.policiesDir, ctx.app, "fixtures.json"), "utf8");
    } catch {
      return result([{ type: "NO_FIXTURES", detail: "no fixtures loaded" }], "needs_review");
    }
    let fixtures: FixturesFile;
    try {
      fixtures = FixturesFile.parse(JSON.parse(raw));
    } catch {
      return result([{ type: "NO_FIXTURES", detail: `policies/${ctx.app}/fixtures.json is invalid` }], "needs_review");
    }
    const match = fixtures.cases.find((c) => norm(c.text) === norm(text));
    if (!match) {
      return result([{ type: "NO_FIXTURE", detail: `no fixture matches this text in policies/${ctx.app}/fixtures.json` }], "needs_review");
    }
    return result(match.results);
  }
}
