import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppId } from "@hoverscan/contracts";
import { z } from "zod";

/**
 * policies/<app>/rulebook.json: the terms an explanation may use, each with where its definition
 * comes from, and the test sentences the Automated Reasoning policy must get right.
 */
export const RulebookFile = z.object({
  policyId: z.string().min(1),
  terms: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1), source: z.string().min(1) })).min(1),
  testSentences: z.array(z.object({ text: z.string().min(1), expected: z.enum(["true", "false"]), basis: z.string().min(1) })),
});
export type RulebookFile = z.infer<typeof RulebookFile>;
export type RulebookTerm = RulebookFile["terms"][number];

export async function loadRulebook(policiesDir: string, app: AppId): Promise<RulebookFile | undefined> {
  try {
    return RulebookFile.parse(JSON.parse(await readFile(join(policiesDir, app, "rulebook.json"), "utf8")));
  } catch {
    return undefined;
  }
}
