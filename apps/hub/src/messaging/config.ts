import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "../config.js";

const MessagingConfigFile = z.object({
  mode: z.enum(["mock", "live"]).default("mock"),
  projectId: z.string().default(""),
  optInKeyword: z.string().trim().min(2).max(32).default("HOVERSCAN"),
  optOutKeyword: z.string().trim().min(2).max(32).default("STOP"),
  pendingTtlMs: z.coerce.number().int().positive().default(60_000),
  mockRead: z.union([z.boolean(), z.enum(["true", "false", "1", "0", "on", "off"])]).default(true),
  recipientsFile: z.string().min(1).default("data/recipients.json"),
});

export const PHOTON_TRANSPORTS = ["sdk", "webhook"] as const;
export type PhotonTransport = (typeof PHOTON_TRANSPORTS)[number];

/** Identity of our own iMessage extension, needed by customizedMiniApp(). All three or none. */
export interface MiniAppConfig {
  appName: string;
  teamId: string;
  extensionBundleId: string;
}

export interface MessagingConfig {
  mode: "mock" | "live";
  /** sdk: long-lived spectrum-ts connection inside the hub. webhook: Spectrum POSTs to /webhooks/photon. */
  transport: PhotonTransport;
  projectId: string;
  /** Photon project secret. Never logged. */
  projectSecret: string;
  /** The Spectrum line (E.164) cards are sent from. Never logged in full; see maskLine(). */
  line: string;
  /** Public HTTPS origin the webhook transport is reachable at, without a trailing slash. */
  publicUrl: string;
  /** Per-webhook signing secret from Spectrum / Webhooks. Never logged. */
  webhookSecret: string;
  miniApp?: MiniAppConfig | undefined;
  optInKeyword: string;
  optOutKeyword: string;
  pendingTtlMs: number;
  mockRead: boolean;
  /** Absolute path. Holds the phone-to-recipientRef map; git-ignored. */
  recipientsFile: string;
}

export interface LoadMessagingConfigOptions {
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  repoRoot?: string;
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** config/photon.json, then config/photon.local.json, then PHOTON_ env vars (non-empty values win). */
export function loadMessagingConfig({
  env = process.env,
  configDir = join(REPO_ROOT, "config"),
  repoRoot = REPO_ROOT,
}: LoadMessagingConfigOptions = {}): MessagingConfig {
  const fromEnv: Record<string, string | undefined> = {
    mode: env.PHOTON_MODE,
    projectId: env.PHOTON_PROJECT_ID,
    optInKeyword: env.PHOTON_OPTIN_KEYWORD,
    mockRead: env.PHOTON_MOCK_READ,
  };
  const merged = {
    ...readJson(join(configDir, "photon.json")),
    ...readJson(join(configDir, "photon.local.json")),
    ...Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v !== undefined && v !== "")),
  };
  const parsed = MessagingConfigFile.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`invalid messaging config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const { mockRead, recipientsFile, ...rest } = parsed.data;
  const trimmed = (k: string) => env[k]?.trim() ?? "";
  const miniApp = {
    appName: trimmed("PHOTON_MINIAPP_APP_NAME"),
    teamId: trimmed("PHOTON_MINIAPP_TEAM_ID"),
    extensionBundleId: trimmed("PHOTON_MINIAPP_BUNDLE_ID"),
  };
  return {
    ...rest,
    projectId: rest.projectId.trim(),
    // Mock mode has no transport, so only live mode rejects a bad value.
    transport: rest.mode === "live" ? parseTransport(env.PHOTON_TRANSPORT) : "sdk",
    projectSecret: trimmed("PHOTON_API_KEY"),
    line: trimmed("PHOTON_LINE"),
    publicUrl: trimmed("PHOTON_PUBLIC_URL").replace(/\/+$/, ""),
    webhookSecret: trimmed("PHOTON_WEBHOOK_SECRET"),
    miniApp: miniApp.appName && miniApp.teamId && miniApp.extensionBundleId ? miniApp : undefined,
    mockRead: typeof mockRead === "boolean" ? mockRead : ["true", "1", "on"].includes(mockRead),
    recipientsFile: isAbsolute(recipientsFile) ? recipientsFile : join(repoRoot, recipientsFile),
  };
}

/** Empty means sdk; anything other than sdk or webhook is refused. */
export function parseTransport(raw: string | undefined): PhotonTransport {
  const v = raw?.trim().toLowerCase() ?? "";
  if (v === "") return "sdk";
  if ((PHOTON_TRANSPORTS as readonly string[]).includes(v)) return v as PhotonTransport;
  throw new Error(`PHOTON_TRANSPORT must be sdk or webhook (got "${raw}")`);
}

/** Last 4 digits only. The only form of the line that may be printed. */
export function maskLine(line: string): string {
  const digits = line.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "????";
}

/** The URL to register under Spectrum / Webhooks → Add webhook. */
export function webhookUrl(cfg: Pick<MessagingConfig, "publicUrl">): string {
  return `${cfg.publicUrl}/webhooks/photon`;
}

/** Names of the settings live mode is missing (empty when ready). */
export function missingLiveSettings(cfg: MessagingConfig): string[] {
  const need: [string, string][] = [
    ["PHOTON_PROJECT_ID", cfg.projectId],
    ["PHOTON_API_KEY", cfg.projectSecret],
    ["PHOTON_LINE", cfg.line],
  ];
  if (cfg.transport === "webhook") {
    need.push(["PHOTON_PUBLIC_URL", cfg.publicUrl], ["PHOTON_WEBHOOK_SECRET", cfg.webhookSecret]);
  }
  const missing = need.filter(([, v]) => !v).map(([k]) => k);
  if (cfg.line && cfg.line.replace(/\D/g, "").length < 8) missing.push("PHOTON_LINE (not a phone number)");
  if (cfg.transport === "webhook" && cfg.publicUrl && !/^https:\/\/[^/]+$/.test(cfg.publicUrl)) {
    missing.push("PHOTON_PUBLIC_URL (must be a bare https:// origin)");
  }
  return missing;
}

/** Throws unless every setting live mode needs is present. */
export function assertLiveReady(cfg: MessagingConfig): void {
  if (cfg.mode !== "live") return;
  const missing = missingLiveSettings(cfg);
  if (missing.length) throw new Error(`PHOTON_MODE=live refuses to start: missing ${missing.join(", ")}`);
}
