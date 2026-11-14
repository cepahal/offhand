/**
 * Per-app viewer config, served by the hub from config/apps/<app>.json (GET /api/apps).
 * Only the fields the viewer uses are read; anything unknown is ignored.
 *
 *   scrub.target  what hover-scrub (and the scrub slider) drives:
 *                 "clip"      sweep a clipping plane through the meshes along scrub.axis
 *                 "timepoint" step through manifest.timepoints
 *                 "slice"     move the 2D slice index (slice panel)
 *                 "motion"    a motion supplied in code by the case itself (LoadedCase.onScrub).
 *                             Frontend mocks only, so it is never read from config files.
 */
import type { RasAxis } from './logic.js';

export type ScrubTarget = 'clip' | 'timepoint' | 'slice' | 'motion';

export interface AppConfig {
  title?: string;
  scrub: { target: ScrubTarget; axis: RasAxis; label: string };
}

const DEFAULT: AppConfig = { scrub: { target: 'clip', axis: 'S', label: 'Clip' } };

export function parseAppConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT;
  const o = raw as Record<string, unknown>;
  const s = (o.scrub ?? {}) as Record<string, unknown>;
  const target: ScrubTarget =
    s.target === 'timepoint' || s.target === 'slice' || s.target === 'clip' ? s.target : 'clip';
  const axis: RasAxis = s.axis === 'R' || s.axis === 'A' || s.axis === 'S' ? s.axis : 'S';
  return {
    title: typeof o.title === 'string' ? o.title : undefined,
    scrub: { target, axis, label: typeof s.label === 'string' ? s.label : target },
  };
}
