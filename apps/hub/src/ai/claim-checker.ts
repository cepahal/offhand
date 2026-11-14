import type { AppId, VerifiedText } from "@hoverscan/contracts";

export interface CheckContext {
  app: AppId;
  policyId: string;
}

/** Checks draft text against the app's rulebook. Must never return "verified" on error. */
export interface ClaimChecker {
  check(text: string, ctx: CheckContext): Promise<VerifiedText>;
}
