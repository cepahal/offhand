/**
 * Part of `pnpm check`: runs the fail-closed test with real ApplyGuardrail results whenever the live
 * AI settings and AWS credentials are present, and fails the build if a false sentence is sent.
 * Without them it cannot run offline, so it says NOT RUN loudly instead of passing quietly.
 */
import { spawnSync } from "node:child_process";
import { loadAiConfig, missingLiveSettings } from "../src/ai/config.js";
import { checkAwsCredentials } from "../src/live/preflight.js";

const cfg = loadAiConfig({ env: { ...process.env, AI_MODE: "live" } });
const missing = missingLiveSettings(cfg);
const creds = missing.length ? undefined : await checkAwsCredentials(cfg.region);
const reason = missing.length ? `missing ${missing.join(", ")}` : creds && !creds.ok ? `no AWS credentials (${creds.reason})` : undefined;

if (reason) {
  console.log(`\n*** fail-closed test with real ApplyGuardrail results: NOT RUN — ${reason}. Run pnpm e2e:live once it is configured. ***\n`);
  process.exit(0);
}
const r = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.live.config.ts"], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
