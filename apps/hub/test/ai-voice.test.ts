import { ViewerCommand } from "@hoverscan/contracts";
import { describe, expect, it } from "vitest";
import { MockVoiceAgent } from "../src/ai/mock-voice-agent.js";
import { UNMATCHED_REPLY, type VoiceContext } from "../src/ai/voice-agent.js";
import { state } from "./helpers.js";

const agent = new MockVoiceAgent();
const one: VoiceContext = { state: state(), findings: [{ id: "f1", label: "Marker sphere" }] };

async function only(text: string, ctx: VoiceContext = one) {
  const r = await agent.handle(text, ctx);
  expect(r.commands).toHaveLength(1);
  const cmd = r.commands[0]!;
  expect(ViewerCommand.parse(cmd)).toEqual(cmd);
  expect(cmd.source).toBe("voice");
  expect(r.envelopes).toEqual([{ ch: "voice", ev: { kind: "tool", tool: cmd.type } }]);
  return cmd;
}

describe("MockVoiceAgent phrases", () => {
  it.each([
    ["show me the finding", { type: "focus_finding", findingId: "f1" }],
    ["Go to the finding.", { type: "focus_finding", findingId: "f1" }],
    ["explain", { type: "explain" }],
    ["Explain it", { type: "explain" }],
    ["send it to the patient", { type: "share_to_patient", bookmarkIds: [] }],
    ["send to patient", { type: "share_to_patient", bookmarkIds: [] }],
    ["zoom in", { type: "zoom", factor: 1.25 }],
    ["zoom out", { type: "zoom", factor: 0.8 }],
    ["rotate left", { type: "rotate", yawDeg: -30 }],
    ["rotate right", { type: "rotate", yawDeg: 30 }],
    ["reset", { type: "reset_view" }],
  ])("%j", async (text, expected) => {
    expect(await only(text)).toMatchObject(expected);
  });

  it("confirm uses the pending action id", async () => {
    const ctx = { ...one, state: state({ pending: { confirmFor: "share:b1" } }) };
    expect(await only("confirm", ctx)).toMatchObject({ type: "confirm", for: "share:b1" });
  });

  it("cancel uses the pending action id, and emits nothing when nothing is pending", async () => {
    const ctx = { ...one, state: state({ pending: { confirmFor: "share:b1" } }) };
    expect(await only("cancel", ctx)).toMatchObject({ type: "cancel", for: "share:b1" });
    expect((await agent.handle("cancel", one)).commands).toEqual([]);
  });

  it("confirm with nothing pending emits no command", async () => {
    const r = await agent.handle("confirm", one);
    expect(r.commands).toEqual([]);
    expect(r.envelopes[0]?.ev.kind).toBe("transcript");
  });

  it("explain carries the focused finding", async () => {
    const ctx = { ...one, state: state({ focusedFindingId: "f1" }) };
    expect(await only("explain it", ctx)).toMatchObject({ type: "explain", findingId: "f1" });
  });

  it("chains phrases and carries the finding into explain", async () => {
    const r = await agent.handle("show me the finding and explain it", one);
    expect(r.commands.map((c) => c.type)).toEqual(["focus_finding", "explain"]);
    expect(r.commands[1]).toMatchObject({ findingId: "f1" });
  });

  it("asks which finding when there are several and none is focused", async () => {
    const r = await agent.handle("show me the finding", {
      state: state(),
      findings: [
        { id: "f1", label: "Marker sphere" },
        { id: "f2", label: "Marker cube" },
      ],
    });
    expect(r.commands).toEqual([]);
    expect(r.envelopes[0]?.ev.text).toContain("Which finding?");
  });
});

describe("MockVoiceAgent never guesses", () => {
  it.each(["", "what is this", "explain the marker", "zoom", "send it to my doctor", "rotate left and fly away", "show me everything"])(
    "%j gives no commands and the help reply",
    async (text) => {
      const r = await agent.handle(text, one);
      expect(r.commands).toEqual([]);
      expect(r.envelopes).toEqual([{ ch: "voice", ev: { kind: "transcript", text: UNMATCHED_REPLY } }]);
    },
  );
});
