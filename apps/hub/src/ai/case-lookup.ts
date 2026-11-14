import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CasePackManifest, type AppId } from "@hoverscan/contracts";
import type { Logger } from "../log/logger.js";

export interface CaseLookup {
  getCase(app: AppId, caseId: string): Promise<CasePackManifest | undefined>;
}

const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/**
 * Reads <casepackDir>/<app>/<caseId>/manifest.json.
 * TODO(verify) with B: case pack folder layout, and whether the casepacks module should expose this instead.
 */
export class FileCaseLookup implements CaseLookup {
  constructor(
    private readonly casepackDir: string,
    private readonly logger: Logger,
  ) {}

  async getCase(app: AppId, caseId: string): Promise<CasePackManifest | undefined> {
    if (!SAFE_SEGMENT.test(caseId)) return undefined;
    let raw: string;
    try {
      raw = await readFile(join(this.casepackDir, app, caseId, "manifest.json"), "utf8");
    } catch {
      return undefined;
    }
    try {
      const manifest = CasePackManifest.parse(JSON.parse(raw));
      return manifest.app === app && manifest.caseId === caseId ? manifest : undefined;
    } catch {
      this.logger.warn({ app, caseId }, "case pack manifest is invalid");
      return undefined;
    }
  }
}
