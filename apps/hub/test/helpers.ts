import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyViewerState, type BusEnvelope, type ViewSnapshot, type ViewerState } from "@hoverscan/contracts";
import type { AiConfig } from "../src/ai/config.js";
import { createLogger } from "../src/log/logger.js";
import type { MessagingConfig } from "../src/messaging/config.js";

export function messagingConfig(overrides: Partial<MessagingConfig> = {}): MessagingConfig {
  return {
    mode: "mock",
    transport: "sdk",
    projectId: "",
    projectSecret: "",
    line: "",
    publicUrl: "",
    webhookSecret: "",
    optInKeyword: "HOVERSCAN",
    optOutKeyword: "STOP",
    pendingTtlMs: 60_000,
    mockRead: true,
    recipientsFile: join(mkdtempSync(join(tmpdir(), "hoverscan-rcp-")), "recipients.json"),
    ...overrides,
  };
}

export function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    mode: "mock",
    region: "us-east-2",
    converseModelId: "",
    guardrailId: "",
    guardrailVersion: "",
    policiesDir: join(tmpdir(), "hoverscan-no-policies"),
    casepackDir: join(tmpdir(), "hoverscan-no-casepacks"),
    ...overrides,
  };
}

export function memoryLogger(level = "debug") {
  const lines: string[] = [];
  const logger = createLogger({ level, destination: { write: (s: string) => void lines.push(s) } });
  return { logger, lines, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

export function tempDir(prefix = "hoverscan-hub-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A loaded test-pattern case; camera in front of the patient (azimuth 0), 200 mm away. */
export function state(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    ...emptyViewerState(),
    app: "chairside",
    caseId: "test-pattern",
    camera: { position: [0, 0, 200], target: [0, 0, 0], up: [0, 1, 0] },
    layers: [{ id: "outer", opacity: 1, visible: true }],
    ...overrides,
  };
}

/** The view stored inside a bookmark. */
export function viewSnapshot(overrides: Partial<ViewerState> = {}): ViewSnapshot {
  const { bookmarks: _bookmarks, pending: _pending, ...view } = state(overrides);
  return view;
}

export function cmdEnv(): BusEnvelope {
  return { ch: "cmd", cmd: { id: randomUUID(), ts: Date.now(), source: "keyboard", type: "peel", dir: "out" } };
}
