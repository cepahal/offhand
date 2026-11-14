/**
 * pnpm photon:listen — the Photon sdk transport only, for HOSPITAL / PATIENT registration.
 * Does not start the AI, the integrations, or the viewer, and does not read the guardrail ids.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { photonListenProblems } from "../src/messaging/photon-listen-env.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = { ...process.env };
const problems = photonListenProblems(env);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

const { runRegistrationListener } = await import("../src/messaging/registration-listen.js");
try {
  await runRegistrationListener({ env, print: (line) => console.log(line) });
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
