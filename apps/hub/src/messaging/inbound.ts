import type { ShareEvent } from "@hoverscan/contracts";
import type { Logger } from "../log/logger.js";
import type { InboundTextOutcome, RecipientRegistry } from "./recipients.js";

/**
 * The subset of a Spectrum inbound message the hub uses. Field names follow spectrum-ts 12.16
 * (Message.direction, content.type "text" | "poll_option" | "read"; poll_option.option.optionIdentifier,
 * poll_option.selected, poll_option.pollMessageGuid / poll.pollMessageGuid; read.target.id).
 * The simulated phone posts this same shape, so mock and live votes take one path.
 */
export type InboundContent =
  | { type: "text"; text: string }
  | {
      type: "poll_option";
      option: { title: string; optionIdentifier?: string | undefined };
      poll?: { pollMessageGuid?: string | undefined } | undefined;
      pollMessageGuid?: string | undefined;
      selected: boolean;
    }
  | { type: "read"; target: { id: string } };

export interface InboundMessage {
  direction: "inbound" | "outbound";
  /** Sender phone or email. Stays inside the messaging module. */
  senderHandle?: string | undefined;
  content: InboundContent;
}

export interface LedgerOption {
  optionId: string;
  label: string;
  /** Provider option identifier, when known. */
  identifier?: string | undefined;
}

export interface LedgerEntry {
  shareId: string;
  recipientRef: string;
  pollGuid?: string | undefined;
  messageIds: string[];
  options: LedgerOption[];
  read: boolean;
}

/** Links provider message and poll ids back to shares. */
export class ShareLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  has(shareId: string): boolean {
    return this.entries.has(shareId);
  }

  get(shareId: string): LedgerEntry | undefined {
    return this.entries.get(shareId);
  }

  record(entry: Omit<LedgerEntry, "read">): LedgerEntry {
    const full = { ...entry, read: false };
    this.entries.set(entry.shareId, full);
    return full;
  }

  byPollGuid(guid: string): LedgerEntry | undefined {
    for (const e of this.entries.values()) if (e.pollGuid === guid) return e;
    return undefined;
  }

  byMessageId(id: string): LedgerEntry | undefined {
    for (const e of this.entries.values()) if (e.messageIds.includes(id) || e.pollGuid === id) return e;
    return undefined;
  }
}

export interface InboundRouterDeps {
  registry: RecipientRegistry;
  ledger: ShareLedger;
  emit: (ev: ShareEvent) => void;
  onOptIn?: (outcome: Exclude<InboundTextOutcome, { kind: "ignored" }>) => void;
  /** Every inbound text, including ones the opt-in registry ignores. The handle stays inside messaging. */
  onText?: (handle: string, text: string, outcome: InboundTextOutcome) => void;
  logger: Logger;
  now?: () => number;
}

/** Maps a vote to our option id: provider identifier first, then a unique label match. */
function resolveOption(entry: LedgerEntry, option: { title: string; optionIdentifier?: string | undefined }): string | undefined {
  if (option.optionIdentifier) {
    const byId = entry.options.find((o) => o.identifier === option.optionIdentifier);
    if (byId) return byId.optionId;
  }
  const byLabel = entry.options.filter((o) => o.label === option.title);
  return byLabel.length === 1 ? byLabel[0]!.optionId : undefined;
}

/** One inbound path for every channel: opt-in texts, votes and read receipts. */
export class InboundRouter {
  private readonly now: () => number;

  constructor(private readonly deps: InboundRouterDeps) {
    this.now = deps.now ?? Date.now;
  }

  handle(msg: InboundMessage): InboundTextOutcome | undefined {
    if (msg.direction !== "inbound") return undefined;
    const { content } = msg;
    const log = this.deps.logger;

    if (content.type === "text") {
      if (!msg.senderHandle) return { kind: "ignored" };
      const outcome = this.deps.registry.handleInboundText(msg.senderHandle, content.text);
      this.deps.onText?.(msg.senderHandle, content.text, outcome);
      if (outcome.kind !== "ignored") {
        log.info({ recipientRef: outcome.ref, kind: outcome.kind }, "recipient opt-in changed");
        this.deps.onOptIn?.(outcome);
      }
      return outcome;
    }

    if (content.type === "poll_option") {
      const guid = content.pollMessageGuid ?? content.poll?.pollMessageGuid;
      const entry = guid ? this.deps.ledger.byPollGuid(guid) : undefined;
      if (!entry) {
        log.warn("dropped a vote for an unknown poll");
        return undefined;
      }
      const senderRef = msg.senderHandle ? this.deps.registry.refForHandle(msg.senderHandle) : undefined;
      if (senderRef !== entry.recipientRef) {
        log.warn({ shareId: entry.shareId }, "dropped a vote from someone other than the share's recipient");
        return undefined;
      }
      const optionId = resolveOption(entry, content.option);
      if (!optionId) {
        log.warn({ shareId: entry.shareId }, "dropped a vote for an option the share did not offer");
        return undefined;
      }
      this.deps.emit({ shareId: entry.shareId, kind: "vote", optionId, selected: content.selected, ts: this.now() });
      return undefined;
    }

    const entry = this.deps.ledger.byMessageId(content.target.id);
    if (entry && !entry.read) {
      entry.read = true;
      this.deps.emit({ shareId: entry.shareId, kind: "read", ts: this.now() });
    }
    return undefined;
  }
}
