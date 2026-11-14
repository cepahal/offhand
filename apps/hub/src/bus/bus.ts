import { BusEnvelope, type ViewerState } from '@hoverscan/contracts';
import type { SessionLog } from '../log/logger.js';

export type BusListener = (env: BusEnvelope, origin: string) => void;

export type PublishResult = { ok: true; env: BusEnvelope } | { ok: false; error: string };

/**
 * The single message bus. Every envelope is validated against the contracts before it is
 * fanned out, recorded to the session log, and (for state) cached for late joiners.
 */
export class Bus {
  private listeners = new Set<BusListener>();
  private latest: ViewerState | null = null;

  constructor(private readonly session?: SessionLog) {}

  publish(raw: unknown, origin: string): PublishResult {
    const parsed = BusEnvelope.safeParse(raw);
    if (!parsed.success) {
      const error = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { ok: false, error };
    }
    const env = parsed.data;
    if (env.ch === 'state') this.latest = env.state;
    this.session?.write(origin, env);
    for (const fn of this.listeners) {
      try {
        fn(env, origin);
      } catch {
        // A faulty listener must not break the bus.
      }
    }
    return { ok: true, env };
  }

  subscribe(fn: BusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get latestState(): ViewerState | null {
    return this.latest;
  }
}
