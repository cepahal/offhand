import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CasePackManifest } from "@hoverscan/contracts";
import type { FixturesFile } from "../src/ai/mock-claim-checker.js";
import { tempDir } from "./helpers.js";

/** Geometric test pattern only; no anatomy or medical content. */
export const EXCERPT_OK = "Test marker placed at the origin offset.";
export const EXCERPT_BAD = "Second test marker beside the first.";

export function testManifest(findings = 1): CasePackManifest {
  const marker = { center: [0, 0, 0] as [number, number, number], radiusMm: 5, provenance: "measured" as const };
  const all = [
    { id: "f1", label: "Marker sphere", reportExcerpt: EXCERPT_OK, ...marker },
    { id: "f2", label: "Marker cube", reportExcerpt: EXCERPT_BAD, ...marker },
  ];
  return {
    schema: 1,
    app: "chairside",
    caseId: "test-pattern",
    title: "Test pattern — NOT ANATOMY",
    source: {
      dataset: "HoverScan test pattern (TEST PATTERN — NOT ANATOMY)",
      url: "",
      license: "CC0-1.0",
      citation: "Generated geometric test pattern; not derived from any patient or dataset.",
      subjectId: "none",
    },
    deidentified: true,
    coordinateSystem: "RAS",
    units: "mm",
    layers: [
      { id: "outer", label: "Outer cube", file: "layers/outer.glb", color: "#3366cc", defaultOpacity: 1, peelOrder: 0, kind: "surface" },
    ],
    volumes: [],
    findings: all.slice(0, findings),
    share: { templateId: "default", pollOptions: [{ id: "a", label: "Option A" }] },
    policyId: "chairside",
  };
}

export const testFixtures: FixturesFile = {
  cases: [
    { text: EXCERPT_OK, results: [{ type: "VALID", detail: "Matches test rule R1." }] },
    {
      text: EXCERPT_BAD,
      results: [
        { type: "VALID", detail: "Matches test rule R1." },
        { type: "INVALID", detail: "Contradicts test rule R2." },
      ],
    },
  ],
};

/** Writes a case pack and policies tree into a temp dir. */
export function writeAiTree(opts: { findings?: number; fixtures?: FixturesFile | string | null } = {}) {
  const root = tempDir("hoverscan-ai-");
  const casepackDir = join(root, "casepacks");
  const policiesDir = join(root, "policies");
  const caseDir = join(casepackDir, "chairside", "test-pattern");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, "manifest.json"), JSON.stringify(testManifest(opts.findings ?? 1)));
  mkdirSync(join(policiesDir, "chairside"), { recursive: true });
  const fixtures = opts.fixtures === undefined ? testFixtures : opts.fixtures;
  if (fixtures !== null) {
    writeFileSync(
      join(policiesDir, "chairside", "fixtures.json"),
      typeof fixtures === "string" ? fixtures : JSON.stringify(fixtures),
    );
  }
  return { root, casepackDir, policiesDir };
}
