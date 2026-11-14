/**
 * Photon registration listener. It starts the same sdk transport as the hub's
 * PhotonChannel and nothing else: no AI, no integrations, no viewer, no share flow.
 *
 * Names used, confirmed in @spectrum-ts/core and @spectrum-ts/imessage 12.16.0
 * (dist/*.d.ts, read 2026-11-12): Spectrum().messages is AsyncIterable<[Space, Message]>,
 * Space.send(content), text(source: string), User.id, iMessage user `address`,
 * space.create(user, { phone }). This file adds no Photon API names. The reply is
 * space.send(text(confirmation)) on the inbound space, the same call the opt-in reply uses.
 */
import { join } from "node:path";
import { createLogger, redactPhone, type Logger } from "../log/logger.js";
import { loadMessagingConfig, maskLine, type MessagingConfig } from "./config.js";
import { last4, registrationConfirmation } from "./demo-messages.js";
import { DemoRoleBook } from "./demo-role-book.js";
import { InboundRouter, ShareLedger } from "./inbound.js";
import { alreadyRegisteredLine, ignoredLine, listenBanner, photonListenProblems, registeredLine, safeListenError, waitingLine } from "./photon-listen-env.js";
import { PhotonChannel } from "./photon-channel.js";
import { normalizeHandle, RecipientRegistry } from "./recipients.js";
import type { PhotonSdk } from "./spectrum-sdk.js";

export interface RegistrationTurn {
  lines: string[];
  reply?: string;
  ref?: string;
}

/**
 * HOSPITAL or PATIENT registers one role. Anything else from an unknown sender
 * is ignored. A second keyword from the same sender does not add a role or a reply.
 * Printed lines use the last four digits. The log object is only `{ recipientRef }`.
 * The full number is written only by RecipientRegistry.adopt.
 */
export function applyRegistration(
  book: DemoRoleBook,
  registry: RecipientRegistry,
  handle: string,
  text: string,
  logger?: Logger,
): RegistrationTurn {
  const result = book.ingest(handle, text);
  if (result.outcome === "registered" && result.role) {
    const record = book.state.roles.find((role) => role.role === result.role);
    if (!record) return { lines: [ignoredLine(last4(handle))] };
    registry.adopt(record.ref, handle);
    logger?.info({ recipientRef: record.ref }, "registered");
    return {
      lines: [registeredLine(result.role, record.last4)],
      reply: registrationConfirmation(result.role),
      ref: record.ref,
    };
  }
  const phone = normalizeHandle(handle);
  if ((phone && book.state.handles[phone]) || registry.refForHandle(handle)) return { lines: [] };
  return { lines: [ignoredLine(last4(handle))] };
}

export interface OpenListenerOptions {
  config: MessagingConfig;
  logger: Logger;
  print: (line: string) => void;
  sdk?: PhotonSdk;
}

/** The sdk channel only. Does not construct the share flow, the AI module, or the viewer. */
export function openRegistrationListener(opts: OpenListenerOptions): PhotonChannel {
  const { config, logger, print } = opts;
  const book = new DemoRoleBook(config.recipientsFile);
  const registry = new RecipientRegistry(config.recipientsFile, {
    optIn: config.optInKeyword,
    optOut: config.optOutKeyword,
  });
  const ledger = new ShareLedger();
  const router = new InboundRouter({ registry, ledger, emit: () => undefined, logger });
  let bannerPrinted = false;
  return new PhotonChannel(config, {
    registry,
    ledger,
    router,
    logger,
    snapshotDir: join(config.recipientsFile, ".."),
    ...(opts.sdk ? { sdk: opts.sdk } : {}),
    announce: () => {
      if (bannerPrinted) return;
      bannerPrinted = true;
      print(listenBanner(maskLine(config.line)));
      for (const role of ["hospital", "patient"] as const) {
        const saved = book.state.roles.find((item) => item.role === role);
        print(saved ? alreadyRegisteredLine(role, saved.last4) : waitingLine(role));
      }
    },
    listen: {
      onText: (handle, text) => {
        const turn = applyRegistration(book, registry, handle, text, logger);
        for (const line of turn.lines) print(line);
        return turn.reply;
      },
    },
  });
}

export interface RunListenerOptions {
  env: NodeJS.ProcessEnv;
  print?: (line: string) => void;
  sdk?: PhotonSdk;
  /** Test hook. Production waits for Ctrl+C. */
  wait?: () => Promise<void>;
}

/** Loads messaging config from `env` and holds the sdk connection until Ctrl+C. */
export async function runRegistrationListener(opts: RunListenerOptions): Promise<void> {
  const problems = photonListenProblems(opts.env);
  if (problems.length) throw new Error(problems.join("\n"));
  const config = loadMessagingConfig({ env: opts.env });
  const logger = createLogger({ level: "info" });
  const print = opts.print ?? ((line: string) => console.log(line));
  const channel = openRegistrationListener({
    config,
    logger,
    print,
    ...(opts.sdk ? { sdk: opts.sdk } : {}),
  });
  try {
    await channel.start();
  } catch (err) {
    await channel.stop();
    const message = safeListenError(redactPhone((err as Error).message || "Photon could not connect"), opts.env);
    throw new Error(message, { cause: err });
  }
  const wait = opts.wait ?? waitForStop;
  try {
    await wait();
  } finally {
    await channel.stop();
  }
}

function waitForStop(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
