import type { AppId, PollOption, ShareEvent, ViewerCommand, ViewerState } from "@hoverscan/contracts";
import type { FastifyInstance } from "fastify";

/** What the hub knows about a share beyond the ShareEvent itself. Never includes a phone number. */
export interface ShareContext {
  shareId: string;
  app: AppId;
  caseId: string;
  recipientRef: string;
  pollOptions: readonly PollOption[];
}

/** Supplied by the messaging module. */
export interface ShareDirectory {
  shareInfo(shareId: string): ShareContext | undefined;
}

export type IntegrationStatus = { up: true } | { up: false; reason: string };

/**
 * A clinic-software integration. The hub calls onState with each ViewerState, onCommand with each
 * command, and onShareEvent with each ShareEvent the messaging module published, but only for the
 * apps the integration supports.
 */
export interface Integration {
  readonly name: string;
  readonly mode: "mock" | "live";
  readonly apps: readonly AppId[];
  start(): Promise<void>;
  stop?(): Promise<void>;
  onState?(state: ViewerState): void | Promise<void>;
  onCommand?(cmd: ViewerCommand): void | Promise<void>;
  onShareEvent?(ev: ShareEvent, share: ShareContext | undefined): void | Promise<void>;
  status(): IntegrationStatus;
  /** Debug routes under /api/integrations/<name>/. */
  registerRoutes?(app: FastifyInstance): void;
}
