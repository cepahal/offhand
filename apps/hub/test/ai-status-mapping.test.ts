import { describe, expect, it } from "vitest";
import { AR_RESULT_TYPES, mapStatus } from "../src/ai/statusMapping.js";

describe("mapStatus", () => {
  it.each([
    ["VALID", "verified"],
    ["INVALID", "blocked"],
    ["IMPOSSIBLE", "blocked"],
    ["SATISFIABLE", "needs_review"],
    ["TRANSLATION_AMBIGUOUS", "needs_review"],
    ["TOO_COMPLEX", "needs_review"],
    ["NO_TRANSLATIONS", "needs_review"],
  ] as const)("a single %s result is %s", (type, expected) => {
    expect(mapStatus([{ type }])).toBe(expected);
  });

  it("covers every AR result type above", () => {
    expect([...AR_RESULT_TYPES].sort()).toEqual(
      ["VALID", "INVALID", "IMPOSSIBLE", "SATISFIABLE", "TRANSLATION_AMBIGUOUS", "TOO_COMPLEX", "NO_TRANSLATIONS"].sort(),
    );
  });

  it("an empty list is needs_review, never verified", () => {
    expect(mapStatus([])).toBe("needs_review");
  });

  it("VALID + INVALID is blocked", () => {
    expect(mapStatus([{ type: "VALID" }, { type: "INVALID" }])).toBe("blocked");
  });

  it("all VALID is verified; VALID + anything else is not", () => {
    expect(mapStatus(["VALID", "VALID"])).toBe("verified");
    expect(mapStatus(["VALID", "SATISFIABLE"])).toBe("needs_review");
    expect(mapStatus(["VALID", "IMPOSSIBLE"])).toBe("blocked");
    expect(mapStatus(["SATISFIABLE", "INVALID"])).toBe("blocked");
  });

  it("unknown or non-AR types are needs_review", () => {
    for (const t of ["CHECK_ERROR", "NO_FIXTURES", "VALID_WITH_LOGIC_WARNING", "valid", ""]) {
      expect(mapStatus([{ type: t }])).toBe("needs_review");
    }
  });
});
