/**
 * Connection to the hub: one WebSocket (/ws) for bus envelopes + small REST helpers.
 * Reconnects with back-off. The hub validates every envelope; the viewer trusts what it receives.
 */
import type { BusEnvelope, CasePackManifest } from '@hoverscan/contracts';

export type HubStatus = 'connecting' | 'open' | 'closed';

export interface CaseSummary {
  app: string;
  caseId: string;
  title: string;
  dataset: string;
  license: string;
  layers: number;
  volumes: number;
  findings: number;
  baseUrl: string;
}

export interface InvalidCase {
  path: string;
  errors: string[];
}

export interface ModuleHealth {
  status: 'mock' | 'live' | 'error';
  detail: string;
}

export interface Health {
  ok: boolean;
  contractsVersion: string;
  uptimeS: number;
  modules: Record<string, ModuleHealth>;
}

type Listener = (env: BusEnvelope) => void;

export class HubClient {
  status: HubStatus = 'closed';
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: HubStatus) => void>();
  private retryMs = 500;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {}

  connect(): void {
    if (this.ws) return;
    this.stopped = false;
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 500;
      this.setStatus('open');
    };
    ws.onmessage = (e) => {
      let env: BusEnvelope;
      try {
        env = JSON.parse(String(e.data)) as BusEnvelope;
      } catch {
        return;
      }
      this.listeners.forEach((fn) => fn(env));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('closed');
      if (this.stopped) return;
      this.timer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
  }

  /** Send an envelope. Returns false when the socket is not open. */
  send(env: BusEnvelope): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(env));
    return true;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: HubStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }

  private setStatus(s: HubStatus): void {
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const api = {
  cases: () => getJson<{ cases: CaseSummary[]; invalid: InvalidCase[] }>('/api/cases'),
  manifest: (app: string, caseId: string) =>
    getJson<CasePackManifest>(`/api/cases/${encodeURIComponent(app)}/${encodeURIComponent(caseId)}`),
  apps: () => getJson<Record<string, unknown>>('/api/apps'),
  health: () => getJson<Health>('/api/health'),
  async snapshot(requestId: string, dataUrl: string): Promise<string> {
    const r = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, dataUrl }),
    });
    if (!r.ok) throw new Error(`snapshot: HTTP ${r.status}`);
    return ((await r.json()) as { url: string }).url;
  },
};
