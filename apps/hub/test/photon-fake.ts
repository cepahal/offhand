import { createHmac } from "node:crypto";
import type { ContentInput, Message, Space } from "@spectrum-ts/core";
import { verifySpectrumSignature } from "@spectrum-ts/core/webhook";
import type { MessagingConfig } from "../src/messaging/config.js";
import type { PhotonConnection, PhotonSdk, RawWebhookRequest } from "../src/messaging/spectrum-sdk.js";

/** Fictional 555-01xx numbers only. */
export const LINE = "+15550100123";
export const PATIENT = "+15550100188";
export const STRANGER = "+15550100177";
export const WEBHOOK_SECRET = "whsec_test_only";

type FakeContent = { type: string; [k: string]: unknown };

export interface Sent {
  spaceId: string;
  content: FakeContent;
  id: string;
}

/** An async queue that the test feeds and can end (a dropped connection) or fail. */
class Inbox implements AsyncIterable<[Space, Message]> {
  private items: [Space, Message][] = [];
  private waiters: ((r: IteratorResult<[Space, Message]>) => void)[] = [];
  private failWith: Error | undefined;
  private ended = false;
  private rejecters: ((e: Error) => void)[] = [];

  /** True once every pushed item was handled and the consumer is waiting for the next one. */
  get drained(): boolean {
    return this.items.length === 0 && this.waiters.length > 0;
  }

  push(item: [Space, Message]): void {
    const w = this.waiters.shift();
    this.rejecters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  fail(err: Error): void {
    this.failWith = err;
    for (const r of this.rejecters.splice(0)) r(err);
  }

  [Symbol.asyncIterator](): AsyncIterator<[Space, Message]> {
    return {
      next: () => {
        if (this.failWith) return Promise.reject(this.failWith);
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => {
          this.waiters.push(resolve);
          this.rejecters.push(reject);
        });
      },
    };
  }
}

export class FakeSpectrum implements PhotonSdk {
  readonly sent: Sent[] = [];
  readonly connections: FakeConnection[] = [];
  /** When set, connect() rejects with this (Photon unreachable). */
  unreachable: Error | undefined;
  private seq = 0;

  get current(): FakeConnection {
    const c = this.connections.at(-1);
    if (!c) throw new Error("not connected");
    return c;
  }

  async connect(cfg: MessagingConfig): Promise<PhotonConnection> {
    if (this.unreachable) throw this.unreachable;
    const conn = new FakeConnection(this, cfg);
    this.connections.push(conn);
    return conn;
  }

  nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  space(handle: string, line = LINE): Space {
    const id = `dm:${handle}`;
    return {
      id,
      phone: line,
      __platform: "imessage",
      send: async (content: ContentInput) => {
        const c = (typeof content === "string" ? { type: "text", text: content } : content) as FakeContent;
        const msgId = this.nextId("m");
        this.sent.push({ spaceId: id, content: c, id: msgId });
        if (c.type === "poll") {
          const options = (c.options as string[]).map((title, i) => ({ title, optionIdentifier: `oid-${i}` }));
          return { id: msgId, content: { type: "poll", title: c.title, options, pollMessageGuid: `pg-${msgId}` } } as unknown as Message;
        }
        return { id: msgId, content: c } as unknown as Message;
      },
      getMessage: async () => undefined,
    } as unknown as Space;
  }

  text = (s: string): ContentInput => ({ type: "text", text: s }) as unknown as ContentInput;
  attachment = (source: string | URL): ContentInput => ({ type: "attachment", source: String(source) }) as unknown as ContentInput;
  poll = (title: string, choices: string[]): ContentInput => ({ type: "poll", title, options: choices }) as unknown as ContentInput;
  edit = (content: ContentInput, target: Message | undefined): ContentInput => ({ type: "edit", content, targetId: target?.id }) as unknown as ContentInput;
  miniApp = (_identity: unknown, card: { url: string; summary: string }): ContentInput =>
    ({ type: "customized-mini-app", url: card.url, summary: card.summary }) as unknown as ContentInput;
  verifySignature = (req: RawWebhookRequest, secret: string, now?: number) =>
    verifySpectrumSignature({ headers: req.headers, rawBody: req.body, secret, ...(now ? { now } : {}) });

  /** An inbound message as spectrum-ts would yield it. */
  inbound(from: string, content: FakeContent): [Space, Message] {
    const msg = { id: this.nextId("in"), direction: "inbound", sender: { __platform: "imessage", id: from, address: from }, content } as unknown as Message;
    return [this.space(from), msg];
  }
}

export class FakeConnection implements PhotonConnection {
  readonly inbox = new Inbox();
  stopped = false;
  readonly messages: AsyncIterable<[Space, Message]> = this.inbox;

  constructor(
    private readonly sdk: FakeSpectrum,
    private readonly cfg: MessagingConfig,
  ) {}

  async openDm(handle: string): Promise<Space> {
    return this.sdk.space(handle, this.cfg.line);
  }

  /** Deserializes the test's JSON body ({ from, content }) and calls the handler, like Spectrum's webhook(). */
  async webhook(req: RawWebhookRequest, handler: (space: Space, message: Message) => Promise<void>) {
    const body = JSON.parse(new TextDecoder().decode(req.body)) as { from: string; content: FakeContent };
    const [space, message] = this.sdk.inbound(body.from, body.content);
    await handler(space, message);
    return { status: 200, body: new TextEncoder().encode("{}"), headers: { "content-type": "application/json" } };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.inbox.end();
  }
}

/** Headers Spectrum signs a native webhook with: v0=HMAC-SHA256(secret, "v0:" + ts + ":" + body). */
export function signedHeaders(body: string, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)): Record<string, string> {
  const sig = createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  return { "content-type": "application/json", "x-spectrum-timestamp": String(ts), "x-spectrum-signature": `v0=${sig}` };
}

export function liveMessaging(transport: "sdk" | "webhook", overrides: Partial<MessagingConfig> = {}): Partial<MessagingConfig> {
  return {
    mode: "live",
    transport,
    projectId: "proj-test",
    projectSecret: "secret-test",
    line: LINE,
    ...(transport === "webhook" ? { publicUrl: "https://hoverscan.example", webhookSecret: WEBHOOK_SECRET } : {}),
    ...overrides,
  };
}
