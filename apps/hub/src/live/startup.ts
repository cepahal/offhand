import { loadAiConfig } from "../ai/config.js";
import { checkAwsCredentials, preflight } from "./preflight.js";

/** start:live gate: prints the active transport, refuses to start on any missing setting. */
export async function liveStartupGate(out: (line: string) => void = console.log): Promise<void> {
  const r = preflight();
  out(`HoverScan live mode. Active Photon transport: ${r.transport ?? "none (invalid PHOTON_TRANSPORT)"}`);
  for (const f of r.facts) out(`  ${f}`);
  if (!r.ok) {
    out("start:live refuses to start. Missing or invalid settings:");
    for (const m of r.missing) out(`  - ${m}`);
    process.exit(1);
  }
  const aws = await checkAwsCredentials(loadAiConfig().region);
  out(
    aws.ok
      ? `  AWS credentials: found in the standard chain (access key ${aws.accessKeyHint}${aws.expires ? `, expires ${aws.expires}` : ""})`
      : `  AWS credentials: NOT FOUND in the standard chain (${aws.reason}). Explanations will show "Needs review".`,
  );
}
