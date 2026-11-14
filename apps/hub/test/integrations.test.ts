import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BusEnvelope, ShareEvent } from "@hoverscan/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { Bus } from "../src/bus/bus.js";
import { assertLiveReady, INTEGRATION_NAMES, loadIntegrationsConfig, type IntegrationsConfig } from "../src/integrations/config.js";
import type { ShareContext } from "../src/integrations/integration.js";
import type { LogOnlyIntegration } from "../src/integrations/log-only.js";
import { createIntegrationsModule, type IntegrationsModule } from "../src/integrations/module.js";
import { buildVoteNote, MockOpenDental, OpenDentalHttpClient, type OpenDentalIntegration } from "../src/integrations/opendental.js";
import { DEMO_STUDIES, OrthancDicomWebClient } from "../src/integrations/orthanc.js";
import {
  assertLocalSlicerUrl,
  HttpSlicerTransport,
  lookFromAxis,
  RecordingSlicerTransport,
  SLICER_ENDPOINTS,
  type SlicerIntegration,
} from "../src/integrations/slicer.js";
import { SIMULATED_PHONE_HANDLE } from "../src/messaging/mock-channel.js";
import Fastify from "fastify";
import { memoryLogger, state, tempDir } from "./helpers.js";
import { harness, VIEWER, type Harness } from "./messaging-harness.js";

/** National number only, so a copy written without the country code is still caught. */
const PHONE_DIGITS = SIMULATED_PHONE_HANDLE.replace(/\D/g, "").slice(-10);
const ALL_ON = { INTEG_LOGONLY: "on", INTEG_OPENDENTAL: "mock", INTEG_SLICER: "mock", INTEG_ORTHANC: "mock" };

function config(env: NodeJS.ProcessEnv = ALL_ON, patientsFile?: string): IntegrationsConfig {
  const cfg = loadIntegrationsConfig({ env });
  return patientsFile ? { ...cfg, opendental: { ...cfg.opendental, patientsFile } } : cfg;
}

const noShares = { shareInfo: () => undefined };

/** The module's routes on a bare Fastify instance, as the hub registers them. */
async function routesApp(m: IntegrationsModule) {
  const app = Fastify();
  m.registerRoutes!(app);
  await app.ready();
  return app;
}

function patientsFile(map: Record<string, number>): string {
  const file = join(tempDir("hoverscan-patients-"), "patients.local.json");
  writeFileSync(file, JSON.stringify({ patients: map }));
  return file;
}

let h: Harness | undefined;
let mod: IntegrationsModule | undefined;
afterEach(async () => {
  await mod?.stop?.();
  await h?.close();
  h = undefined;
  mod = undefined;
});

describe("config", () => {
  it("every integration is off unless its INTEG_ env var is set", () => {
    const off = loadIntegrationsConfig({ env: {} });
    for (const name of INTEGRATION_NAMES) expect(off[name].mode, name).toBe("off");
    const { logger } = memoryLogger();
    const m = createIntegrationsModule({ logger, bus: new Bus(), config: off, shares: noShares });
    expect(m.integrations).toEqual([]);
    expect(m.health()).toEqual({ status: "mock", detail: "Enabled: none (all INTEG_* off)" });

    for (const name of INTEGRATION_NAMES) {
      const envName = off[name].env;
      const one = loadIntegrationsConfig({ env: { [envName]: "mock" } });
      expect(INTEGRATION_NAMES.filter((n) => one[n].mode !== "off")).toEqual([name]);
    }
  });

  it("reads INTEG_ values: on means mock; anything unknown is rejected", () => {
    expect(loadIntegrationsConfig({ env: { INTEG_SLICER: "on" } }).slicer.mode).toBe("mock");
    expect(loadIntegrationsConfig({ env: { INTEG_ORTHANC: "LIVE" } }).orthanc.mode).toBe("live");
    expect(() => loadIntegrationsConfig({ env: { INTEG_OPENDENTAL: "yes" } })).toThrow(/INTEG_OPENDENTAL must be off, mock or live/);
  });

  it("declares the supported apps per integration", () => {
    const cfg = loadIntegrationsConfig({ env: {} });
    expect(cfg.opendental.apps).toEqual(["chairside", "jawline"]);
    expect(cfg.slicer.apps).toEqual(["kneeview", "neuroview"]);
    expect(cfg.orthanc.apps).toEqual(["kneeview", "neuroview"]);
  });

  it("live Open Dental refuses to start without its keys", () => {
    expect(() => assertLiveReady(loadIntegrationsConfig({ env: { INTEG_OPENDENTAL: "live" } }))).toThrow(
      /missing INTEG_OPENDENTAL_DEVELOPER_KEY, INTEG_OPENDENTAL_CUSTOMER_KEY/,
    );
  });
});

/** Real messaging module + simulated phone, with the integrations module on the same bus. */
async function voteFlow(opts: { mapped: boolean; label?: string }) {
  h = await harness();
  await h.optIn();
  const ref = h.messaging.registry.active()!.ref;
  mod = createIntegrationsModule({
    logger: memoryLoggerInto(h.lines),
    bus: h.bus,
    config: config(ALL_ON, patientsFile(opts.mapped ? { [ref]: 1897 } : {})),
    shares: h.messaging,
  });
  await mod.start();
  h.setState();
  await h.explain();
  await h.cmd({ type: "share_to_patient", bookmarkIds: [] });
  await h.confirm();
  const msg = [...h.channel.sent.values()][0]!;
  const res = await h.app.inject({
    method: "POST",
    url: "/api/messaging/mock/inbound",
    payload: { content: { type: "poll_option", option: { title: "Option A", optionIdentifier: "a" }, pollMessageGuid: msg.pollGuid, selected: true } },
  });
  expect(res.statusCode).toBe(202);
  await mod.idle();
  return { t: h, ref, opendental: mod.get<OpenDentalIntegration>("opendental")!, msg };
}

/** A logger writing into the harness's captured lines, so the phone scan covers integration logs too. */
function memoryLoggerInto(lines: string[]) {
  const { logger, lines: own } = memoryLogger("debug");
  const push = own.push.bind(own);
  own.push = (...items: string[]) => {
    lines.push(...items);
    return push(...items);
  };
  return logger;
}

describe("opendental", () => {
  it("a vote ShareEvent writes exactly one note in mock mode", async () => {
    const { opendental } = await voteFlow({ mapped: true });
    const notes = (opendental.api as MockOpenDental).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ patNum: 1897, note: expect.stringContaining('patient chose "Option A"') });
  });

  it("serves the mock notes for the debug page", async () => {
    await voteFlow({ mapped: true });
    const app = await routesApp(mod!);
    const res = await app.inject({ method: "GET", url: "/api/integrations/opendental/notes" });
    expect(res.json().notes).toHaveLength(1);
    await app.close();
  });

  it("a recipient without a mapping writes nothing and logs a warning", async () => {
    const { t, opendental } = await voteFlow({ mapped: false });
    expect((opendental.api as MockOpenDental).notes).toEqual([]);
    expect(t.lines.some((l) => l.includes("no patient mapping for this recipient"))).toBe(true);
  });

  it("no phone number appears in any note or log", async () => {
    const { t, opendental } = await voteFlow({ mapped: true });
    const output = [...(await t.allOutput()), JSON.stringify((opendental.api as MockOpenDental).notes)];
    expect(output.some((l) => l.includes("treatment plan note written"))).toBe(true);
    for (const line of output) {
      expect(line).not.toContain(SIMULATED_PHONE_HANDLE);
      expect(line.replace(/\D/g, "")).not.toContain(PHONE_DIGITS);
    }
  });

  it("refuses to build a note that contains a phone number", () => {
    const share: ShareContext = {
      shareId: randomUUID(),
      app: "chairside",
      caseId: "c",
      recipientRef: "rcp_abcdef",
      pollOptions: [{ id: "a", label: "Call +1 555 010 0199" }],
    };
    expect(buildVoteNote({ shareId: share.shareId, kind: "vote", optionId: "a", selected: true, ts: Date.now() }, share)).toBeUndefined();
  });

  it("takes votes only from the messaging module (never a client or a replay) and ignores duplicates", async () => {
    const { logger } = memoryLogger();
    const bus = new Bus();
    const shareId = randomUUID();
    const share: ShareContext = { shareId, app: "chairside", caseId: "c", recipientRef: "rcp_abcdef", pollOptions: [{ id: "a", label: "Option A" }] };
    mod = createIntegrationsModule({ logger, bus, config: config(ALL_ON, patientsFile({ rcp_abcdef: 7 })), shares: { shareInfo: () => share } });
    await mod.start();
    const vote: BusEnvelope = { ch: "share", ev: { shareId, kind: "vote", optionId: "a", selected: true, ts: 1_794_000_000_000 } };
    bus.publish(vote, VIEWER);
    await mod.idle();
    expect((mod.get<OpenDentalIntegration>("opendental")!.api as MockOpenDental).notes).toHaveLength(0);
    bus.publish(vote, "messaging");
    bus.publish(vote, "messaging");
    await mod.idle();
    expect((mod.get<OpenDentalIntegration>("opendental")!.api as MockOpenDental).notes).toHaveLength(1);
  });

  it("live client: finds the active plan, appends to its note, sends the ODFHIR header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === "GET") return Response.json([{ TreatPlanNum: 1786, PatNum: 1897, Note: "Existing.", TPStatus: "Active" }]);
      return Response.json({ TreatPlanNum: 1786 });
    }) as unknown as typeof fetch;
    const client = new OpenDentalHttpClient({ baseUrl: "https://api.opendental.com/api/v1", developerKey: "dev", customerKey: "cust", fetch: fakeFetch });
    await client.appendTreatmentPlanNote(1897, "New line.");
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "GET https://api.opendental.com/api/v1/treatplans?PatNum=1897&TPStatus=Active",
      "PUT https://api.opendental.com/api/v1/treatplans/1786",
    ]);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("ODFHIR dev/cust");
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ Note: "Existing.\nNew line." });
    expect(() => new OpenDentalHttpClient({ baseUrl: "x", developerKey: "", customerKey: "" })).toThrow("not configured");
  });
});

describe("routing", () => {
  async function routed() {
    const { logger } = memoryLogger();
    const bus = new Bus();
    const shares = new Map<string, ShareContext>();
    mod = createIntegrationsModule({ logger, bus, config: config(ALL_ON, patientsFile({ rcp_abcdef: 7 })), shares: { shareInfo: (id) => shares.get(id) } });
    await mod.start();
    return { bus, shares };
  }

  it("passes state only to integrations that support the app", async () => {
    const { bus } = await routed();
    bus.publish({ ch: "state", state: state({ app: "chairside" }) }, VIEWER);
    await mod!.idle();
    expect((mod!.get<SlicerIntegration>("slicer")!.transport as RecordingSlicerTransport).calls).toEqual([]);
    expect(mod!.get<LogOnlyIntegration>("logonly")!.entries.map((e) => e.kind)).toEqual(["state"]);

    bus.publish({ ch: "state", state: state({ app: "kneeview" }) }, VIEWER);
    await mod!.idle();
    expect((mod!.get<SlicerIntegration>("slicer")!.transport as RecordingSlicerTransport).calls).toHaveLength(2);
  });

  it("routes share events by the share's own app", async () => {
    const { bus, shares } = await routed();
    const shareId = randomUUID();
    shares.set(shareId, { shareId, app: "kneeview", caseId: "c", recipientRef: "rcp_abcdef", pollOptions: [{ id: "a", label: "Option A" }] });
    bus.publish({ ch: "state", state: state({ app: "chairside" }) }, VIEWER);
    const ev: ShareEvent = { shareId, kind: "vote", optionId: "a", selected: true, ts: Date.now() };
    bus.publish({ ch: "share", ev }, "messaging");
    await mod!.idle();
    expect((mod!.get<OpenDentalIntegration>("opendental")!.api as MockOpenDental).notes).toEqual([]);
  });
});

describe("slicer", () => {
  it.each([
    "http://192.168.1.5:2016",
    "http://example.com:2016",
    "http://127.0.0.1.evil.example:2016",
    "http://localhost.evil.example",
    "http://user@evil.example:2016",
    "http://[::1]:2016",
    "http://0.0.0.0:2016",
    "file:///tmp/x",
    "http://localhost:2016/slicer",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertLocalSlicerUrl(url)).toThrow();
  });

  it("accepts 127.0.0.1 and localhost", () => {
    expect(assertLocalSlicerUrl("http://127.0.0.1:2016").host).toBe("127.0.0.1:2016");
    expect(assertLocalSlicerUrl("http://localhost:2016").hostname).toBe("localhost");
  });

  it("refuses to start with a non-localhost INTEG_SLICER_URL", () => {
    const { logger } = memoryLogger();
    const cfg = loadIntegrationsConfig({ env: { INTEG_SLICER: "mock", INTEG_SLICER_URL: "http://10.0.0.5:2016" } });
    expect(() => createIntegrationsModule({ logger, bus: new Bus(), config: cfg, shares: noShares })).toThrow(/127.0.0.1 or localhost/);
  });

  it("the integration source never mentions exec", () => {
    const dir = join(import.meta.dirname, "../src/integrations");
    const files = readdirSync(dir).filter((f) => f.startsWith("slicer"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/exec/i);
  });

  it("calls only documented endpoints", () => {
    expect([...SLICER_ENDPOINTS]).toEqual(["/slicer/slice", "/slicer/threeD", "/slicer/mrml/file"]);
  });

  it("mock mode records only camera and slice changes", async () => {
    const { logger } = memoryLogger();
    const bus = new Bus();
    mod = createIntegrationsModule({ logger, bus, config: config({ INTEG_SLICER: "mock" }), shares: noShares });
    await mod.start();
    const calls = () => (mod!.get<SlicerIntegration>("slicer")!.transport as RecordingSlicerTransport).calls;
    // Camera on the patient's right: RAS +R is three.js -x (apps/web/src/viewer/logic.ts).
    const s = state({ app: "neuroview", slice: { plane: "axial", index: 51 }, camera: { position: [-200, 0, 0], target: [0, 0, 0], up: [0, 1, 0] } });
    bus.publish({ ch: "state", state: s }, VIEWER);
    await mod.idle();
    expect(calls().map((c) => [c.endpoint, c.params])).toEqual([
      ["/slicer/slice", { view: "red", orientation: "axial", scrollTo: "0.200" }],
      ["/slicer/threeD", { lookFromAxis: "R" }],
    ]);
    bus.publish({ ch: "state", state: { ...s, scrub: 0.5 } }, VIEWER);
    await mod.idle();
    expect(calls()).toHaveLength(2);
    bus.publish({ ch: "state", state: { ...s, slice: { plane: "sagittal", index: 255 } } }, VIEWER);
    await mod.idle();
    expect(calls().at(-1)).toMatchObject({ endpoint: "/slicer/slice", params: { view: "yellow", orientation: "sagittal", scrollTo: "1.000" } });
    expect(calls()).toHaveLength(3);
  });

  it("maps the camera to the nearest axis Slicer can look from", () => {
    expect([lookFromAxis(0, 0), lookFromAxis(90, 10), lookFromAxis(180, 0), lookFromAxis(-90, 0), lookFromAxis(30, 80), lookFromAxis(0, -60)]).toEqual([
      "A",
      "R",
      "P",
      "L",
      "S",
      "I",
    ]);
  });

  it("live transport sends plain GETs to localhost and refuses redirects", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(new Uint8Array([0x89]), { status: 200 });
    }) as unknown as typeof fetch;
    await new HttpSlicerTransport(assertLocalSlicerUrl("http://localhost:2016"), fakeFetch).request("GET", "/slicer/threeD", { lookFromAxis: "A" });
    expect(seen).toEqual([{ url: "http://localhost:2016/slicer/threeD?lookFromAxis=A", init: expect.objectContaining({ method: "GET", redirect: "error" }) }]);
  });
});

describe("orthanc", () => {
  it("mock returns the fixed demo study list over HTTP", async () => {
    const { logger } = memoryLogger("warn");
    mod = createIntegrationsModule({ logger, bus: new Bus(), config: config({ INTEG_ORTHANC: "mock" }), shares: noShares });
    const app = await routesApp(mod);
    const res = await app.inject({ method: "GET", url: "/api/integrations/orthanc/studies" });
    expect(res.json()).toEqual({ studies: DEMO_STUDIES });
    await app.close();
  });

  it("live client: GET {root}/studies with DICOM JSON, keeping only non-identifying fields", async () => {
    let requested = "";
    let accept = "";
    const fakeFetch = (async (url: string, init: RequestInit) => {
      requested = url;
      accept = (init.headers as Record<string, string>).accept!;
      return Response.json([
        {
          "0020000D": { vr: "UI", Value: ["2.25.42"] },
          "00080020": { vr: "DA", Value: ["20260115"] },
          "00081030": { vr: "LO", Value: ["Knee MRI"] },
          "00080061": { vr: "CS", Value: ["MR"] },
          "00100010": { vr: "PN", Value: [{ Alphabetic: "Should^NotLeak" }] },
        },
      ]);
    }) as unknown as typeof fetch;
    const studies = await new OrthancDicomWebClient({ baseUrl: "http://localhost:8042/dicom-web/", fetch: fakeFetch }).listStudies();
    expect(requested).toBe("http://localhost:8042/dicom-web/studies");
    expect(accept).toBe("application/dicom+json");
    expect(studies).toEqual([{ studyInstanceUid: "2.25.42", studyDate: "2026-01-15", description: "Knee MRI", modalities: ["MR"] }]);
    expect(JSON.stringify(studies)).not.toContain("NotLeak");
  });
});
