import { existsSync, readFileSync } from "node:fs";
import { containsPhoneNumber, RECIPIENT_REF_PATTERN, type AppId, type ShareEvent } from "@hoverscan/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "../log/logger.js";
import type { Integration, IntegrationStatus, ShareContext } from "./integration.js";

/** Writes notes to a patient's treatment plan. */
export interface OpenDentalApi {
  appendTreatmentPlanNote(patNum: number, note: string): Promise<void>;
}

export interface MockNote {
  patNum: number;
  note: string;
  ts: number;
}

/** Keeps notes in memory for the debug page. */
export class MockOpenDental implements OpenDentalApi {
  readonly notes: MockNote[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  async appendTreatmentPlanNote(patNum: number, note: string): Promise<void> {
    this.notes.push({ patNum, note, ts: this.now() });
  }
}

const TreatPlan = z.object({ TreatPlanNum: z.number().int(), PatNum: z.number().int(), Note: z.string().default(""), TPStatus: z.string() });

export interface OpenDentalHttpOptions {
  /** e.g. https://api.opendental.com/api/v1 */
  baseUrl: string;
  developerKey: string;
  customerKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Open Dental API client (docs read 2026-11-11: opendental.com/site/apisetup.html, apitreatplans.html).
 * Live only; never constructed in mock mode.
 */
export class OpenDentalHttpClient implements OpenDentalApi {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: OpenDentalHttpOptions) {
    if (!opts.developerKey || !opts.customerKey) throw new Error("not configured");
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  /**
   * TreatPlans GET ?PatNum=&TPStatus=Active, then TreatPlans PUT /treatplans/{TreatPlanNum} with Note.
   * TODO(verify): PUT "Overwrites existing note", so this reads and appends; two writers at once could lose a line.
   * TODO(verify): which plan to annotate when a patient has several Active plans (we use the first).
   */
  async appendTreatmentPlanNote(patNum: number, note: string): Promise<void> {
    const plans = z.array(TreatPlan).parse(await this.request("GET", `/treatplans?PatNum=${encodeURIComponent(patNum)}&TPStatus=Active`));
    const plan = plans[0];
    if (!plan) throw new Error("the patient has no active treatment plan");
    const merged = plan.Note ? `${plan.Note}\n${note}` : note;
    await this.request("PUT", `/treatplans/${plan.TreatPlanNum}`, { Note: merged });
  }

  private async request(method: "GET" | "PUT", path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetch(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        // TODO(verify): developer and customer keys are sent as "Authorization: ODFHIR {DeveloperKey}/{CustomerKey}" (API Developer Setup page).
        authorization: `ODFHIR ${this.opts.developerKey}/${this.opts.customerKey}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`Open Dental ${method} ${path.split("?")[0]} returned ${res.status}`);
    return res.json();
  }
}

const PatientsFile = z.object({
  patients: z.record(z.string().regex(RECIPIENT_REF_PATTERN), z.number().int().nonnegative()),
});

/** recipientRef -> Open Dental PatNum, from config/patients.local.json (git-ignored). */
export function loadPatientMap(file: string): ReadonlyMap<string, number> {
  if (!existsSync(file)) return new Map();
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const parsed = PatientsFile.safeParse({ patients: raw.patients });
  if (!parsed.success) throw new Error(`invalid patient map ${file}: expected { "patients": { "rcp_…": PatNum } }`);
  return new Map(Object.entries(parsed.data.patients));
}

/** The note text. Built only from the option label and share id; refuses anything that looks like a phone number. */
export function buildVoteNote(ev: ShareEvent, share: ShareContext): string | undefined {
  const label = share.pollOptions.find((o) => o.id === ev.optionId)?.label;
  if (!label) return undefined;
  const verb = ev.selected === false ? "withdrew the choice" : "chose";
  const date = new Date(ev.ts).toISOString().slice(0, 10);
  const note = `HoverScan patient poll ${date}: patient ${verb} "${label}" (share ${share.shareId.slice(0, 8)}).`;
  return containsPhoneNumber(note) ? undefined : note;
}

/** ChairSide and JawLine: a patient's poll vote becomes a note on their treatment plan. */
export class OpenDentalIntegration implements Integration {
  readonly name = "opendental";
  private lastError: string | undefined;
  private readonly written = new Set<string>();

  constructor(
    readonly mode: "mock" | "live",
    readonly apps: readonly AppId[],
    readonly api: OpenDentalApi,
    private readonly patients: ReadonlyMap<string, number>,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {}

  status(): IntegrationStatus {
    return this.lastError ? { up: false, reason: this.lastError } : { up: true };
  }

  async onShareEvent(ev: ShareEvent, share: ShareContext | undefined): Promise<void> {
    if (ev.kind !== "vote") return;
    const log = this.logger.child({ integration: this.name, shareId: ev.shareId });
    if (!share) return log.warn("vote for an unknown share; no note written");
    const patNum = this.patients.get(share.recipientRef);
    if (patNum === undefined) return log.warn({ recipientRef: share.recipientRef }, "no patient mapping for this recipient; no note written");
    const key = `${ev.shareId}|${ev.optionId}|${ev.selected}|${ev.ts}`;
    if (this.written.has(key)) return;
    const note = buildVoteNote(ev, share);
    if (!note) return log.warn("vote did not produce a safe note; no note written");
    this.written.add(key);
    try {
      await this.api.appendTreatmentPlanNote(patNum, note);
      this.lastError = undefined;
      log.info({ recipientRef: share.recipientRef }, "treatment plan note written");
    } catch (err) {
      this.lastError = (err as Error).message;
      log.warn({ err: { name: (err as Error).name, message: this.lastError } }, "treatment plan note failed; not retried");
    }
  }

  registerRoutes(app: FastifyInstance): void {
    app.get("/api/integrations/opendental/notes", async (_req, reply) => {
      if (!(this.api instanceof MockOpenDental)) return reply.code(404).send({ error: "notes are only kept in mock mode" });
      return { notes: this.api.notes };
    });
  }
}
