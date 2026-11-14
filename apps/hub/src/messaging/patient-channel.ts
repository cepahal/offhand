import { containsPhoneNumber, RECIPIENT_REF_PATTERN, ShareRequest, VerifiedText, type ShareEvent } from "@hoverscan/contracts";
import { z } from "zod";

const noPhone = (s: string) => !containsPhoneNumber(s);
const SendableVerifiedText = VerifiedText.extend({ status: z.literal("verified"), text: z.string().min(1).max(1000).refine(noPhone) });

/**
 * The contract's ShareRequest accepts any status; this is the stricter shape the hub will send:
 * status must be "verified", the recipient an opaque rcp_ ref, and no text may hold a phone number.
 */
export const SendableShareRequest = ShareRequest.extend({
  shareId: z.uuid(),
  recipientRef: z.string().regex(RECIPIENT_REF_PATTERN),
  verified: SendableVerifiedText,
  bookmarks: z.array(z.object({ snapshotUrl: z.string().min(1), label: z.string().max(120).refine(noPhone) })),
  pollOptions: z.array(z.object({ id: z.string().min(1), label: z.string().min(1).max(120).refine(noPhone) })),
});

export class UnsendableShareError extends Error {
  constructor() {
    super("refused: the share is not verified or failed validation");
    this.name = "UnsendableShareError";
  }
}

/** Channels call this first in send/update, so nothing unverified reaches the network even if a caller slips. */
export function assertSendable(req: ShareRequest): void {
  if (!SendableShareRequest.safeParse(req).success) throw new UnsendableShareError();
}

export function assertSendableChanges(changes: ShareChanges): void {
  if (changes.verified && !SendableVerifiedText.safeParse(changes.verified).success) throw new UnsendableShareError();
}

/** In-place changes to a card that was already sent. Text changes must be verified text too. */
export interface ShareChanges {
  verified?: ShareRequest["verified"];
}

export type ChannelStatus = { up: true } | { up: false; reason: string };

/** Delivers cards to opted-in patients. Every outcome comes back as ShareEvent values through onEvent. */
export interface PatientChannel {
  readonly kind: "mock" | "photon";
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Sends one card. The shareId is the idempotency key: a second call with the same shareId
   * rejects with DuplicateShareError without contacting the network, even if the first call failed.
   */
  send(req: ShareRequest): Promise<void>;
  update(shareId: string, changes: ShareChanges): Promise<void>;
  onEvent(callback: (ev: ShareEvent) => void): () => void;
  status(): ChannelStatus;
  /** Called on every up/down transition, e.g. a dropped connection that is reconnecting. */
  onStatusChange?(callback: (s: ChannelStatus) => void): () => void;
}

export class DuplicateShareError extends Error {
  constructor(shareId: string) {
    super(`share ${shareId} was already attempted; not sending again`);
    this.name = "DuplicateShareError";
  }
}

export class ChannelDownError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ChannelDownError";
  }
}

/** Fan-out helper shared by the channels. */
export class EventEmitterSet {
  private readonly listeners = new Set<(ev: ShareEvent) => void>();

  on(cb: (ev: ShareEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(ev: ShareEvent): void {
    for (const cb of this.listeners) cb(ev);
  }
}
