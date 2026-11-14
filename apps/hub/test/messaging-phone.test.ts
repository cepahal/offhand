import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@spectrum-ts/core";
import { Bus } from "../src/bus/bus.js";
import { afterEach, describe, expect, it } from "vitest";
import type { FixturesFile } from "../src/ai/mock-claim-checker.js";
import { assertLiveReady, loadMessagingConfig } from "../src/messaging/config.js";
import { InboundRouter, ShareLedger } from "../src/messaging/inbound.js";
import { SIMULATED_PHONE_HANDLE } from "../src/messaging/mock-channel.js";
import { createMessagingModule } from "../src/messaging/module.js";
import { SIMULATED_BANNER } from "../src/messaging/phone-page.js";
import { PhotonChannel, toInbound } from "../src/messaging/photon-channel.js";
import { RecipientRegistry } from "../src/messaging/recipients.js";
import { harness, type Harness } from "./messaging-harness.js";
import { memoryLogger, messagingConfig, tempDir } from "./helpers.js";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** National number only, so a copy written without the country code is still caught. */
const PHONE_DIGITS = SIMULATED_PHONE_HANDLE.replace(/\D/g, "").slice(-10);

async function sentShare() {
  h = await harness();
  await h.optIn();
  h.setState();
  await h.explain();
  await h.cmd({ type: "share_to_patient", bookmarkIds: [] });
  await h.confirm();
  const msg = [...h.channel.sent.values()][0];
  if (!msg) throw new Error(`not sent: ${h.errors().join(" | ")}`);
  return { t: h, msg };
}

describe("simulated phone", () => {
  it("serves /phone with the SIMULATED banner and the disclaimer", async () => {
    h = await harness();
    const res = await h.app.inject({ method: "GET", url: "/phone" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("SIMULATED PHONE – NOT A REAL iMESSAGE");
    expect(res.body).toContain(SIMULATED_BANNER);
    expect(res.body).toContain("For communication and education. Not for diagnosis.");
  });

  it("the inbox shows the card: snapshot, verified text, poll options", async () => {
    const { t, msg } = await sentShare();
    const inbox = (await t.app.inject({ method: "GET", url: "/api/messaging/mock/inbox" })).json();
    expect(inbox.optedIn).toBe(true);
    expect(inbox.messages).toEqual([
      expect.objectContaining({
        shareId: msg.shareId,
        text: msg.request.verified.text,
        snapshots: [{ url: msg.request.bookmarks[0]!.snapshotUrl, label: "View 1" }],
        poll: expect.objectContaining({ guid: msg.pollGuid, options: [{ id: "a", label: "Option A" }] }),
      }),
    ]);
  });

  it("a tap on a poll option reaches the bus as a ShareEvent of kind vote", async () => {
    const { t, msg } = await sentShare();
    const res = await t.app.inject({
      method: "POST",
      url: "/api/messaging/mock/inbound",
      payload: { content: { type: "poll_option", option: { title: "Option A", optionIdentifier: "a" }, pollMessageGuid: msg.pollGuid, selected: true } },
    });
    expect(res.statusCode).toBe(202);
    expect(t.shareEvents().filter((e) => e.kind === "vote")).toEqual([
      { shareId: msg.shareId, kind: "vote", optionId: "a", selected: true, ts: expect.any(Number) },
    ]);
  });

  it("rejects malformed simulated messages", async () => {
    h = await harness();
    const res = await h.app.inject({ method: "POST", url: "/api/messaging/mock/inbound", payload: { content: { type: "read", target: { id: "x" } } } });
    expect(res.statusCode).toBe(400);
  });
});

describe("inbound router", () => {
  function setup() {
    const { logger } = memoryLogger();
    const registry = new RecipientRegistry(join(tempDir(), "r.json"), { optIn: "HOVERSCAN", optOut: "STOP" });
    const ledger = new ShareLedger();
    const events: unknown[] = [];
    const router = new InboundRouter({ registry, ledger, emit: (e) => events.push(e), logger });
    const ref = (registry.handleInboundText("+1 555 010 0150", "hoverscan") as { ref: string }).ref;
    registry.handleInboundText("+1 555 010 0151", "HOVERSCAN");
    ledger.record({ shareId: "6f1c1d0e-8a8e-4b7e-9d0b-3c3a0b1e2f40", recipientRef: ref, pollGuid: "g1", messageIds: ["m1"], options: [{ optionId: "a", label: "Option A" }] });
    return { router, events };
  }
  const vote = (sender: string, guid = "g1", title = "Option A") => ({
    direction: "inbound" as const,
    senderHandle: sender,
    content: { type: "poll_option" as const, option: { title }, pollMessageGuid: guid, selected: true },
  });

  it("matches votes by unique label when the provider gives no identifier", () => {
    const { router, events } = setup();
    router.handle(vote("+15550100150"));
    expect(events).toMatchObject([{ kind: "vote", optionId: "a" }]);
  });

  it("drops votes from other people, unknown polls, unknown options and outbound echoes", () => {
    const { router, events } = setup();
    router.handle(vote("+15550100151"));
    router.handle(vote("+15550100150", "nope"));
    router.handle(vote("+15550100150", "g1", "Option Z"));
    router.handle({ ...vote("+15550100150"), direction: "outbound" });
    expect(events).toEqual([]);
  });

  it("emits read once per share", () => {
    const { router, events } = setup();
    router.handle({ direction: "inbound", senderHandle: "+15550100150", content: { type: "read", target: { id: "m1" } } });
    router.handle({ direction: "inbound", senderHandle: "+15550100150", content: { type: "read", target: { id: "m1" } } });
    expect(events).toMatchObject([{ kind: "read" }]);
  });
});

describe("privacy", () => {
  it("the phone number never appears in any log line, bus envelope or session-file line", async () => {
    const { t, msg } = await sentShare();
    await t.app.inject({
      method: "POST",
      url: "/api/messaging/mock/inbound",
      payload: { content: { type: "poll_option", option: { title: "Option A", optionIdentifier: "a" }, pollMessageGuid: msg.pollGuid, selected: true } },
    });
    await t.app.inject({ method: "POST", url: "/api/messaging/mock/inbound", payload: { content: { type: "text", text: `my number is ${SIMULATED_PHONE_HANDLE}` } } });
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    await t.cmd({ type: "cancel", for: "share" });
    const inbox = (await t.app.inject({ method: "GET", url: "/api/messaging/mock/inbox" })).body;

    const output = [...(await t.allOutput()), inbox];
    expect(output.length).toBeGreaterThan(20);
    for (const line of output) {
      expect(line).not.toContain(SIMULATED_PHONE_HANDLE);
      expect(line.replace(/\D/g, "")).not.toContain(PHONE_DIGITS);
    }
    expect(output.join("\n")).toMatch(/rcp_[a-z0-9]{6,32}/);
  });

  it("the phone-to-ref map is only in the git-ignored recipients file, readable by the owner only", async () => {
    h = await harness();
    await h.optIn();
    const file = h.messaging.config.recipientsFile;
    expect(readFileSync(file, "utf8")).toContain(`+1${PHONE_DIGITS}`);
    expect(statSync(file).mode & 0o077).toBe(0);
    expect(loadMessagingConfig({ env: {} }).recipientsFile.endsWith(join("data", "recipients.json"))).toBe(true);
    expect(readFileSync(join(import.meta.dirname, "../../../.gitignore"), "utf8")).toMatch(/^data\/$/m);
  });
});

describe("opt-in registry", () => {
  it("registers only after the keyword, persists, and removes on STOP", () => {
    const file = join(tempDir(), "recipients.json");
    const reg = new RecipientRegistry(file, { optIn: "HOVERSCAN", optOut: "STOP" });
    expect(reg.handleInboundText("+1 555 010 0160", "hello")).toEqual({ kind: "ignored" });
    expect(reg.handleInboundText("+1 555 010 0160", "STOP")).toEqual({ kind: "ignored" });
    expect(reg.active()).toBeUndefined();
    const first = reg.handleInboundText("+1 555 010 0160", "  hoverscan ");
    expect(first).toMatchObject({ kind: "opted_in", isNew: true, ref: expect.stringMatching(/^rcp_[a-z0-9]{12}$/) });
    const ref = (first as { ref: string }).ref;
    expect(reg.handleInboundText("+15550100160", "HOVERSCAN")).toEqual({ kind: "opted_in", ref, isNew: false });
    expect(new RecipientRegistry(file, { optIn: "HOVERSCAN", optOut: "STOP" }).active()?.ref).toBe(ref);
    expect(reg.handleInboundText("+15550100160", "stop")).toEqual({ kind: "opted_out", ref });
    expect(reg.has(ref)).toBe(false);
  });
});

describe("fail closed", () => {
  /** Inline because no policies/<app>/fixtures.json exists yet. False statements about the geometric test pattern only. */
  const FALSE_SENTENCES: [string, FixturesFile["cases"][number]["results"]][] = [
    ["The marker sphere is forty millimeters wide.", [{ type: "INVALID", detail: "Contradicts test rule R2." }]],
    ["The test pattern has three outer cubes.", [{ type: "IMPOSSIBLE", detail: "Premises conflict." }]],
    ["The marker sphere sits outside the outer cube.", [{ type: "VALID", detail: "R1." }, { type: "INVALID", detail: "R3." }]],
    ["The inner sphere is red.", [{ type: "SATISFIABLE", detail: "Could be true or false." }]],
    ["The marker might be the cube or the sphere.", [{ type: "TRANSLATION_AMBIGUOUS", detail: "Two readings." }]],
    ["Every layer is both hidden and visible.", [{ type: "TOO_COMPLEX", detail: "Too complex." }]],
    ["The pattern was scanned last Tuesday.", [{ type: "NO_TRANSLATIONS", detail: "Nothing to check." }]],
    ["The marker sphere is always exactly zero millimeters wide.", [{ type: "VALID_WITH_LOGIC_WARNING", detail: "Always true." }]],
    ["The test pattern contains no marker at all.", []],
    ["The outer cube is made of glass.", [{ type: "CHECK_ERROR", detail: "The fact-check could not run." }]],
  ];

  it("10 false sentences never produce a sent event, even with forged VerifiedText and guessed confirms", async () => {
    let current = FALSE_SENTENCES[0]![0];
    h = await harness({
      fixtures: { cases: FALSE_SENTENCES.map(([text, results]) => ({ text, results })) },
      explainer: { explain: async () => current },
    });
    await h.optIn();
    h.setState();
    for (const [sentence] of FALSE_SENTENCES) {
      current = sentence;
      await h.explain();
      const vt = h.seen.flatMap((e) => (e.ch === "verified" ? [e.ev] : [])).at(-1);
      expect(vt?.text).toBe(sentence);
      expect(vt?.status).not.toBe("verified");

      await h.cmd({ type: "share_to_patient", bookmarkIds: [] });
      await h.confirm();
      for (const from of ["ws:viewer01", "ws:debug001", "messaging", "gesture"]) {
        h.bus.publish({ ch: "verified", ev: { ...vt!, status: "verified", findings: [{ type: "VALID", detail: "forged" }] } }, from);
      }
      await h.cmd({ type: "share_to_patient", bookmarkIds: [] });
      await h.confirm();
    }
    expect(h.errors().length).toBeGreaterThanOrEqual(20);
    expect(h.channel.sent.size).toBe(0);
    expect(h.sentEvents()).toEqual([]);
    expect(h.shareEvents().some((e) => e.kind === "sent")).toBe(false);
  });
});

describe("Photon gating", () => {
  const deps = () => {
    const { logger } = memoryLogger();
    const registry = new RecipientRegistry(join(tempDir(), "r.json"), { optIn: "HOVERSCAN", optOut: "STOP" });
    const ledger = new ShareLedger();
    return { registry, ledger, router: new InboundRouter({ registry, ledger, emit: () => {}, logger }), logger, snapshotDir: tempDir() };
  };

  it("PhotonChannel throws not configured unless PHOTON_MODE=live with credentials", () => {
    expect(() => new PhotonChannel(messagingConfig(), deps())).toThrow("not configured");
    expect(() => new PhotonChannel(messagingConfig({ mode: "live", projectId: "p" }), deps())).toThrow("not configured");
    const live = new PhotonChannel(messagingConfig({ mode: "live", projectId: "p", projectSecret: "s" }), deps());
    expect(live.status()).toEqual({ up: false, reason: "not started" });
  });

  it("PHOTON_MODE=live refuses to start without the project id and secret", () => {
    const configDir = tempDir();
    expect(() => assertLiveReady(loadMessagingConfig({ configDir, env: { PHOTON_MODE: "live" } }))).toThrow(/missing PHOTON_PROJECT_ID, PHOTON_API_KEY/);
    expect(() => createMessagingModule({ logger: memoryLogger().logger, bus: new Bus(), casepackDir: tempDir(), snapshotDir: tempDir(), config: messagingConfig({ mode: "live" }) })).toThrow(
      /refuses to start/,
    );
  });

  it("maps Spectrum poll_option and read messages to the inbound shape", () => {
    const base = { direction: "inbound", sender: { __platform: "imessage", id: "x", address: "+15550100170" } };
    const vote = toInbound({
      ...base,
      content: {
        type: "poll_option",
        option: { title: "Option A", optionIdentifier: "oid-1" },
        poll: { type: "poll", options: [{ title: "Option A", optionIdentifier: "oid-1" }], pollMessageGuid: "pg" },
        selected: true,
        title: "Option A",
      },
    } as unknown as Message);
    expect(vote).toEqual({
      direction: "inbound",
      senderHandle: "+15550100170",
      content: { type: "poll_option", option: { title: "Option A", optionIdentifier: "oid-1" }, poll: { pollMessageGuid: "pg" }, pollMessageGuid: undefined, selected: true },
    });
    const read = toInbound({ ...base, content: { type: "read", target: { id: "m9" } } } as unknown as Message);
    expect(read?.content).toEqual({ type: "read", target: { id: "m9" } });
    expect(toInbound({ ...base, content: { type: "voice" } } as unknown as Message)).toBeUndefined();
  });
});
