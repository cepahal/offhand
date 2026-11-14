import { loadAiConfig, missingLiveSettings as missingAi } from "../ai/config.js";
import { loadIntegrationsConfig } from "../integrations/config.js";
import { loadMessagingConfig, maskLine, missingLiveSettings as missingPhoton, type PhotonTransport } from "../messaging/config.js";

export interface PreflightResult {
  ok: boolean;
  /** Undefined when PHOTON_TRANSPORT is not a known value. */
  transport: PhotonTransport | undefined;
  /** Each missing or invalid setting, by env var name. */
  missing: string[];
  /** Safe-to-print facts about the live setup (never a secret or a full phone number). */
  facts: string[];
}

/** Integrations a live NeuroView run needs, by env var. */
export const LIVE_INTEGRATIONS = ["INTEG_SLICER", "INTEG_CLINIC_INBOX"] as const;

/** Checks every setting a live run needs, as start:live and e2e:live see them. No network. */
export function preflight(env: NodeJS.ProcessEnv = process.env): PreflightResult {
  const missing: string[] = [];
  const facts: string[] = [];
  const live = { ...env, AI_MODE: "live", PHOTON_MODE: "live" };

  const ai = loadAiConfig({ env: live });
  missing.push(...missingAi(ai));
  facts.push(`AI: Converse model ${ai.converseModelId || "(unset)"} in ${ai.region}; guardrail ${ai.guardrailId ? `${ai.guardrailId} v${ai.guardrailVersion || "?"}` : "(unset)"}`);

  let transport: PhotonTransport | undefined;
  try {
    const photon = loadMessagingConfig({ env: live });
    transport = photon.transport;
    missing.push(...missingPhoton(photon));
    facts.push(`Photon: transport ${photon.transport}, line ${photon.line ? maskLine(photon.line) : "(unset)"}, mini-app card ${photon.miniApp ? "configured" : "not configured"}`);
  } catch (err) {
    missing.push(`PHOTON_TRANSPORT (${(err as Error).message})`);
  }

  try {
    const integ = loadIntegrationsConfig({ env });
    if (integ.slicer.mode !== "live") missing.push(`INTEG_SLICER=live (is ${integ.slicer.mode})`);
    if (integ.clinicinbox.mode !== "live") missing.push(`INTEG_CLINIC_INBOX=live (is ${integ.clinicinbox.mode})`);
    facts.push(`Slicer: ${integ.slicer.url}; clinic inbox: ${integ.clinicinbox.file}`);
  } catch (err) {
    missing.push(`INTEG_* (${(err as Error).message})`);
  }

  return { ok: missing.length === 0, transport, missing, facts };
}

export type AwsCredentialCheck = { ok: true; accessKeyHint: string; expires?: string } | { ok: false; reason: string };

/** Resolves credentials through the standard AWS chain, as the Bedrock client will. Prints no secret. */
export async function checkAwsCredentials(region: string): Promise<AwsCredentialCheck> {
  const { BedrockRuntimeClient } = await import("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient({ region });
  try {
    const creds = await client.config.credentials();
    return {
      ok: true,
      accessKeyHint: `…${creds.accessKeyId.slice(-4)}`,
      ...(creds.expiration ? { expires: creds.expiration.toISOString() } : {}),
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message.split("\n")[0]!.slice(0, 200) };
  } finally {
    client.destroy();
  }
}
