import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CasePackManifest } from '@offhand/contracts';

export interface CaseSummary {
  app: string;
  caseId: string;
  title: string;
  dataset: string;
  license: string;
  layers: number;
  volumes: number;
  findings: number;
  /** URL prefix the viewer loads files from. */
  baseUrl: string;
}

export interface InvalidCase {
  path: string;
  errors: string[];
}

export interface ScanResult {
  cases: Map<string, { summary: CaseSummary; manifest: CasePackManifest; dir: string }>;
  invalid: InvalidCase[];
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Validate one case folder: manifest parses, ids match the folder, every referenced file exists. */
export function checkCase(dir: string, app: string, caseId: string): { manifest?: CasePackManifest; errors: string[] } {
  const mPath = join(dir, 'manifest.json');
  if (!existsSync(mPath)) return { errors: ['manifest.json missing'] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(mPath, 'utf8'));
  } catch (e) {
    return { errors: [`manifest.json is not JSON: ${(e as Error).message}`] };
  }
  const parsed = CasePackManifest.safeParse(json);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const m = parsed.data;
  const errors: string[] = [];
  if (m.app !== app) errors.push(`manifest app "${m.app}" != folder "${app}"`);
  if (m.caseId !== caseId) errors.push(`manifest caseId "${m.caseId}" != folder "${caseId}"`);
  const files = [...m.layers.map((l) => l.file), ...m.volumes.map((v) => v.file)];
  for (const f of files) if (!existsSync(join(dir, f))) errors.push(`missing file: ${f}`);
  const layerIds = new Set(m.layers.map((l) => l.id));
  for (const f of m.findings)
    if (f.layerId && !layerIds.has(f.layerId)) errors.push(`finding ${f.id}: unknown layerId ${f.layerId}`);
  const tpIds = new Set((m.timepoints ?? []).map((t) => t.id));
  for (const v of m.volumes)
    if (v.timepointId && !tpIds.has(v.timepointId)) errors.push(`volume ${v.id}: unknown timepointId ${v.timepointId}`);
  return errors.length ? { manifest: m, errors } : { manifest: m, errors: [] };
}

/** Scan <root>/<app>/<caseId>/manifest.json. Invalid packs are reported, never served. */
export function scanCasepacks(root: string): ScanResult {
  const result: ScanResult = { cases: new Map(), invalid: [] };
  if (!isDir(root)) return result;
  for (const app of readdirSync(root).sort()) {
    const appDir = join(root, app);
    if (!isDir(appDir)) continue;
    for (const caseId of readdirSync(appDir).sort()) {
      const dir = join(appDir, caseId);
      if (!isDir(dir)) continue;
      const { manifest, errors } = checkCase(dir, app, caseId);
      if (errors.length || !manifest) {
        result.invalid.push({ path: `${app}/${caseId}`, errors });
        continue;
      }
      result.cases.set(`${app}/${caseId}`, {
        manifest,
        dir,
        summary: {
          app,
          caseId,
          title: manifest.title,
          dataset: manifest.source.dataset,
          license: manifest.source.license,
          layers: manifest.layers.length,
          volumes: manifest.volumes.length,
          findings: manifest.findings.length,
          baseUrl: `/casepacks/${encodeURIComponent(app)}/${encodeURIComponent(caseId)}/`,
        },
      });
    }
  }
  return result;
}
