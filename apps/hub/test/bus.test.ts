import type { BusEnvelope } from "@hoverscan/contracts";
import { describe, expect, it } from "vitest";
import { Bus } from "../src/bus/bus.js";

const verified = {
  text: "Test marker placed at the origin offset.",
  status: "verified",
  findings: [{ type: "VALID", detail: "ok" }],
  policyId: "chairside",
  checkedAt: "2026-11-11T22:00:00Z",
};

describe("bus routing", () => {
  it("routes a verified envelope to every subscriber with its origin", () => {
    const bus = new Bus();
    const seen: [BusEnvelope, string][] = [];
    bus.subscribe((env, origin) => seen.push([env, origin]));
    expect(bus.publish({ ch: "verified", ev: verified }, "ai")).toMatchObject({ ok: true });
    expect(seen).toEqual([[{ ch: "verified", ev: verified }, "ai"]]);
  });

  it("rejects a verified envelope that breaks the contract", () => {
    const bus = new Bus();
    const seen: BusEnvelope[] = [];
    bus.subscribe((env) => seen.push(env));
    const { policyId: _drop, ...noPolicy } = verified;
    expect(bus.publish({ ch: "verified", ev: noPolicy }, "ai").ok).toBe(false);
    expect(bus.publish({ ch: "verified", ev: { ...verified, status: "approved" } }, "ai").ok).toBe(false);
    expect(seen).toEqual([]);
  });
});
