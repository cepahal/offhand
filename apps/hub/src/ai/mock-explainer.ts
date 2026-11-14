import type { Explainer, Finding } from "./explainer.js";

/** Returns the dataset's report excerpt unchanged. */
export class MockExplainer implements Explainer {
  async explain(finding: Finding): Promise<string> {
    return finding.reportExcerpt ?? "";
  }
}
