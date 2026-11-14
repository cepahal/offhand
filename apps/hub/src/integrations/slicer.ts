import { isAbsolute, relative, resolve } from "node:path";
import { cameraOrbit, type AppId, type CasePackManifest, type SlicePlane, type ViewerState } from "@hoverscan/contracts";
import type { FastifyInstance } from "fastify";
import type { CaseLookup } from "../ai/case-lookup.js";
import type { Logger } from "../log/logger.js";
import type { Integration, IntegrationStatus } from "./integration.js";
import { niftiDims } from "./slicer-volume.js";

/**
 * The only Slicer WebServer requests this integration may make, all documented in the Slicer
 * WebServer module docs (slicer.readthedocs.io/en/latest/user_guide/modules/webserver.html, read 2026-11-11):
 *   GET    /slicer/slice      view=red|yellow|green, orientation=axial|sagittal|coronal, scrollTo=0..1
 *   GET    /slicer/threeD     lookFromAxis=L|R|A|P|I|S
 *   POST   /slicer/mrml/file  localfile=<path>, filetype=VolumeFile   (load the case's volume)
 *   DELETE /slicer/mrml/file  id=<node id>                            (unload the volume we loaded)
 * Nothing else is ever requested, least of all the endpoint that runs Python.
 */
export const SLICER_ENDPOINTS = ["/slicer/slice", "/slicer/threeD", "/slicer/mrml/file"] as const;
export type SlicerEndpoint = (typeof SLICER_ENDPOINTS)[number];
export type SlicerMethod = "GET" | "POST" | "DELETE";
const ALLOWED: ReadonlySet<string> = new Set(["GET /slicer/slice", "GET /slicer/threeD", "POST /slicer/mrml/file", "DELETE /slicer/mrml/file"]);

export const ALLOWED_SLICER_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

/** Parses the Slicer base URL and throws unless the host is 127.0.0.1 or localhost over plain HTTP(S). */
export function assertLocalSlicerUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Slicer URL is not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Slicer URL must be http or https");
  if (!ALLOWED_SLICER_HOSTS.has(url.hostname)) throw new Error(`Slicer must be on 127.0.0.1 or localhost, not ${url.hostname}`);
  if (url.username || url.password) throw new Error("Slicer URL must not carry credentials");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Slicer URL must be a bare origin, e.g. http://localhost:2016");
  return url;
}

export interface SlicerCall {
  method: SlicerMethod;
  endpoint: SlicerEndpoint;
  params: Record<string, string>;
  ts: number;
}

export interface SlicerTransport {
  /** Returns the parsed JSON body when Slicer answers with JSON, else undefined. */
  request(method: SlicerMethod, endpoint: SlicerEndpoint, params: Record<string, string>): Promise<unknown>;
}

function assertAllowed(method: SlicerMethod, endpoint: string): void {
  if (!ALLOWED.has(`${method} ${endpoint}`)) throw new Error(`Slicer request not allowed: ${method} ${endpoint}`);
}

/** Records calls instead of sending them. */
export class RecordingSlicerTransport implements SlicerTransport {
  readonly calls: SlicerCall[] = [];
  private nodes = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async request(method: SlicerMethod, endpoint: SlicerEndpoint, params: Record<string, string>): Promise<unknown> {
    assertAllowed(method, endpoint);
    this.calls.push({ method, endpoint, params, ts: this.now() });
    if (method === "POST") return { success: true, loadedNodeIDs: [`vtkMRMLScalarVolumeNode${++this.nodes}`] };
    return undefined;
  }
}

/** Plain requests to the local WebServer; redirects are refused so a request can never leave localhost. */
export class HttpSlicerTransport implements SlicerTransport {
  constructor(
    private readonly base: URL,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async request(method: SlicerMethod, endpoint: SlicerEndpoint, params: Record<string, string>): Promise<unknown> {
    assertAllowed(method, endpoint);
    const url = new URL(endpoint, this.base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!ALLOWED_SLICER_HOSTS.has(url.hostname)) throw new Error("refusing a non-local Slicer request");
    const res = await this.fetchFn(url, { method, redirect: "error", signal: AbortSignal.timeout(method === "POST" ? 30_000 : 4_000) });
    const type = res.headers.get("content-type") ?? "";
    const body = type.includes("json") ? ((await res.json()) as unknown) : (await res.arrayBuffer(), undefined);
    if (!res.ok) {
      const msg = body && typeof body === "object" && "message" in body ? `: ${String((body as { message: unknown }).message).slice(0, 200)}` : "";
      throw new Error(`Slicer ${method} ${endpoint} returned ${res.status}${msg}`);
    }
    return body;
  }
}

/** Slicer's default slice views: red = axial, yellow = sagittal, green = coronal. */
const VIEW_FOR_PLANE: Record<SlicePlane, string> = { axial: "red", sagittal: "yellow", coronal: "green" };
/** Volume axis each plane scrolls along, for the canonical RAS volumes the pipeline writes. */
const AXIS_FOR_PLANE: Record<SlicePlane, 0 | 1 | 2> = { sagittal: 0, coronal: 1, axial: 2 };

/**
 * Nearest axis Slicer can look from, for angles from cameraOrbit(): azimuth 0 = camera anterior (A),
 * 90 = right (R), 180 = posterior (P), 270 = left (L); elevation beyond ±45 = superior (S) or inferior (I).
 * TODO(verify) in a running Slicer that lookFromAxis=A puts the camera anterior of the patient.
 */
export function lookFromAxis(azimuth: number, elevation: number): "L" | "R" | "A" | "P" | "I" | "S" {
  if (elevation > 45) return "S";
  if (elevation < -45) return "I";
  const a = ((azimuth % 360) + 360) % 360;
  if (a >= 315 || a < 45) return "A";
  if (a < 135) return "R";
  if (a < 225) return "P";
  return "L";
}

/** Slice index as Slicer's 0..1 scrollTo, rounded to 3 places. */
export function scrollTo(index: number, maxIndex: number): string {
  return Math.min(1, Math.max(0, maxIndex > 0 ? index / maxIndex : 0)).toFixed(3);
}

/** The case volume for the state's timepoint: the one tagged with that timepoint, else the first. */
export function volumeForState(m: CasePackManifest, timepoint: number): CasePackManifest["volumes"][number] | undefined {
  const ordered = [...(m.timepoints ?? [])].sort((a, b) => a.order - b.order);
  const tp = ordered[Math.min(Math.max(timepoint, 0), ordered.length - 1)];
  return (tp && m.volumes.find((v) => v.timepointId === tp.id)) ?? m.volumes[0];
}

interface LoadedVolume {
  file: string;
  nodeId: string | undefined;
  maxIndex: [number, number, number];
}

export interface SlicerIntegrationOptions {
  /** Case packs, for the volume of the current case and timepoint. Without it, no volume is loaded. */
  cases?: CaseLookup;
  casepackDir?: string;
}

/** KneeView and NeuroView: mirrors the case volume, camera and slice from ViewerState into a local 3D Slicer. */
export class SlicerIntegration implements Integration {
  readonly name = "slicer";
  private readonly last = new Map<string, string>();
  private readonly busy = new Set<string>();
  private readonly queued = new Map<string, Record<string, string>>();
  private volume: LoadedVolume | undefined;
  private volumeLoading: Promise<void> | undefined;
  private lastError: string | undefined;

  constructor(
    readonly mode: "mock" | "live",
    readonly apps: readonly AppId[],
    readonly transport: SlicerTransport,
    /** Used only when no case volume is known (e.g. a case without volumes). */
    private readonly sliceMaxIndex: Record<SlicePlane, number>,
    private readonly logger: Logger,
    private readonly opts: SlicerIntegrationOptions = {},
  ) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    const nodeId = this.volume?.nodeId;
    this.volume = undefined;
    if (nodeId) await this.transport.request("DELETE", "/slicer/mrml/file", { id: nodeId }).catch(() => undefined);
  }

  status(): IntegrationStatus {
    return this.lastError ? { up: false, reason: this.lastError } : { up: true };
  }

  /** The volume file currently loaded in Slicer, relative to the case pack folder. */
  loadedVolume(): string | undefined {
    return this.volume && this.opts.casepackDir ? relative(this.opts.casepackDir, this.volume.file) : this.volume?.file;
  }

  async onState(s: ViewerState): Promise<void> {
    await this.syncVolume(s);
    const plane = s.slice.plane;
    const { azimuth, elevation } = cameraOrbit(s.camera.position, s.camera.target);
    const max = this.volume ? this.volume.maxIndex[AXIS_FOR_PLANE[plane]] : this.sliceMaxIndex[plane];
    const tasks: Promise<void>[] = [];
    // Slicer answers /slicer/slice with a 500 while its scene has no volume, so only scroll once one is loaded.
    if (this.volume || !this.opts.cases) {
      // TODO(verify) in a running Slicer that scrollTo 0 is the low-index (R/A/S-most negative) slice of a RAS volume.
      tasks.push(this.update("/slicer/slice", { view: VIEW_FOR_PLANE[plane], orientation: plane, scrollTo: scrollTo(s.slice.index, max) }));
    }
    tasks.push(this.update("/slicer/threeD", { lookFromAxis: lookFromAxis(azimuth, elevation) }));
    await Promise.all(tasks);
  }

  registerRoutes(app: FastifyInstance): void {
    app.get("/api/integrations/slicer/calls", async (_req, reply) => {
      if (!(this.transport instanceof RecordingSlicerTransport)) return reply.code(404).send({ error: "calls are only recorded in mock mode" });
      return { calls: this.transport.calls };
    });
    app.get("/api/integrations/slicer/status", async () => ({ mode: this.mode, status: this.status(), volume: this.loadedVolume() ?? null }));
  }

  /** Keeps exactly one volume, the one for the current case and timepoint, loaded in Slicer. */
  private async syncVolume(s: ViewerState): Promise<void> {
    const { cases, casepackDir } = this.opts;
    if (!cases || !casepackDir || !s.app || !s.caseId) return;
    while (this.volumeLoading) await this.volumeLoading;
    const manifest = await cases.getCase(s.app, s.caseId);
    const vol = manifest && volumeForState(manifest, s.timepoint);
    if (!vol) return;
    const caseDir = resolve(casepackDir, s.app, s.caseId);
    const file = resolve(caseDir, vol.file);
    const rel = relative(caseDir, file);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("volume path leaves the case folder");
    if (this.volume?.file === file) return;

    this.volumeLoading = (async () => {
      try {
        const dims = await niftiDims(file);
        const old = this.volume?.nodeId;
        if (old) await this.transport.request("DELETE", "/slicer/mrml/file", { id: old });
        const res = (await this.transport.request("POST", "/slicer/mrml/file", { localfile: file, filetype: "VolumeFile" })) as
          | { success?: boolean; loadedNodeIDs?: string[] }
          | undefined;
        if (res && res.success === false) throw new Error("Slicer could not load the volume");
        this.volume = { file, nodeId: res?.loadedNodeIDs?.[0], maxIndex: [dims[0] - 1, dims[1] - 1, dims[2] - 1] };
        this.last.delete("/slicer/slice");
        this.lastError = undefined;
        this.logger.info({ integration: this.name, volume: relative(casepackDir, file) }, "volume loaded in Slicer");
      } catch (err) {
        this.lastError = (err as Error).message;
        this.logger.warn({ integration: this.name, err: { message: this.lastError } }, "Slicer volume load failed");
      } finally {
        this.volumeLoading = undefined;
      }
    })();
    await this.volumeLoading;
  }

  /** Sends only changes; while a request is in flight, only the newest pending update is kept. */
  private async update(endpoint: "/slicer/slice" | "/slicer/threeD", params: Record<string, string>): Promise<void> {
    const key = JSON.stringify(params);
    if (this.last.get(endpoint) === key && !this.queued.has(endpoint)) return;
    if (this.busy.has(endpoint)) {
      this.queued.set(endpoint, params);
      return;
    }
    this.busy.add(endpoint);
    let next: Record<string, string> | undefined = params;
    try {
      while (next) {
        const k = JSON.stringify(next);
        if (this.last.get(endpoint) !== k) {
          try {
            await this.transport.request("GET", endpoint, next);
            this.last.set(endpoint, k);
            this.lastError = undefined;
          } catch (err) {
            this.lastError = (err as Error).message;
            this.logger.warn({ integration: this.name, endpoint, err: { message: this.lastError } }, "Slicer update failed");
          }
        }
        next = this.queued.get(endpoint);
        this.queued.delete(endpoint);
      }
    } finally {
      this.busy.delete(endpoint);
    }
  }
}
