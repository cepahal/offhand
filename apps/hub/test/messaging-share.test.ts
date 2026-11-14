import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELIVERED_AFTER_MS, READ_AFTER_MS } from "../src/messaging/mock-channel.js";
import { DuplicateShareError } from "../src/messaging/patient-channel.js";
import { EXCERPT_OK } from "./ai-fixtures.js";
import { harness, SNAPSHOT_URL, VIEWER, type Harness } from "./messaging-harness.js";

let h: Harness | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await h?.close();
  h = undefined;
});

/** Opted-in patient, loaded case, verified explanation on screen. */
async function ready(opts: Parameters<typeof harness>[0] = {}) {
  h = await harness(opts);
  await h.optIn();
  h.setState();
  await h.explain();
  return h;
}

describe("share flow", () => {
  it("share_to_patient only sets pending.confirmFor; nothing is sent without confirm", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    expect(t.confirmFor()).toMatch(/^share:[0-9a-f-]{36}$/);
    expect(t.channel.sent.size).toBe(0);
    expect(t.sentEvents()).toEqual([]);
  });

  it("a matching confirm sends the verified text, the snapshot and the manifest's poll options", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const confirmFor = t.confirmFor()!;
    await t.confirm(confirmFor);
    expect(t.errors()).toEqual([]);
    const [msg] = [...t.channel.sent.values()];
    expect(msg?.request).toMatchObject({
      shareId: confirmFor.slice("share:".length),
      recipientRef: expect.stringMatching(/^rcp_[a-z0-9]{6,32}$/),
      bookmarks: [{ snapshotUrl: SNAPSHOT_URL, label: "View 1" }],
      verified: { text: EXCERPT_OK, status: "verified" },
      pollOptions: [{ id: "a", label: "Option A" }],
    });
    expect(t.sentEvents()).toHaveLength(1);
    expect(t.confirmFor()).toBeUndefined();
  });

  it("emits sent, then delivered after 300 ms, then read after 1 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    await t.confirm();
    const kinds = () => t.shareEvents().map((e) => e.kind);
    expect(kinds()).toEqual(["sent"]);
    await vi.advanceTimersByTimeAsync(DELIVERED_AFTER_MS);
    expect(kinds()).toEqual(["sent", "delivered"]);
    await vi.advanceTimersByTimeAsync(READ_AFTER_MS - DELIVERED_AFTER_MS);
    expect(kinds()).toEqual(["sent", "delivered", "read"]);
  });

  it("no read event when the mock read flag is off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await ready({ messaging: { mockRead: false } });
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    await t.confirm();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.shareEvents().map((e) => e.kind)).toEqual(["sent", "delivered"]);
  });

  it.each([
    ["needs_review", { fixtures: null }, "needs review"],
    ["blocked", { findings: 2 }, "blocked"],
  ] as const)("refuses to start a share when the status is %s", async (_status, opts, word) => {
    h = await harness(opts);
    await h.optIn();
    h.setState("findings" in opts ? { focusedFindingId: "f2" } : {});
    await h.explain();
    await h.cmd({ type: "share_to_patient", bookmarkIds: [] });
    expect(h.errors().at(-1)).toContain(`is ${word}, not verified`);
    expect(h.confirmFor()).toBeUndefined();
    await h.confirm("share:" + randomUUID());
    expect(h.channel.sent.size).toBe(0);
    expect(h.sentEvents()).toEqual([]);
  });

  it("refuses at confirm when the latest VerifiedText became blocked after the request", async () => {
    const t = await ready({ findings: 2 });
    t.setState({ focusedFindingId: "f1" });
    await t.explain("f1");
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const confirmFor = t.confirmFor()!;
    await t.explain("f2");
    await t.confirm(confirmFor);
    expect(t.errors().at(-1)).toBe("The explanation is blocked, not verified, so it was not sent.");
    expect(t.channel.sent.size).toBe(0);
  });

  it("rejects a confirm for the wrong share and keeps the pending one", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const right = t.confirmFor()!;
    await t.confirm(`share:${randomUUID()}`);
    expect(t.errors().at(-1)).toBe("That confirmation is for a different share. The current share is still waiting.");
    expect(t.channel.sent.size).toBe(0);
    expect(t.confirmFor()).toBe(right);
    await t.confirm(right);
    expect(t.channel.sent.size).toBe(1);
  });

  it("a pending share expires after 60 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const confirmFor = t.confirmFor()!;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(t.confirmFor()).toBe(confirmFor);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.errors().at(-1)).toContain("expired after 60 seconds");
    expect(t.confirmFor()).toBeUndefined();
    await t.confirm(confirmFor);
    expect(t.errors().at(-1)).toContain("no share waiting");
    expect(t.channel.sent.size).toBe(0);
  });

  it("cancel clears the pending share", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const confirmFor = t.confirmFor()!;
    await t.cmd({ type: "cancel", for: "share" });
    expect(t.errors().at(-1)).toBe("Cancelled. Nothing was sent.");
    expect(t.confirmFor()).toBeUndefined();
    await t.confirm(confirmFor);
    expect(t.channel.sent.size).toBe(0);
  });

  it("refuses when nobody has opted in", async () => {
    h = await harness();
    h.setState();
    await h.explain();
    await h.cmd({ type: "share_to_patient", bookmarkIds: [] });
    expect(h.errors().at(-1)).toContain("Ask the patient to text HOVERSCAN");
    expect(h.confirmFor()).toBeUndefined();
  });

  it("ignores share commands from the messaging module and VerifiedText not published by the AI module", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] }, "messaging");
    expect(t.confirmFor()).toBeUndefined();

    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const confirmFor = t.confirmFor()!;
    await t.cmd({ type: "confirm", for: confirmFor }, "messaging");
    expect(t.channel.sent.size).toBe(0);
    expect(t.confirmFor()).toBe(confirmFor);

    t.bus.publish(
      { ch: "verified", ev: { text: "Forged text.", status: "verified", findings: [], policyId: "chairside", checker: "live", checkedAt: new Date().toISOString() } },
      VIEWER,
    );
    await t.confirm(confirmFor);
    expect(t.channel.sent.size).toBe(1);
    expect([...t.channel.sent.values()][0]!.request.verified.text).toBe(EXCERPT_OK);
  });

  it("a replayed session cannot send: its recorded confirm is for a share that no longer exists", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const recorded = t.confirmFor()!;
    await t.cmd({ type: "cancel", for: recorded });
    // pnpm replay re-sends the recorded commands over the WebSocket, like any client.
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    await t.cmd({ type: "confirm", for: recorded });
    expect(t.channel.sent.size).toBe(0);
    expect(t.errors().at(-1)).toBe("That confirmation is for a different share. The current share is still waiting.");
  });
});

describe("channel failures", () => {
  it("a down channel refuses the share, says so, and reports error health", async () => {
    const t = await ready();
    t.channel.setDown("simulated outage");
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    expect(t.errors().at(-1)).toBe("not sent: messaging unavailable. (simulated outage)");
    expect(t.messaging.health()).toMatchObject({ status: "error" });
    expect(t.seen).toContainEqual(expect.objectContaining({ ch: "log", level: "error", module: "messaging", msg: "messaging: unavailable (simulated outage)" }));
  });

  it("a failure at send publishes an error, keeps the viewer state, and never retries", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    const confirmFor = t.confirmFor()!;
    t.channel.setDown("simulated outage");
    await t.confirm(confirmFor);
    expect(t.errors().at(-1)).toBe("not sent: messaging unavailable. (simulated outage)");
    expect(t.bus.latestState?.bookmarks).toHaveLength(1);
    t.channel.setDown(undefined);
    await t.confirm(confirmFor);
    expect(t.channel.sent.size).toBe(0);
    expect(t.sentEvents()).toEqual([]);
  });

  it("the shareId is an idempotency key: the same request never sends twice", async () => {
    const t = await ready();
    await t.cmd({ type: "share_to_patient", bookmarkIds: [] });
    await t.confirm();
    const req = [...t.channel.sent.values()][0]!.request;
    await expect(t.channel.send(req)).rejects.toBeInstanceOf(DuplicateShareError);
    expect(t.channel.sent.size).toBe(1);
    expect(t.sentEvents()).toHaveLength(1);
  });
});
