import type { ContentInput, Message, Space } from "@spectrum-ts/core";
import type { MessagingConfig, MiniAppConfig } from "./config.js";

/**
 * Every spectrum-ts name the hub uses, checked against the installed @spectrum-ts/core and
 * @spectrum-ts/imessage 12.16.0 type definitions (dist/*.d.ts, read 2026-11-11):
 *   core:     Spectrum({ projectId, projectSecret, providers, webhookSecret, options: { logLevel } }),
 *             instance.messages, instance.stop(), instance.webhook({ body, headers }, handler),
 *             text(), attachment(), poll(title, choices[]), edit(content, target),
 *             Space.send(), Space.getMessage(id)
 *   imessage: imessage.config({ onHeartbeat }), imessage(app).space.create(users, { phone }),
 *             customizedMiniApp({ appName, teamId, extensionBundleId, url, layout })
 *   webhook:  verifySpectrumSignature({ headers, rawBody, secret, now }) from @spectrum-ts/core/webhook
 */

export interface RawWebhookRequest {
  body: Uint8Array;
  /** Lower-cased header names. */
  headers: Record<string, string>;
}

export interface RawWebhookResult {
  status: number;
  body: Uint8Array;
  headers: Record<string, string>;
}

export interface MiniAppCard {
  url: string;
  caption: string;
  summary: string;
}

/** One live Spectrum instance. */
export interface PhotonConnection {
  /** Inbound [space, message] pairs. Ends or throws when the connection drops. */
  readonly messages: AsyncIterable<[Space, Message]>;
  /** Opens or reuses the DM with handle, sent from the configured line. */
  openDm(handle: string): Promise<Space>;
  /** Hands one webhook delivery to Spectrum, which checks the signature again and deserializes it. */
  webhook(req: RawWebhookRequest, handler: (space: Space, message: Message) => Promise<void>): Promise<RawWebhookResult>;
  stop(): Promise<void>;
}

/** The SDK surface the Photon channel needs. Tests pass a fake. */
export interface PhotonSdk {
  connect(cfg: MessagingConfig, onHeartbeat: (subscriptionId: string) => void): Promise<PhotonConnection>;
  text(s: string): ContentInput;
  attachment(source: string | URL): ContentInput;
  poll(title: string, choices: string[]): ContentInput;
  edit(content: ContentInput, target: Message | undefined): ContentInput;
  miniApp(identity: MiniAppConfig, card: MiniAppCard): ContentInput;
  verifySignature(req: RawWebhookRequest, secret: string, now?: number): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** The real spectrum-ts, loaded on first use so mock mode never imports it. */
export async function loadSpectrumSdk(): Promise<PhotonSdk> {
  const [core, im, hook] = await Promise.all([
    import("@spectrum-ts/core"),
    import("@spectrum-ts/imessage"),
    import("@spectrum-ts/core/webhook"),
  ]);
  return {
    async connect(cfg, onHeartbeat) {
      const app = await core.Spectrum({
        projectId: cfg.projectId,
        projectSecret: cfg.projectSecret,
        providers: [im.imessage.config({ onHeartbeat: (h) => onHeartbeat(h.subscriptionId) })],
        ...(cfg.webhookSecret ? { webhookSecret: cfg.webhookSecret } : {}),
        // TODO(verify): Spectrum's own logs never include phone numbers at "warn".
        options: { logLevel: "warn" },
      });
      return {
        messages: app.messages,
        // Confirmed in the installed SpaceNamespace.create type and the Stable iMessage routing doc:
        // space.create(user, { phone }) pins a dedicated line. A string handle is a SpaceUserLike.
        openDm: (handle) => im.imessage(app).space.create(handle, { phone: cfg.line }) as Promise<Space>,
        webhook: (req, handler) => app.webhook({ body: req.body, headers: req.headers }, handler),
        stop: () => app.stop(),
      };
    },
    text: (s) => core.text(s),
    attachment: (source) => core.attachment(source),
    poll: (title, choices) => core.poll(title, choices),
    edit: (content, target) => core.edit(content, target),
    miniApp: (identity, card) =>
      im.customizedMiniApp({
        appName: identity.appName,
        teamId: identity.teamId,
        extensionBundleId: identity.extensionBundleId,
        url: card.url,
        layout: { caption: card.caption, summary: card.summary },
      }),
    verifySignature: (req, secret, now) => hook.verifySpectrumSignature({ headers: req.headers, rawBody: req.body, secret, ...(now ? { now } : {}) }),
  };
}
