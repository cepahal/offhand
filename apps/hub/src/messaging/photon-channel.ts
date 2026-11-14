import { join } from "node:path";
import type { ShareEvent, ShareRequest } from "@hoverscan/contracts";
import type { ContentInput, Message, Space } from "@spectrum-ts/core";
import { redactPhone, type Logger } from "../log/logger.js";
import { maskLine, webhookUrl, type MessagingConfig } from "./config.js";
import type { InboundMessage, InboundRouter, LedgerOption, ShareLedger } from "./inbound.js";
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
import { isRegistrationConfirmation, SIDE_EFFECT_OPTIONS, SIDE_EFFECT_POLL_TITLE } from "./demo-messages.js";
import type { RecipientRegistry } from "./recipients.js";
import { loadSpectrumSdk, type PhotonConnection, type PhotonSdk, type RawWebhookRequest, type RawWebhookResult } from "./spectrum-sdk.js";

const SNAPSHOT_PATH = /^\/snapshots\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png)$/;
/** Non-medical UI copy only. */
export const POLL_TITLE = "Please choose one";
export const OPT_IN_REPLY = "You're signed up to receive messages from your care team. Reply STOP to opt out.";
export const OPT_OUT_REPLY = "You won't receive more messages. Text the keyword again to opt back in.";
export const RECONNECTING = "reconnecting";
export const DEFAULT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
const SEEN_LIMIT = 2_000;

export interface PhotonChannelDeps {
  registry: RecipientRegistry;
  /** In-memory handle for a demonstration role. Never read from disk. */
  resolveHandle?: (ref: string) => string | undefined;
  ledger: ShareLedger;
  router: InboundRouter;
  logger: Logger;
  /** Where POST /api/snapshots stores PNGs; snapshots are attached from disk. */
  snapshotDir: string;
  now?: () => number;
  /** The spectrum-ts surface; defaults to the installed SDK. Tests pass a fake. */
  sdk?: PhotonSdk | (() => Promise<PhotonSdk>);
  /** Reconnect delays; the last one repeats. */
  backoffMs?: readonly number[];
  /** How often and how long to look for the delivered flag after a send; 0 turns it off. */
  deliveredPoll?: { everyMs: number; forMs: number };
  /** Receives the one-line startup message (never contains the full line number). */
  announce?: (line: string) => void;
  /**
   * Registration listener. When set, inbound text does not opt anyone in and
   * the only send is space.send(text()) of a registration confirmation.
   */
  listen?: {
    onText(handle: string, text: string): string | undefined;
  };
}

interface SentCard {
  space: Space;
  textMessage: Message | undefined;
  miniAppMessage: Message | undefined;
  /** The verified text as last sent (or edited). Shown by GET /share/:shareId, the card's link. */
  text: string;
}

/** Spectrum Message -> the hub's inbound shape. Field names checked against spectrum-ts 12.16 types. */
export function toInbound(message: Message): InboundMessage | undefined {
  // TODO(verify): iMessage puts the E.164 handle in sender.address (IMessageMessage); sender.id as fallback.
  const sender = message.sender as ({ address?: string } & Message["sender"]) | undefined;
  const senderHandle = sender?.address ?? sender?.id;
  const c = message.content;
  switch (c.type) {
    case "text":
      return { direction: message.direction, senderHandle, content: { type: "text", text: c.text } };
    case "poll_option":
      // TODO(verify): live votes carry option.optionIdentifier and pollMessageGuid as the docs describe.
      return {
        direction: message.direction,
        senderHandle,
        content: {
          type: "poll_option",
          option: { title: c.option.title, optionIdentifier: c.option.optionIdentifier },
          poll: { pollMessageGuid: c.poll.pollMessageGuid },
          pollMessageGuid: c.pollMessageGuid,
          selected: c.selected,
        },
      };
    case "read":
      // TODO(verify): read receipts arrive only if the patient enabled Send Read Receipts.
      return { direction: message.direction, senderHandle, content: { type: "read", target: { id: c.target.id } } };
    default:
      return undefined;
  }
}

const digits = (s: string) => s.replace(/\D/g, "");
/**
 * Installed @spectrum-ts/imessage 12.16.0 uses the literal "shared" as space.phone
 * when the project token type is "shared" (SHARED_PHONE). That is this line.
 */
const SHARED_LINE = "shared";

/** True when the message's iMessage space names a different line than ours. */
function forAnotherLine(space: Space, line: string): boolean {
  // Stable iMessage routing doc: space.phone is the line handling the conversation.
  const phone = (space as Space & { phone?: unknown }).phone;
  if (typeof phone !== "string" || phone === "" || phone === SHARED_LINE) return false;
  const theirs = digits(phone);
  const ours = digits(line);
  if (theirs === ours) return false;
  const [short, long] = theirs.length < ours.length ? [theirs, ours] : [ours, theirs];
  return !(short.length >= 10 && long.endsWith(short));
}

function deliveredFlag(m: Message | undefined): boolean {
  // TODO(verify): IMessageMessage exposes isDelivered / dateDelivered on getMessage() results.
  const meta = m as (Message & { isDelivered?: boolean; dateDelivered?: unknown }) | undefined;
  return !!meta && (meta.isDelivered === true || meta.dateDelivered instanceof Date);
}

/**
 * Photon Spectrum (cloud iMessage) channel. Live only: the constructor throws "not configured"
 * unless PHOTON_MODE=live with a project id and secret.
 *
 * - transport "sdk": one long-lived Spectrum connection inside the hub. If its message stream ends
 *   or fails, status becomes "reconnecting" and it reconnects with backoff. Cards are never resent:
 *   the shareId is the idempotency key across reconnects.
 * - transport "webhook": Spectrum POSTs to /webhooks/photon. Unsigned or badly signed requests are
 *   rejected before Spectrum's own handler sees them.
 *
 * The card is the verified text, then any snapshots, then a native poll (votes come back as
 * poll_option messages). With PHOTON_MINIAPP_* set, a customizedMiniApp() card goes first and is
 * updated in place with edit().
 */
export class PhotonChannel implements PatientChannel {
  readonly kind = "photon" as const;
  private readonly events = new EventEmitterSet();
  private readonly statusListeners = new Set<(s: ChannelStatus) => void>();
  private readonly attempted = new Set<string>();
  private readonly cards = new Map<string, SentCard>();
  private readonly seen = new Set<string>();
  private sdk: PhotonSdk | undefined;
  private conn: PhotonConnection | undefined;
  private downReason: string | undefined = "not started";
  private stopped = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | undefined;
  private warnedMiniApp = false;
  private readonly now: () => number;
  private readonly backoff: readonly number[];

  constructor(
    private readonly cfg: MessagingConfig,
    private readonly deps: PhotonChannelDeps,
  ) {
    if (cfg.mode !== "live" || !cfg.projectId || !cfg.projectSecret) throw new Error("not configured");
    this.now = deps.now ?? Date.now;
    this.backoff = deps.backoffMs?.length ? deps.backoffMs : DEFAULT_BACKOFF_MS;
  }

  /** Connects once. On failure the channel stays down, retries with backoff, and the error is rethrown. */
  async start(): Promise<void> {
    this.stopped = false;
    const sdk = this.deps.sdk;
    this.sdk = typeof sdk === "function" ? await sdk() : (sdk ?? (await loadSpectrumSdk()));
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const conn = this.conn;
    this.conn = undefined;
    this.setStatus("stopped");
    await conn?.stop();
  }

  status(): ChannelStatus {
    return this.downReason ? { up: false, reason: this.downReason } : { up: true };
  }

  onEvent(callback: (ev: ShareEvent) => void): () => void {
    return this.events.on(callback);
  }

  onStatusChange(callback: (s: ChannelStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  async send(req: ShareRequest): Promise<void> {
    assertSendable(req);
    if (this.attempted.has(req.shareId) || this.deps.ledger.has(req.shareId)) throw new DuplicateShareError(req.shareId);
    this.attempted.add(req.shareId);
    const { conn, sdk } = this;
    if (!conn || !sdk || this.downReason) throw new ChannelDownError(this.downReason ?? "Photon is not connected");
    const handle = this.deps.resolveHandle?.(req.recipientRef) ?? this.deps.registry.handleFor(req.recipientRef);
    if (!handle) throw new Error("recipient is not opted in");
    const labels = req.pollOptions.map((o) => o.label);
    if (new Set(labels).size !== labels.length) throw new Error("poll option labels must be unique; votes are matched by label");
    const attachments = req.bookmarks.map((b) => this.snapshotSource(b.snapshotUrl));

    const space = await conn.openDm(handle);
    const miniAppMessage = await this.sendMiniApp(space, sdk, req.shareId, req.verified.text);
    const textMessage = await space.send(sdk.text(req.verified.text));
    this.cards.set(req.shareId, { space, textMessage, miniAppMessage, text: req.verified.text });
    const entry = this.deps.ledger.record({
      shareId: req.shareId,
      recipientRef: req.recipientRef,
      messageIds: [miniAppMessage?.id, textMessage?.id].filter((id): id is string => !!id),
      options: req.pollOptions.map((o) => ({ optionId: o.id, label: o.label })),
    });
    this.events.emit({ shareId: req.shareId, kind: "sent", ts: this.now() });
    if (textMessage) void this.watchDelivered(req.shareId, space, textMessage.id);

    try {
      for (const source of attachments) {
        const m = await space.send(sdk.attachment(source));
        if (m) entry.messageIds.push(m.id);
      }
      if (labels.length === 0) return;
      // Outbound choices are title-only, so votes map back by option.optionIdentifier when the
      // sent poll reports one, otherwise by unique label.
      const pollTitle = labels.join("/") === SIDE_EFFECT_OPTIONS.join("/") ? SIDE_EFFECT_POLL_TITLE : POLL_TITLE;
      const pollMessage = await space.send(sdk.poll(pollTitle, labels));
      if (pollMessage) {
        // "A created poll uses its root GUID as its message ID" (Native iMessage polls docs).
        entry.pollGuid = pollMessage.id;
        entry.messageIds.push(pollMessage.id);
        if (pollMessage.content.type === "poll") {
          // TODO(verify): the send result's poll content lists options with optionIdentifier, in order.
          const ids = pollMessage.content.options.map((o) => o.optionIdentifier);
          entry.options = entry.options.map((o, i): LedgerOption => ({ ...o, identifier: ids[i] }));
          if (pollMessage.content.pollMessageGuid) entry.pollGuid = pollMessage.content.pollMessageGuid;
        }
      }
    } catch (err) {
      this.events.emit({
        shareId: req.shareId,
        kind: "error",
        detail: "The text was sent, but the snapshots or poll failed. Not retrying, to avoid a duplicate.",
        ts: this.now(),
      });
      this.deps.logger.warn({ shareId: req.shareId, err: { name: (err as Error).name, message: redactPhone((err as Error).message) } }, "partial Photon send");
    }
  }

  /** Rewrites the sent card in place with edit(new content, original message). */
  async update(shareId: string, changes: ShareChanges): Promise<void> {
    assertSendableChanges(changes);
    const card = this.cards.get(shareId);
    if (!card || !this.sdk) throw new Error(`share ${shareId} was never sent`);
    if (!changes.verified) return;
    const sdk = this.sdk;
    // TODO(verify): iMessage accepts edits of plain text and mini-app cards within Apple's edit window.
    if (card.miniAppMessage && this.cfg.miniApp) {
      await card.space.send(sdk.edit(this.miniAppContent(sdk, shareId, changes.verified.text), card.miniAppMessage));
    }
    await card.space.send(sdk.edit(sdk.text(changes.verified.text), card.textMessage));
    card.text = changes.verified.text;
  }

  /** Verified text this channel sent for shareId, or undefined (never sent, or the hub restarted). */
  sharedText(shareId: string): string | undefined {
    return this.cards.get(shareId)?.text;
  }

  /** POST /webhooks/photon. Never processes a request whose Spectrum signature does not verify. */
  async handleWebhook(req: RawWebhookRequest): Promise<RawWebhookResult> {
    const json = (status: number, body: Record<string, unknown>): RawWebhookResult => ({
      status,
      body: new TextEncoder().encode(JSON.stringify(body)),
      headers: { "content-type": "application/json" },
    });
    if (this.cfg.transport !== "webhook") return json(404, { error: "the webhook transport is off (PHOTON_TRANSPORT=sdk)" });
    if (!this.cfg.webhookSecret) return json(503, { error: "not configured: PHOTON_WEBHOOK_SECRET" });
    if (!this.sdk) return json(503, { error: "Photon is not started" });
    const verified = await this.sdk.verifySignature(req, this.cfg.webhookSecret, this.now());
    if (!verified.ok) {
      this.deps.logger.warn({ reason: verified.reason }, "rejected a Photon webhook with a missing or bad signature");
      return json(401, { error: `signature rejected: ${verified.reason}` });
    }
    if (!this.conn) return json(503, { error: "Photon is not connected" });
    return this.conn.webhook(req, (space, message) => this.onInbound(space, message));
  }

  private async connect(): Promise<void> {
    const sdk = this.sdk!;
    try {
      const conn = await sdk.connect(this.cfg, (subscriptionId) => this.deps.logger.debug({ subscriptionId }, "Photon heartbeat"));
      if (this.stopped) {
        await conn.stop();
        return;
      }
      this.conn = conn;
      this.attempt = 0;
      this.setStatus(undefined);
      this.announce();
      if (this.cfg.transport === "sdk") void this.consume(conn);
    } catch (err) {
      this.setStatus(`Photon could not connect: ${redactPhone((err as Error).message)}`);
      this.scheduleReconnect();
      throw err;
    }
  }

  private announce(): void {
    const line = maskLine(this.cfg.line);
    const msg =
      this.cfg.transport === "sdk"
        ? `Photon listener connected (sdk), line ${line}`
        : `Photon webhook ready (webhook), line ${line}. Register ${webhookUrl(this.cfg)} under Spectrum / Webhooks → Add webhook`;
    (this.deps.announce ?? ((m: string) => this.deps.logger.info(m)))(msg);
  }

  private async consume(conn: PhotonConnection): Promise<void> {
    let reason: string;
    try {
      for await (const [space, message] of conn.messages) {
        try {
          await this.onInbound(space, message);
        } catch (err) {
          this.deps.logger.warn({ err: { name: (err as Error).name, message: redactPhone((err as Error).message) } }, "inbound Photon message failed");
        }
      }
      reason = "message stream ended";
    } catch (err) {
      reason = `message stream failed: ${redactPhone((err as Error).message)}`;
    }
    if (this.stopped || this.conn !== conn) return;
    this.conn = undefined;
    this.deps.logger.warn({ reason }, "Photon connection dropped; reconnecting");
    this.setStatus(RECONNECTING);
    void conn.stop().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)]!;
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.downReason !== RECONNECTING) this.setStatus(RECONNECTING);
      this.connect().catch(() => undefined);
    }, delay);
    this.timer.unref?.();
  }

  private setStatus(reason: string | undefined): void {
    if (this.downReason === reason) return;
    this.downReason = reason;
    const s = this.status();
    for (const cb of this.statusListeners) cb(s);
  }

  /** One inbound path for the stream and the webhook: de-duplicated, our line only. */
  private async onInbound(space: Space, message: Message): Promise<void> {
    if (message.id) {
      if (this.seen.has(message.id)) return;
      this.seen.add(message.id);
      if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!);
    }
    if (forAnotherLine(space, this.cfg.line)) {
      this.deps.logger.info("ignored a message for another line");
      return;
    }
    const inbound = toInbound(message);
    if (!inbound) return;
    if (this.deps.listen) {
      if (inbound.direction === "inbound" && inbound.content.type === "text" && inbound.senderHandle && this.sdk) {
        const reply = this.deps.listen.onText(inbound.senderHandle, inbound.content.text);
        if (reply && isRegistrationConfirmation(reply)) await space.send(this.sdk.text(reply));
      }
      return;
    }
    const outcome = this.deps.router.handle(inbound);
    if (!this.sdk) return;
    if (outcome?.kind === "opted_in") await space.send(this.sdk.text(OPT_IN_REPLY));
    else if (outcome?.kind === "opted_out") await space.send(this.sdk.text(OPT_OUT_REPLY));
  }

  private async watchDelivered(shareId: string, space: Space, messageId: string): Promise<void> {
    const poll = this.deps.deliveredPoll ?? { everyMs: 3_000, forMs: 60_000 };
    if (poll.everyMs <= 0) return;
    for (let waited = 0; waited < poll.forMs && !this.stopped; waited += poll.everyMs) {
      await new Promise((r) => setTimeout(r, poll.everyMs).unref?.());
      try {
        if (deliveredFlag(await space.getMessage(messageId))) {
          this.events.emit({ shareId, kind: "delivered", ts: this.now() });
          return;
        }
      } catch {
        return;
      }
    }
  }

  private miniAppContent(sdk: PhotonSdk, shareId: string, text: string): ContentInput {
    return sdk.miniApp(this.cfg.miniApp!, {
      url: `${this.cfg.publicUrl}/share/${shareId}`,
      caption: "Message from your care team",
      summary: text,
    });
  }

  private async sendMiniApp(space: Space, sdk: PhotonSdk, shareId: string, text: string): Promise<Message | undefined> {
    if (!this.cfg.miniApp || !this.cfg.publicUrl) {
      if (!this.warnedMiniApp) {
        this.warnedMiniApp = true;
        this.deps.logger.info("customizedMiniApp card: not configured (PHOTON_MINIAPP_* and PHOTON_PUBLIC_URL); sending text and poll only");
      }
      return undefined;
    }
    return space.send(this.miniAppContent(sdk, shareId, text));
  }

  private snapshotSource(url: string): string | URL {
    const local = SNAPSHOT_PATH.exec(url);
    if (local) return join(this.deps.snapshotDir, local[1]!);
    if (/^https:\/\//.test(url)) return new URL(url);
    throw new Error("snapshot URL must be a hub /snapshots/ path or an https URL");
  }
}
