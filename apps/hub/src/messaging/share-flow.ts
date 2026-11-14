import { randomUUID } from "node:crypto";
import type { ShareContext } from "../integrations/integration.js";
import type { AppId, BusEnvelope, ShareEvent, ShareRequest, VerifiedText, ViewerCommand, ViewerState } from "@hoverscan/contracts";
import type { CaseLookup } from "../ai/case-lookup.js";
import type { Bus } from "../bus/bus.js";
import { redactPhone, type Logger } from "../log/logger.js";
import { ChannelDownError, DuplicateShareError, SendableShareRequest, type PatientChannel } from "./patient-channel.js";
import type { RecipientRegistry } from "./recipients.js";

/** Origin recorded for everything this module publishes. */
export const MESSAGING_ORIGIN = "messaging";
/** Timeline text when Photon is unreachable. */
export const NOT_SENT_UNAVAILABLE = "not sent: messaging unavailable.";
/** Only the AI module may publish VerifiedText the share flow trusts. */
export const TRUSTED_VERIFIED_ORIGINS: ReadonlySet<string> = new Set(["ai"]);
/** The messaging module never requests or confirms a share on its own behalf. */
const UNTRUSTED_COMMAND_ORIGINS: ReadonlySet<string> = new Set([MESSAGING_ORIGIN]);

const CONFIRM_PREFIX = "share:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PendingShare {
  shareId: string;
  confirmFor: string;
  recipientRef: string;
  /** The VerifiedText on screen when the share was requested. */
  verified: VerifiedText;
  bookmarkIds: string[] | undefined;
  expiresAt: number;
}

export interface ShareFlowDeps {
  bus: Bus;
  channel: PatientChannel;
  registry: RecipientRegistry;
  cases: CaseLookup;
  logger: Logger;
  pendingTtlMs: number;
  optInKeyword: string;
  now?: () => number;
  newId?: () => string;
}

const STATUS_WORDS: Record<VerifiedText["status"], string> = {
  verified: "verified",
  needs_review: "needs review",
  blocked: "blocked",
};

/**
 * Enforces the share rules in the hub:
 * share_to_patient sets pending.confirmFor and sends nothing; a matching confirm sends only if the
 * latest trusted VerifiedText is still the one requested and is "verified"; pending shares expire;
 * cancel clears them. Every refusal is a share "error" event with a plain-language reason.
 */
export class ShareFlow {
  private pending: PendingShare | undefined;
  private timer: NodeJS.Timeout | undefined;
  private latestVerified: VerifiedText | undefined;
  private readonly shares = new Map<string, ShareContext>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: ShareFlowDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  get pendingShare(): Readonly<PendingShare> | undefined {
    return this.pending;
  }

  /** Recipient, case and poll options of a share that reached the channel. */
  shareInfo(shareId: string): ShareContext | undefined {
    return this.shares.get(shareId);
  }

  /** Bus input, with the origin the bus recorded for it. */
  async handle(env: BusEnvelope, origin: string): Promise<void> {
    if (env.ch === "verified") {
      if (TRUSTED_VERIFIED_ORIGINS.has(origin)) this.latestVerified = env.ev;
      else this.deps.logger.warn({ from: origin }, "ignored VerifiedText from an untrusted origin");
      return;
    }
    if (env.ch !== "cmd") return;
    const cmd = env.cmd;
    if (cmd.type !== "share_to_patient" && cmd.type !== "confirm" && cmd.type !== "cancel") return;
    if (UNTRUSTED_COMMAND_ORIGINS.has(origin)) {
      this.deps.logger.warn({ from: origin, type: cmd.type }, "ignored share command from an untrusted origin");
      return;
    }
    if (cmd.type === "share_to_patient") return this.request(cmd);
    if (cmd.type === "confirm") return this.confirm(cmd);
    this.cancel();
  }

  /** Clears timers. */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private request(cmd: Extract<ViewerCommand, { type: "share_to_patient" }>): void {
    const shareId = this.newId();
    const state = this.deps.bus.latestState;
    if (!state?.app || !state.caseId) return this.error(shareId, "No case is loaded, so there is nothing to share.");
    const channel = this.deps.channel.status();
    if (!channel.up) return this.error(shareId, `${NOT_SENT_UNAVAILABLE} (${channel.reason})`);
    const recipient = this.deps.registry.active();
    if (!recipient) {
      return this.error(shareId, `No patient has opted in. Ask the patient to text ${this.deps.optInKeyword} to the clinic number first.`);
    }
    const vt = this.latestVerified;
    if (!vt) return this.error(shareId, "There is no checked explanation to send. Say \"explain it\" first.");
    if (vt.status !== "verified") {
      return this.error(shareId, `The explanation is ${STATUS_WORDS[vt.status]}, not verified, so it cannot be sent.`);
    }

    if (this.pending) this.error(this.pending.shareId, "Replaced by a newer share request. Nothing was sent.");
    this.close();
    this.pending = {
      shareId,
      confirmFor: `${CONFIRM_PREFIX}${shareId}`,
      recipientRef: recipient.ref,
      verified: vt,
      bookmarkIds: cmd.bookmarkIds,
      expiresAt: this.now() + this.deps.pendingTtlMs,
    };
    this.timer = setTimeout(() => this.expire(shareId), this.deps.pendingTtlMs);
    this.timer.unref?.();
    this.publishPending(state, this.pending.confirmFor);
    this.deps.logger.info({ shareId, recipientRef: recipient.ref }, "share awaiting confirmation");
  }

  private async confirm(cmd: Extract<ViewerCommand, { type: "confirm" }>): Promise<void> {
    const forShare = cmd.for.startsWith(CONFIRM_PREFIX) ? cmd.for.slice(CONFIRM_PREFIX.length) : undefined;
    const p = this.pending;
    if (!p) {
      if (forShare === undefined) return;
      return this.error(UUID.test(forShare) ? forShare : this.newId(), "There is no share waiting for confirmation. It may have expired or been cancelled.");
    }
    if (cmd.for !== p.confirmFor) {
      return this.error(p.shareId, "That confirmation is for a different share. The current share is still waiting.");
    }

    // From here the pending share is consumed whatever happens: one confirm, one attempt.
    this.clearPending();
    const latest = this.latestVerified;
    if (!latest || latest.status !== "verified") {
      const status = latest ? STATUS_WORDS[latest.status] : "missing";
      return this.error(p.shareId, `The explanation is ${status}, not verified, so it was not sent.`);
    }
    if (latest.text !== p.verified.text || latest.checkedAt !== p.verified.checkedAt) {
      return this.error(p.shareId, "The explanation changed after you asked to share. Ask to send it again.");
    }
    if (!this.deps.registry.has(p.recipientRef)) {
      return this.error(p.shareId, "The patient opted out. Nothing was sent.");
    }

    const req = await this.buildRequest(p, latest);
    if (!req.ok) return this.error(p.shareId, req.reason);
    const { request } = req;
    this.shares.set(request.shareId, {
      shareId: request.shareId,
      app: req.app,
      caseId: req.caseId,
      recipientRef: request.recipientRef,
      pollOptions: request.pollOptions,
    });
    try {
      await this.deps.channel.send(req.request);
    } catch (err) {
      const reason =
        err instanceof DuplicateShareError
          ? "This share was already attempted. Not sending it twice."
          : err instanceof ChannelDownError
            ? `${NOT_SENT_UNAVAILABLE} (${redactPhone(err.message)})`
            : `Messaging failed (${redactPhone((err as Error).message)}). Nothing was retried; ask to send again if needed.`;
      this.deps.logger.warn({ shareId: p.shareId, err: { name: (err as Error).name } }, "share send failed");
      this.error(p.shareId, reason);
    }
  }

  private cancel(): void {
    const p = this.pending;
    if (!p) return;
    this.clearPending();
    this.error(p.shareId, "Cancelled. Nothing was sent.");
  }

  private expire(shareId: string): void {
    if (this.pending?.shareId !== shareId) return;
    this.clearPending();
    this.error(shareId, `The share request expired after ${Math.round(this.deps.pendingTtlMs / 1000)} seconds without a confirm. Nothing was sent.`);
  }

  private clearPending(): void {
    this.close();
    this.pending = undefined;
    const state = this.deps.bus.latestState;
    if (state?.pending.confirmFor?.startsWith(CONFIRM_PREFIX)) this.publishPending(state, undefined);
  }

  /** TODO(verify) with B: the viewer adopts pending.confirmFor from hub-published state instead of overwriting it. */
  private publishPending(state: ViewerState, confirmFor: string | undefined): void {
    const pending = { ...state.pending, confirmFor };
    if (!confirmFor) delete pending.confirmFor;
    this.deps.bus.publish({ ch: "state", state: { ...state, pending } }, MESSAGING_ORIGIN);
  }

  private async buildRequest(
    p: PendingShare,
    verified: VerifiedText,
  ): Promise<{ ok: true; request: ShareRequest; app: AppId; caseId: string } | { ok: false; reason: string }> {
    const state = this.deps.bus.latestState;
    if (!state?.app || !state.caseId) return { ok: false, reason: "No case is loaded, so there is nothing to share." };
    const manifest = await this.deps.cases.getCase(state.app, state.caseId);
    if (!manifest) return { ok: false, reason: `Case ${state.caseId} is not available, so its poll options are unknown.` };

    const withSnapshots = state.bookmarks.filter((b): b is typeof b & { snapshotUrl: string } => !!b.snapshotUrl);
    let chosen: typeof withSnapshots;
    if (p.bookmarkIds?.length) {
      chosen = withSnapshots.filter((b) => p.bookmarkIds!.includes(b.id));
      const missing = p.bookmarkIds.filter((id) => !chosen.some((b) => b.id === id));
      if (missing.length) return { ok: false, reason: `Bookmark ${missing.join(", ")} has no captured snapshot. Capture it and ask again.` };
    } else {
      // TODO(verify) with B: an empty bookmarkIds means "the current view"; until the viewer captures on share, use the latest snapshot.
      chosen = withSnapshots.slice(-1);
    }

    const parsed = SendableShareRequest.safeParse({
      shareId: p.shareId,
      recipientRef: p.recipientRef,
      bookmarks: chosen.map((b) => ({ snapshotUrl: b.snapshotUrl, label: b.label })),
      verified,
      pollOptions: manifest.share.pollOptions,
    });
    if (!parsed.success) {
      this.deps.logger.warn({ shareId: p.shareId, issues: parsed.error.issues.map((i) => i.path.join(".")) }, "ShareRequest failed validation");
      return { ok: false, reason: "The share did not pass validation, so it was not sent." };
    }
    return { ok: true, request: parsed.data, app: state.app, caseId: state.caseId };
  }

  private error(shareId: string, detail: string): void {
    const ev: ShareEvent = { shareId, kind: "error", detail: redactPhone(detail).slice(0, 500), ts: this.now() };
    this.deps.bus.publish({ ch: "share", ev }, MESSAGING_ORIGIN);
  }
}
