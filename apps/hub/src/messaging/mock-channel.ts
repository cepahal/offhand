import type { ShareEvent, ShareRequest } from "@hoverscan/contracts";
import { InboundRouter, type InboundContent, type ShareLedger } from "./inbound.js";
import {
  assertSendable,
  assertSendableChanges,
  ChannelDownError,
  DuplicateShareError,
  EventEmitterSet,
  type ChannelStatus,
  type PatientChannel,
  type ShareChanges,
} from "./patient-channel.js";
import type { RecipientRegistry } from "./recipients.js";

/** Fictional number (555-01xx range) used as the simulated phone's handle. Never a real person. */
export const SIMULATED_PHONE_HANDLE = "+1 (555) 010-0142";

export const DELIVERED_AFTER_MS = 300;
export const READ_AFTER_MS = 1000;

export interface MockMessage {
  shareId: string;
  recipientRef: string;
  request: ShareRequest;
  pollGuid: string;
  messageId: string;
  sentAt: number;
  updates: ShareChanges[];
}

export interface MockChannelOptions {
  registry: RecipientRegistry;
  ledger: ShareLedger;
  router: InboundRouter;
  /** Emit "read" 1 s after send. */
  mockRead: boolean;
  now?: () => number;
}

/** In-memory channel for offline demos and tests. Nothing leaves the process. */
export class MockPatientChannel implements PatientChannel {
  readonly kind = "mock" as const;
  /** Every card "sent", keyed by shareId. */
  readonly sent = new Map<string, MockMessage>();
  private readonly attempted = new Set<string>();
  private readonly events = new EventEmitterSet();
  private readonly timers = new Set<NodeJS.Timeout>();
  private downReason: string | undefined;
  private readonly now: () => number;

  constructor(private readonly opts: MockChannelOptions) {
    this.now = opts.now ?? Date.now;
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Failure drill: make the channel refuse sends until set back to undefined. */
  setDown(reason: string | undefined): void {
    this.downReason = reason;
  }

  status(): ChannelStatus {
    return this.downReason ? { up: false, reason: this.downReason } : { up: true };
  }

  onEvent(callback: (ev: ShareEvent) => void): () => void {
    return this.events.on(callback);
  }

  async send(req: ShareRequest): Promise<void> {
    assertSendable(req);
    if (this.attempted.has(req.shareId) || this.opts.ledger.has(req.shareId)) throw new DuplicateShareError(req.shareId);
    this.attempted.add(req.shareId);
    if (this.downReason) throw new ChannelDownError(this.downReason);
    if (!this.opts.registry.has(req.recipientRef)) throw new Error("recipient is not opted in");

    const msg: MockMessage = {
      shareId: req.shareId,
      recipientRef: req.recipientRef,
      request: req,
      pollGuid: `mock-poll-${req.shareId}`,
      messageId: `mock-msg-${req.shareId}`,
      sentAt: this.now(),
      updates: [],
    };
    this.sent.set(req.shareId, msg);
    this.opts.ledger.record({
      shareId: req.shareId,
      recipientRef: req.recipientRef,
      pollGuid: msg.pollGuid,
      messageIds: [msg.messageId],
      options: req.pollOptions.map((o) => ({ optionId: o.id, label: o.label, identifier: o.id })),
    });

    this.events.emit({ shareId: req.shareId, kind: "sent", ts: this.now() });
    this.later(DELIVERED_AFTER_MS, () => this.events.emit({ shareId: req.shareId, kind: "delivered", ts: this.now() }));
    if (this.opts.mockRead) {
      this.later(READ_AFTER_MS, () => this.inbound({ type: "read", target: { id: msg.messageId } }));
    }
  }

  async update(shareId: string, changes: ShareChanges): Promise<void> {
    assertSendableChanges(changes);
    if (this.downReason) throw new ChannelDownError(this.downReason);
    const msg = this.sent.get(shareId);
    if (!msg) throw new Error(`share ${shareId} was never sent`);
    msg.updates.push(changes);
  }

  /** What the simulated phone shows: cards sent to whoever opted in from the simulated handle. */
  inbox(): { optedIn: boolean; messages: MockMessage[] } {
    const ref = this.opts.registry.refForHandle(SIMULATED_PHONE_HANDLE);
    if (!ref) return { optedIn: false, messages: [] };
    return { optedIn: true, messages: [...this.sent.values()].filter((m) => m.recipientRef === ref) };
  }

  /** The simulated phone's texts and taps enter through the same router as live Photon messages. */
  inbound(content: InboundContent): ReturnType<InboundRouter["handle"]> {
    return this.opts.router.handle({ direction: "inbound", senderHandle: SIMULATED_PHONE_HANDLE, content });
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}
