import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root: apps/hub/{src,dist}/config.(ts|js) -> ../../.. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const envFile = join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export type RunMode = 'mock' | 'live';

/**
 * HOVERSCAN_RUN is set by the root scripts, never by .env: `pnpm dev` = mock (offline, no
 * credentials, whatever .env says), `pnpm start:live` and `pnpm e2e:live` = live.
 * Unset (tests, `pnpm start`) leaves each module's own *_MODE setting alone.
 */
export const RUN_MODE: RunMode | undefined =
  process.env.HOVERSCAN_RUN === 'live' ? 'live' : process.env.HOVERSCAN_RUN === 'mock' ? 'mock' : undefined;

if (RUN_MODE === 'mock') {
  process.env.AI_MODE = 'mock';
  process.env.PHOTON_MODE = 'mock';
  for (const k of Object.keys(process.env)) {
    if (/^INTEG_[A-Z]+$/.test(k) && process.env[k]?.trim().toLowerCase() === 'live') process.env[k] = 'mock';
  }
} else if (RUN_MODE === 'live') {
  process.env.AI_MODE = 'live';
  process.env.PHOTON_MODE = 'live';
}

const str = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;
const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};
const fromRoot = (p: string): string => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

export interface GestureConfig {
  /** "auto" scans for a USB-UART bridge, "off" disables the board, anything else is a port path. */
  port: string;
  baud: number;
  debounceMs: number;
  heartbeatTimeoutMs: number;
  rescanMs: number;
}

export interface HubConfig {
  port: number;
  bind: string;
  casepackDir: string;
  logDir: string;
  snapshotDir: string;
  webDist: string;
  appConfigDir: string;
  gesture: GestureConfig;
}

export function loadConfig(): HubConfig {
  return {
    port: int('HUB_PORT', 8787),
    // Localhost only unless explicitly overridden.
    bind: str('HUB_BIND', '127.0.0.1'),
    casepackDir: fromRoot(str('CASEPACK_DIR', 'casepacks')),
    logDir: fromRoot(str('LOG_DIR', 'logs')),
    snapshotDir: fromRoot(str('SNAPSHOT_DIR', 'snapshots')),
    webDist: join(REPO_ROOT, 'apps', 'web', 'dist'),
    appConfigDir: join(REPO_ROOT, 'config', 'apps'),
    gesture: {
      port: str('GESTURE_PORT', 'auto'),
      baud: int('GESTURE_BAUD', 115200),
      debounceMs: int('GESTURE_DEBOUNCE_MS', 250),
      heartbeatTimeoutMs: int('GESTURE_HEARTBEAT_TIMEOUT_MS', 5000),
      rescanMs: int('GESTURE_RESCAN_MS', 3000),
    },
  };
}
