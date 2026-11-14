import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { AppId } from "@hoverscan/contracts";
import { z } from "zod";
import { REPO_ROOT } from "../config.js";

export const INTEGRATION_NAMES = ["logonly", "opendental", "slicer", "orthanc", "clinicinbox"] as const;
export type IntegrationName = (typeof INTEGRATION_NAMES)[number];
export type IntegrationMode = "off" | "mock" | "live";

const Mode = z.enum(["off", "mock", "live"]);
const Base = z.object({ env: z.string().regex(/^INTEG_[A-Z0-9_]+$/), mode: Mode, apps: z.array(AppId).min(1) });
const File = z.object({
  integrations: z.object({
    logonly: Base,
    opendental: Base.extend({ url: z.url(), patientsFile: z.string().min(1) }),
    slicer: Base.extend({
      url: z.string().min(1),
      sliceMaxIndex: z.object({ axial: z.number().int().positive(), coronal: z.number().int().positive(), sagittal: z.number().int().positive() }),
    }),
    orthanc: Base.extend({ url: z.url() }),
    clinicinbox: Base.extend({ file: z.string().min(1) }),
  }),
});
type FileShape = z.infer<typeof File>["integrations"];

export type IntegrationsConfig = {
  [K in IntegrationName]: Omit<FileShape[K], "mode"> & { mode: IntegrationMode };
} & {
  opendental: { developerKey: string; customerKey: string };
  orthanc: { username: string; password: string };
};

/** "on" means mock; anything else must be off, mock or live. */
function parseMode(name: string, raw: string | undefined, fallback: IntegrationMode): IntegrationMode {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "on") return "mock";
  const parsed = Mode.safeParse(v);
  if (!parsed.success) throw new Error(`${name} must be off, mock or live (got "${raw}")`);
  return parsed.data;
}

export interface LoadIntegrationsConfigOptions {
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  repoRoot?: string;
}

/**
 * config/integrations.json (or integrations.local.json when present) plus INTEG_ env vars.
 * The mode of each integration comes from its INTEG_ variable; without it, the file default (off).
 */
export function loadIntegrationsConfig({
  env = process.env,
  configDir = join(REPO_ROOT, "config"),
  repoRoot = REPO_ROOT,
}: LoadIntegrationsConfigOptions = {}): IntegrationsConfig {
  const local = join(configDir, "integrations.local.json");
  const file = existsSync(local) ? local : join(configDir, "integrations.json");
  const parsed = File.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const f = parsed.data.integrations;
  const mode = (k: IntegrationName) => parseMode(f[k].env, env[f[k].env], f[k].mode);
  const pick = (name: string, fallback: string) => (env[name] && env[name]!.trim()) || fallback;
  const abs = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));

  return {
    logonly: { ...f.logonly, mode: mode("logonly") === "off" ? "off" : "mock" },
    opendental: {
      ...f.opendental,
      mode: mode("opendental"),
      url: pick("INTEG_OPENDENTAL_URL", f.opendental.url),
      patientsFile: abs(f.opendental.patientsFile),
      developerKey: env.INTEG_OPENDENTAL_DEVELOPER_KEY ?? "",
      customerKey: env.INTEG_OPENDENTAL_CUSTOMER_KEY ?? "",
    },
    slicer: { ...f.slicer, mode: mode("slicer"), url: pick("INTEG_SLICER_URL", f.slicer.url) },
    orthanc: {
      ...f.orthanc,
      mode: mode("orthanc"),
      url: pick("INTEG_ORTHANC_URL", f.orthanc.url),
      username: env.INTEG_ORTHANC_USERNAME ?? "",
      password: env.INTEG_ORTHANC_PASSWORD ?? "",
    },
    clinicinbox: { ...f.clinicinbox, mode: mode("clinicinbox"), file: abs(pick("INTEG_CLINIC_INBOX_FILE", f.clinicinbox.file)) },
  };
}

/** Throws unless every enabled live integration has what it needs. */
export function assertLiveReady(cfg: IntegrationsConfig): void {
  const missing: string[] = [];
  if (cfg.opendental.mode === "live") {
    if (!cfg.opendental.developerKey) missing.push("INTEG_OPENDENTAL_DEVELOPER_KEY");
    if (!cfg.opendental.customerKey) missing.push("INTEG_OPENDENTAL_CUSTOMER_KEY");
  }
  if (missing.length) throw new Error(`live integrations refuse to start: missing ${missing.join(", ")}`);
}
