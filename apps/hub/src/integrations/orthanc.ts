import type { AppId } from "@hoverscan/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "../log/logger.js";
import type { Integration, IntegrationStatus } from "./integration.js";

/** Only non-identifying study fields leave this module: no patient name, id or birth date. */
export interface StudySummary {
  studyInstanceUid: string;
  studyDate?: string | undefined;
  description?: string | undefined;
  modalities?: string[] | undefined;
}

export interface StudySource {
  listStudies(): Promise<StudySummary[]>;
}

/** Fixed demo entries. Synthetic placeholders, not from any patient or dataset. */
export const DEMO_STUDIES: readonly StudySummary[] = [
  { studyInstanceUid: "2.25.1001", studyDate: "2026-01-15", description: "DEMO study A (synthetic placeholder)", modalities: ["MR"] },
  { studyInstanceUid: "2.25.1002", studyDate: "2026-02-20", description: "DEMO study B (synthetic placeholder)", modalities: ["MR"] },
  { studyInstanceUid: "2.25.1003", studyDate: "2026-03-05", description: "DEMO study C (synthetic placeholder)", modalities: ["CT"] },
];

export class MockStudySource implements StudySource {
  async listStudies(): Promise<StudySummary[]> {
    return DEMO_STUDIES.map((s) => ({ ...s, modalities: s.modalities && [...s.modalities] }));
  }
}

/** DICOM JSON (PS3.18 F.2): { "<tag>": { vr, Value: [...] } }. */
const DicomAttr = z.object({ vr: z.string().optional(), Value: z.array(z.unknown()).optional() }).loose();
const DicomJsonStudy = z.record(z.string(), DicomAttr);

const TAG = { StudyInstanceUID: "0020000D", StudyDate: "00080020", StudyDescription: "00081030", ModalitiesInStudy: "00080061" } as const;

function strings(attr: z.infer<typeof DicomAttr> | undefined): string[] {
  return (attr?.Value ?? []).filter((v): v is string => typeof v === "string");
}

/** "20260115" -> "2026-01-15". */
function isoDate(d: string | undefined): string | undefined {
  return d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

export interface OrthancOptions {
  /** DICOMweb root, e.g. http://localhost:8042/dicom-web (the plugin's "Root" option). */
  baseUrl: string;
  username?: string;
  password?: string;
  fetch?: typeof fetch;
}

/**
 * QIDO-RS study search: GET {root}/studies (Orthanc Book, DICOMweb plugin, read 2026-11-11:
 * "curl http://localhost:8042/dicom-web/studies"). Live only.
 */
export class OrthancDicomWebClient implements StudySource {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: OrthancOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  async listStudies(): Promise<StudySummary[]> {
    const headers: Record<string, string> = { accept: "application/dicom+json" };
    if (this.opts.username) {
      // TODO(verify): the clinic's Orthanc uses HTTP Basic auth ("RegisteredUsers") rather than a token or proxy.
      headers.authorization = `Basic ${Buffer.from(`${this.opts.username}:${this.opts.password ?? ""}`).toString("base64")}`;
    }
    const res = await this.fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/studies`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Orthanc QIDO-RS returned ${res.status}`);
    const body = z.array(DicomJsonStudy).parse(await res.json());
    return body.flatMap((study) => {
      const uid = strings(study[TAG.StudyInstanceUID])[0];
      if (!uid) return [];
      const modalities = strings(study[TAG.ModalitiesInStudy]);
      return [
        {
          studyInstanceUid: uid,
          studyDate: isoDate(strings(study[TAG.StudyDate])[0]),
          description: strings(study[TAG.StudyDescription])[0],
          modalities: modalities.length ? modalities : undefined,
        },
      ];
    });
  }
}

/** KneeView and NeuroView: lists studies for the debug page and future case loading. */
export class OrthancIntegration implements Integration {
  readonly name = "orthanc";
  private lastError: string | undefined;

  constructor(
    readonly mode: "mock" | "live",
    readonly apps: readonly AppId[],
    readonly source: StudySource,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {}

  status(): IntegrationStatus {
    return this.lastError ? { up: false, reason: this.lastError } : { up: true };
  }

  async listStudies(): Promise<StudySummary[]> {
    try {
      const studies = await this.source.listStudies();
      this.lastError = undefined;
      return studies;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.logger.warn({ integration: this.name, err: { message: this.lastError } }, "Orthanc study list failed");
      throw err;
    }
  }

  registerRoutes(app: FastifyInstance): void {
    app.get("/api/integrations/orthanc/studies", async (_req, reply) => {
      try {
        return { studies: await this.listStudies() };
      } catch {
        return reply.code(502).send({ error: "Orthanc is unavailable" });
      }
    });
  }
}
