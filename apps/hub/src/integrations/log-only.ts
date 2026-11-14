import { cameraOrbit, type AppId, type ShareEvent, type ViewerCommand, type ViewerState } from "@hoverscan/contracts";
import type { FastifyInstance } from "fastify";
import { redactPhone, type Logger } from "../log/logger.js";
import type { Integration, IntegrationStatus, ShareContext } from "./integration.js";

export interface LogOnlyEntry {
  ts: number;
  kind: "state" | "command" | "share";
  summary: string;
}

const MAX_ENTRIES = 200;

/** Prints what an integration would have sent. Needs nothing; always available when INTEG_LOGONLY is on. */
export class LogOnlyIntegration implements Integration {
  readonly name = "logonly";
  readonly mode = "mock" as const;
  readonly entries: LogOnlyEntry[] = [];
  private lastState = "";

  constructor(
    readonly apps: readonly AppId[],
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async start(): Promise<void> {}

  status(): IntegrationStatus {
    return { up: true };
  }

  onState(s: ViewerState): void {
    const { azimuth, elevation } = cameraOrbit(s.camera.position, s.camera.target);
    const summary = `${s.app}/${s.caseId} camera az=${Math.round(azimuth)} el=${Math.round(elevation)} slice=${s.slice.plane}:${s.slice.index}`;
    if (summary === this.lastState) return;
    this.lastState = summary;
    this.record("state", summary);
  }

  onCommand(cmd: ViewerCommand): void {
    this.record("command", `${cmd.type} from ${cmd.source}`);
  }

  onShareEvent(ev: ShareEvent, share: ShareContext | undefined): void {
    const option = ev.optionId ? ` option=${ev.optionId}${ev.selected === false ? " (removed)" : ""}` : "";
    this.record("share", `${ev.kind} share=${ev.shareId}${share ? ` recipient=${share.recipientRef}` : ""}${option}`);
  }

  registerRoutes(app: FastifyInstance): void {
    app.get("/api/integrations/logonly/entries", async () => ({ entries: this.entries }));
  }

  private record(kind: LogOnlyEntry["kind"], summary: string): void {
    const entry = { ts: this.now(), kind, summary: redactPhone(summary) };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.logger.info({ integration: this.name, kind }, `would send: ${entry.summary}`);
  }
}
