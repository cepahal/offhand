import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "../config.js";

const AiConfigFile = z.object({
  mode: z.enum(["mock", "live"]).default("mock"),
  region: z.string().trim().min(1).default("us-east-2"),
  converseModelId: z.string().trim().default(""),
  guardrailId: z.string().trim().default(""),
  guardrailVersion: z.string().trim().default(""),
  policiesDir: z.string().min(1).default("policies"),
  casepackDir: z.string().min(1).default("casepacks"),
});

export type AiMode = "mock" | "live";

export interface AiConfig {
  mode: AiMode;
  region: string;
  converseModelId: string;
  guardrailId: string;
  guardrailVersion: string;
  /** Absolute path. */
  policiesDir: string;
  /** Absolute path. */
  casepackDir: string;
}

export interface LoadAiConfigOptions {
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  repoRoot?: string;
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** config/ai.json, then config/ai.local.json, then env vars (non-empty values win). */
export function loadAiConfig({
  env = process.env,
  configDir = join(REPO_ROOT, "config"),
  repoRoot = REPO_ROOT,
}: LoadAiConfigOptions = {}): AiConfig {
  const fromEnv: Record<string, string | undefined> = {
    mode: env.AI_MODE,
    region: env.AWS_REGION,
    converseModelId: env.AI_CONVERSE_MODEL_ID,
    guardrailId: env.AI_GUARDRAIL_ID,
    guardrailVersion: env.AI_GUARDRAIL_VERSION,
    casepackDir: env.CASEPACK_DIR,
  };
  const merged = {
    ...readJson(join(configDir, "ai.json")),
    ...readJson(join(configDir, "ai.local.json")),
    ...Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v !== undefined && v !== "")),
  };
  const parsed = AiConfigFile.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`invalid AI config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const abs = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));
  return { ...parsed.data, policiesDir: abs(parsed.data.policiesDir), casepackDir: abs(parsed.data.casepackDir) };
}

/** Names of the settings live mode is missing (empty when ready). */
export function missingLiveSettings(cfg: AiConfig): string[] {
  return [
    ["AWS_REGION", cfg.region],
    ["AI_CONVERSE_MODEL_ID", cfg.converseModelId],
    ["AI_GUARDRAIL_ID", cfg.guardrailId],
    ["AI_GUARDRAIL_VERSION", cfg.guardrailVersion],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k!);
}

/** Throws unless every setting live mode needs is present. */
export function assertLiveReady(cfg: AiConfig): void {
  if (cfg.mode !== "live") return;
  const missing = missingLiveSettings(cfg);
  if (missing.length) throw new Error(`AI_MODE=live refuses to start: missing ${missing.join(", ")}`);
}
