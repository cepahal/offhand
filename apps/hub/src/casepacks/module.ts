import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { HubContext, HubModule } from '../modules.js';
import { scanCasepacks, type ScanResult } from './scan.js';

/**
 * Serves validated case packs from CASEPACK_DIR and the per-app viewer config from config/apps.
 *   GET /api/cases                 -> { cases: CaseSummary[], invalid: InvalidCase[] }
 *   GET /api/cases/:app/:caseId    -> CasePackManifest
 *   GET /api/apps                  -> { [app]: config/apps/<app>.json }
 *   GET /casepacks/<app>/<case>/*  -> files
 */
export function createCasepackModule(ctx: HubContext): HubModule {
  const { cfg, log } = ctx;
  let scan: ScanResult = { cases: new Map(), invalid: [] };

  const rescan = (): void => {
    scan = scanCasepacks(cfg.casepackDir);
    for (const bad of scan.invalid) log.warn({ errors: bad.errors }, `casepacks: ${bad.path} is invalid, not served`);
    log.info(`casepacks: ${scan.cases.size} valid, ${scan.invalid.length} invalid in ${cfg.casepackDir}`);
  };

  const appConfigs = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!existsSync(cfg.appConfigDir)) return out;
    for (const f of readdirSync(cfg.appConfigDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(cfg.appConfigDir, f), 'utf8'));
      } catch (e) {
        log.warn(`config/apps/${f}: ${(e as Error).message}`);
      }
    }
    return out;
  };

  return {
    name: 'casepacks',
    start: rescan,
    health: () => {
      if (scan.cases.size === 0)
        return {
          status: 'error',
          detail: `No valid case packs in ${cfg.casepackDir}. Run "pnpm testpattern".`,
        };
      const bad = scan.invalid.length ? `, ${scan.invalid.length} invalid` : '';
      return { status: 'live', detail: `${scan.cases.size} case pack(s)${bad}` };
    },
    async registerRoutes(app) {
      app.get('/api/cases', async () => ({
        cases: [...scan.cases.values()].map((c) => c.summary),
        invalid: scan.invalid,
      }));
      app.post('/api/cases/rescan', async () => {
        rescan();
        return { valid: scan.cases.size, invalid: scan.invalid.length };
      });
      app.get<{ Params: { app: string; caseId: string } }>('/api/cases/:app/:caseId', async (req, reply) => {
        const c = scan.cases.get(`${req.params.app}/${req.params.caseId}`);
        if (!c) return reply.code(404).send({ error: 'case not found' });
        return c.manifest;
      });
      app.get('/api/apps', async () => appConfigs());
      await app.register(fastifyStatic, {
        root: cfg.casepackDir,
        prefix: '/casepacks/',
        decorateReply: false,
        index: false,
        list: false,
      });
    },
  };
}
