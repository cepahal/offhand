import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preflight } from "../src/live/preflight.js";
import { liveStartupGate } from "../src/live/startup.js";
import { loadMessagingConfig, maskLine } from "../src/messaging/config.js";
import { DuplicateShareError } from "../src/messaging/patient-channel.js";
import { OPT_IN_REPLY, PhotonChannel, RECONNECTING } from "../src/messaging/photon-channel.js";
import { NOT_SENT_UNAVAILABLE } from "../src/messaging/share-flow.js";
import { harness, type Harness } from "./messaging-harness.js";
import { tempDir } from "./helpers.js";
import { FakeSpectrum, LINE, liveMessaging, PATIENT, signedHeaders, STRANGER } from "./photon-fake.js";

type Transport = "sdk" | "webhook";
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
/** National numbers, so a copy without the country code is caught too. */
const PHONE_DIGITS = [PATIENT, STRANGER, LINE].map((p) => p.replace(/\D/g, "").slice(-10));

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function setup(transport: Transport, extra: { backoffMs?: number[]; clinicInboxFile?: string; sdk?: FakeSpectrum } = {}) {
  const sdk = extra.sdk ?? new FakeSpectrum();
  h = await harness({
    messaging: liveMessaging(transport),
    photonSdk: sdk,
    photonBackoffMs: extra.backoffMs ?? [5],
    ...(extra.clinicInboxFile ? { clinicInboxFile: extra.clinicInboxFile } : {}),
  });
  const t = h;
  /** Delivers one inbound event the way the transport does: on the stream, or as a signed webhook POST. */
  const deliver = async (from: string, content: Record<string, unknown>) => {
    if (transport === "sdk") {
      const inbox = sdk.current.inbox;
      inbox.push(sdk.inbound(from, content as { type: string }));
      await vi.waitFor(() => expect(inbox.drained).toBe(true), { timeout: 2000, interval: 2 });
    } else {
      const body = JSON.stringify({ from, content });
      const res = await t.app.inject({ method: "POST", url: "/webhooks/photon", headers: signedHeaders(body), payload: body });
      expect(res.statusCode).toBe(200);
    }
    await t.settle();
  };
  const sendShare = async () => {
    await deliver(PATIENT, { type: "text", text: "HOVERSCAN" });
    t.setState();
    await t.explain();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    await t.confirm();
    const sent = t.sentEvents()[0];
    if (!sent) throw new Error(`not sent: ${t.errors().join(" | ")}`);
    const poll = sdk.sent.find((s) => s.content.type === "poll");
    const text = sdk.sent.find((s) => s.content.type === "text" && s.content.text !== OPT_IN_REPLY);
    return { shareId: sent.shareId, pollGuid: `pg-${poll!.id}`, textId: text!.id };
  };
  return { sdk, t, deliver, sendShare };
}

describe.each<Transport>(["sdk", "webhook"])("Photon live channel, %s transport (fake inbound events)", (transport) => {
  it("prints one startup line with only the last 4 digits of the line", async () => {
    const { t } = await setup(transport);
    const startup = t.lines.filter((l) => l.includes(`Photon ${transport === "sdk" ? "listener connected" : "webhook ready"} (${transport}), line ${maskLine(LINE)}`));
    expect(startup).toHaveLength(1);
    if (transport === "webhook") expect(startup[0]).toContain("Register https://hoverscan.example/webhooks/photon under Spectrum / Webhooks → Add webhook");
  });

  it("the opt-in keyword registers the sender and replies with a confirmation; other text does not", async () => {
    const { sdk, t, deliver } = await setup(transport);
    await deliver(STRANGER, { type: "text", text: "hello, is this the clinic?" });
    expect(t.messaging.registry.list()).toEqual([]);
    expect(sdk.sent).toEqual([]);

    await deliver(PATIENT, { type: "text", text: "hoverscan" });
    expect(t.messaging.registry.list()).toEqual([{ ref: expect.stringMatching(/^rcp_/), optedInAt: expect.any(Number) }]);
    expect(sdk.sent).toEqual([{ spaceId: `dm:${PATIENT}`, content: { type: "text", text: OPT_IN_REPLY }, id: expect.any(String) }]);

    await deliver(STRANGER, { type: "text", text: "STOP" });
    expect(t.messaging.registry.list()).toHaveLength(1);
    expect(sdk.sent).toHaveLength(1);
  });

  it("a poll vote becomes a ShareEvent of kind vote with the right shareId, and a read receipt a read event", async () => {
    const { t, deliver, sendShare } = await setup(transport);
    const { shareId, pollGuid, textId } = await sendShare();
    await deliver(PATIENT, {
      type: "poll_option",
      option: { title: "Option A", optionIdentifier: "oid-0" },
      poll: { type: "poll", options: [{ title: "Option A", optionIdentifier: "oid-0" }], pollMessageGuid: pollGuid },
      selected: true,
    });
    await deliver(PATIENT, { type: "read", target: { id: textId } });
    expect(t.shareEvents().filter((e) => e.kind === "vote")).toEqual([{ shareId, kind: "vote", optionId: "a", selected: true, ts: expect.any(Number) }]);
    expect(t.shareEvents().filter((e) => e.kind === "read")).toEqual([{ shareId, kind: "read", ts: expect.any(Number) }]);
  });

  it("GET /share/:shareId shows only the verified text that was sent, escaped; anything else is 404", async () => {
    const { sdk, t, sendShare } = await setup(transport);
    const { shareId, textId } = await sendShare();
    const sent = sdk.sent.find((s) => s.id === textId)!.content as unknown as { text: string };
    const page = await t.app.inject({ method: "GET", url: `/share/${shareId}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("For communication and education. Not for diagnosis.");
    const escaped = sent.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    expect(page.body).toContain(`<p>${escaped}</p>`);
    expect(PHONE_DIGITS.some((d) => page.body.replace(/\D/g, "").includes(d))).toBe(false);
    expect((await t.app.inject({ method: "GET", url: "/share/not-a-share" })).statusCode).toBe(404);
  });

  it("a vote from anyone but the share's recipient is dropped", async () => {
    const { t, deliver, sendShare } = await setup(transport);
    const { pollGuid } = await sendShare();
    await deliver(STRANGER, { type: "text", text: "HOVERSCAN" });
    await deliver(STRANGER, { type: "poll_option", option: { title: "Option A", optionIdentifier: "oid-0" }, poll: { pollMessageGuid: pollGuid }, selected: true });
    expect(t.shareEvents().filter((e) => e.kind === "vote")).toEqual([]);
  });

  it("no phone number appears in any log line, bus envelope, session record or clinic-inbox note", async () => {
    const inbox = join(tempDir(), "clinic-inbox.jsonl");
    const { t, deliver, sendShare } = await setup(transport, { clinicInboxFile: inbox });
    await deliver(STRANGER, { type: "text", text: `call me on ${STRANGER}` });
    const { pollGuid } = await sendShare();
    await deliver(PATIENT, { type: "poll_option", option: { title: "Option A", optionIdentifier: "oid-0" }, poll: { pollMessageGuid: pollGuid }, selected: true });

    expect(existsSync(inbox)).toBe(true);
    const notes = readFileSync(inbox, "utf8").trim().split("\n");
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0]!)).toMatchObject({ optionId: "a", optionLabel: "Option A", recipientRef: expect.stringMatching(/^rcp_/) });
    const output = [...(await t.allOutput()), ...notes].join("\n");
    for (const digits of PHONE_DIGITS) expect(output).not.toContain(digits);
  });

  it("Photon unreachable: the share is refused with \"not sent: messaging unavailable.\"", async () => {
    const sdk = new FakeSpectrum();
    sdk.unreachable = new Error(`connect ECONNREFUSED (line ${LINE})`);
    const { t } = await setup(transport, { sdk, backoffMs: [60_000] });
    t.setState();
    await t.explain();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    expect(t.errors().at(-1)).toMatch(new RegExp(`^${NOT_SENT_UNAVAILABLE.replace(/\./g, "\\.")}`));
    expect(t.sentEvents()).toEqual([]);
    expect(sdk.sent).toEqual([]);
    expect((await t.allOutput()).join("\n")).not.toContain(PHONE_DIGITS[2]);
  });
});

describe("Photon sdk transport: dropped connection", () => {
  it("reports reconnecting on the timeline, reconnects, and never resends a card", async () => {
    const { sdk, t, sendShare } = await setup("sdk", { backoffMs: [20] });
    const { shareId } = await sendShare();
    const sentBefore = sdk.sent.length;
    const channel = t.messaging.channel() as PhotonChannel;

    sdk.current.inbox.end();
    await tick();
    expect(channel.status()).toEqual({ up: false, reason: RECONNECTING });
    expect(t.seen).toContainEqual({ ch: "log", level: "warn", module: "messaging", msg: "messaging: reconnecting" });

    await vi.waitFor(() => expect(sdk.connections).toHaveLength(2), { timeout: 1000, interval: 10 });
    await vi.waitFor(() => expect(channel.status()).toEqual({ up: true }), { timeout: 1000, interval: 10 });
    expect(sdk.connections[0]!.stopped).toBe(true);
    expect(t.seen).toContainEqual({ ch: "log", level: "info", module: "messaging", msg: "messaging: connected" });

    expect(sdk.sent).toHaveLength(sentBefore);
    expect(t.sentEvents()).toHaveLength(1);
    const share = t.messaging.shareInfo(shareId)!;
    await expect(
      channel.send({
        shareId,
        recipientRef: share.recipientRef,
        bookmarks: [],
        pollOptions: [...share.pollOptions],
        verified: { text: "Resend attempt.", status: "verified", findings: [{ type: "VALID", detail: "x" }], policyId: "p", checkedAt: new Date().toISOString() },
      }),
    ).rejects.toBeInstanceOf(DuplicateShareError);
    expect(sdk.sent).toHaveLength(sentBefore);
  });

  it("a stream that throws is handled the same way", async () => {
    const { sdk, t } = await setup("sdk", { backoffMs: [20] });
    sdk.current.inbox.fail(new Error(`socket hang up for ${LINE}`));
    await tick();
    expect((t.messaging.channel() as PhotonChannel).status()).toEqual({ up: false, reason: RECONNECTING });
    await vi.waitFor(() => expect(sdk.connections).toHaveLength(2), { timeout: 1000, interval: 10 });
    expect((await t.allOutput()).join("\n")).not.toContain(PHONE_DIGITS[2]);
  });
});

describe("Photon webhook transport: signatures", () => {
  const body = JSON.stringify({ from: PATIENT, content: { type: "text", text: "HOVERSCAN" } });

  it("rejects an unsigned request and never processes it", async () => {
    const { t, sdk } = await setup("webhook");
    const res = await t.app.inject({ method: "POST", url: "/webhooks/photon", headers: { "content-type": "application/json" }, payload: body });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "signature rejected: missing-headers" });
    expect(t.messaging.registry.list()).toEqual([]);
    expect(sdk.sent).toEqual([]);
  });

  it("rejects a request signed with the wrong secret, or with a re-encoded body", async () => {
    const { t } = await setup("webhook");
    const wrong = await t.app.inject({ method: "POST", url: "/webhooks/photon", headers: signedHeaders(body, "not-the-secret"), payload: body });
    expect(wrong.statusCode).toBe(401);
    const reencoded = await t.app.inject({ method: "POST", url: "/webhooks/photon", headers: signedHeaders(body), payload: JSON.stringify(JSON.parse(body), null, 2) });
    expect(reencoded.statusCode).toBe(401);
    const stale = await t.app.inject({ method: "POST", url: "/webhooks/photon", headers: signedHeaders(body, undefined, Math.floor(Date.now() / 1000) - 3600), payload: body });
    expect(stale.statusCode).toBe(401);
    expect(t.messaging.registry.list()).toEqual([]);
  });

  it("is off under the sdk transport", async () => {
    const { t } = await setup("sdk");
    const res = await t.app.inject({ method: "POST", url: "/webhooks/photon", headers: signedHeaders(body), payload: body });
    expect(res.statusCode).toBe(404);
  });
});

describe("start:live transport gate", () => {
  const live = { PHOTON_PROJECT_ID: "p", PHOTON_API_KEY: "k", PHOTON_LINE: LINE, AI_CONVERSE_MODEL_ID: "m", AI_GUARDRAIL_ID: "g", AI_GUARDRAIL_VERSION: "1" };

  it("refuses an unknown PHOTON_TRANSPORT and names it", () => {
    const r = preflight({ ...live, PHOTON_TRANSPORT: "carrier-pigeon" });
    expect(r.ok).toBe(false);
    expect(r.transport).toBeUndefined();
    expect(r.missing).toContainEqual(expect.stringContaining('PHOTON_TRANSPORT must be sdk or webhook (got "carrier-pigeon")'));
    expect(() => loadMessagingConfig({ configDir: tempDir(), env: { PHOTON_MODE: "live", PHOTON_TRANSPORT: "carrier-pigeon" } })).toThrow(/PHOTON_TRANSPORT/);
  });

  it("webhook needs PHOTON_PUBLIC_URL (https) and PHOTON_WEBHOOK_SECRET", () => {
    expect(preflight({ ...live, PHOTON_TRANSPORT: "webhook" }).missing).toEqual(expect.arrayContaining(["PHOTON_PUBLIC_URL", "PHOTON_WEBHOOK_SECRET"]));
    expect(preflight({ ...live, PHOTON_TRANSPORT: "webhook", PHOTON_PUBLIC_URL: "http://x.example", PHOTON_WEBHOOK_SECRET: "s" }).missing).toContainEqual(
      expect.stringContaining("PHOTON_PUBLIC_URL (must be a bare https:// origin)"),
    );
  });

  it("prints the active transport, then exits on a missing setting", async () => {
    const out: string[] = [];
    const exit = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const saved = { ...process.env };
    try {
      Object.assign(process.env, live, { PHOTON_TRANSPORT: "webhook", PHOTON_PUBLIC_URL: "", PHOTON_WEBHOOK_SECRET: "" });
      await expect(liveStartupGate((l) => out.push(l))).rejects.toThrow("exit 1");
      expect(out[0]).toBe("HoverScan live mode. Active Photon transport: webhook");
      expect(out).toContain("  - PHOTON_PUBLIC_URL");
      process.env.PHOTON_TRANSPORT = "nope";
      out.length = 0;
      await expect(liveStartupGate((l) => out.push(l))).rejects.toThrow("exit 1");
      expect(out[0]).toBe("HoverScan live mode. Active Photon transport: none (invalid PHOTON_TRANSPORT)");
      expect(out.join("\n")).not.toContain(LINE.replace(/\D/g, "").slice(-10));
    } finally {
      process.env = saved;
      exit.mockRestore();
    }
  });
});
