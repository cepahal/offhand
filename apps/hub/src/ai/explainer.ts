import type { AppId, CasePackManifest } from "@hoverscan/contracts";

export type Finding = CasePackManifest["findings"][number];

export interface ExplainContext {
  app: AppId;
  caseId: string;
  report?: CasePackManifest["report"];
}

/** Drafts plain-language text for a finding. The draft is not patient-safe until a ClaimChecker verifies it. */
export interface Explainer {
  explain(finding: Finding, ctx: ExplainContext): Promise<string>;
}
