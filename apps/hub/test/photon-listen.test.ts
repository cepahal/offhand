import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registrationConfirmation } from "../src/messaging/demo-messages.js";
import { DemoRoleBook } from "../src/messaging/demo-role-book.js";
import { InboundRouter, ShareLedger } from "../src/messaging/inbound.js";
import { ignoredLine, listenBanner, photonListenProblems, registeredLine, safeListenError, waitingLine } from "../src/messaging/photon-listen-env.js";
import { PhotonChannel } from "../src/messaging/photon-channel.js";
import { applyRegistration, openRegistrationListener } from "../src/messaging/registration-listen.js";
import { RecipientRegistry } from "../src/messaging/recipients.js";
import { memoryLogger, messagingConfig, tempDir } from "./helpers.js";
import { FakeSpectrum, LINE, liveMessaging } from "./photon-fake.js";

const HOSPITAL = "+15550100901";
const PATIENT = "+15550100902";
const HOSPITAL_DIGITS = "5550100901";
const PATIENT_DIGITS = "5550100902";
const SECRET = "sk_live_SHOULD_NOT_PRINT";

function pair(dir = tempDir()) {
  const file = join(dir, "recipients.json");
  const book = new DemoRoleBook(file);
  const registry = new RecipientRegistry(file, { optIn: "HOVERSCAN", optOut: "STOP" });
  const { logger, lines } = memoryLogger("info");
  const printed: string[] = [];
  const send = (handle: string, text: string) => {
    const turn = applyRegistration(book, registry, handle, text, logger);
    printed.push(...turn.lines);
    return turn;
  };
  return { file, book, registry, logger, lines, printed, send };
}

describe("photon:listen settings", () => {
  it("names each failed setting and never prints the key or the line", () => {
    const problems = photonListenProblems({
      PHOTON_MODE: "mock",
      PHOTON_TRANSPORT: "webhook",
      PHOTON_API_KEY: SECRET,
      PHOTON_LINE: HOSPITAL,
    });
    expect(problems).toEqual(["PHOTON_MODE must be live", "PHOTON_TRANSPORT must be sdk", "PHOTON_PROJECT_ID is not set"]);
    const blob = problems.join("\n");
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain(HOSPITAL);
    expect(blob).not.toContain(HOSPITAL_DIGITS);
    expect(photonListenProblems({})).toEqual([
      "PHOTON_MODE must be live",
      "PHOTON_TRANSPORT must be sdk",
      "PHOTON_PROJECT_ID is not set",
      "PHOTON_API_KEY is not set",
      "PHOTON_LINE is not set",
    ]);
  });

  it("does not require the guardrail ids", () => {
    expect(
      photonListenProblems({
        PHOTON_MODE: "live",
        PHOTON_TRANSPORT: "sdk",
        PHOTON_PROJECT_ID: "proj",
        PHOTON_API_KEY: SECRET,
        PHOTON_LINE: LINE,
      }),
    ).toEqual([]);
    expect(safeListenError(`failed ${SECRET} on ${LINE}`, { PHOTON_API_KEY: SECRET, PHOTON_LINE: LINE })).toBe("failed *** on ***");
    expect(listenBanner("0123")).toBe("Photon listening on line ending 0123. Text HOSPITAL or PATIENT to register. Ctrl+C to stop.");
    expect(listenBanner("0123")).not.toContain(LINE);
  });
});

describe("registration keywords", () => {
  it("HOSPITAL registers a hospital role and PATIENT registers a patient role", () => {
    const { send, book, registry, file, lines } = pair();
    const hospital = send(HOSPITAL, "  hospital ");
    const patient = send(PATIENT, "Patient");
    expect(hospital.reply).toBe(registrationConfirmation("hospital"));
    expect(patient.reply).toBe(registrationConfirmation("patient"));
    expect(hospital.ref).toMatch(/^rcp_[a-z0-9]{6,32}$/);
    expect(patient.ref).toMatch(/^rcp_[a-z0-9]{6,32}$/);
    expect(hospital.ref).not.toBe(patient.ref);
    expect(book.state.roles.map((role) => role.role)).toEqual(["hospital", "patient"]);
    expect(registry.handleFor(hospital.ref!)).toBe(HOSPITAL);
    expect(registry.handleFor(patient.ref!)).toBe(PATIENT);
    expect(registry.active()).toBeUndefined();

    const saved = JSON.parse(readFileSync(file, "utf8")) as {
      roles: { ref: string; phone?: string }[];
      recipients: { ref: string; phone: string }[];
    };
    expect(saved.roles.map((role) => role.ref)).toEqual([hospital.ref, patient.ref]);
    expect(saved.roles.some((role) => "phone" in role)).toBe(false);
    expect(JSON.stringify(saved.roles)).not.toContain(HOSPITAL_DIGITS);
    expect(JSON.stringify(saved.roles)).not.toContain(PATIENT_DIGITS);
    expect(saved.recipients.map((entry) => entry.ref)).toEqual([hospital.ref, patient.ref]);
    expect(new RecipientRegistry(file, { optIn: "HOVERSCAN", optOut: "STOP" }).active()).toBeUndefined();
    expect(lines.join("\n")).toContain(hospital.ref!);
    expect(lines.join("\n")).not.toContain(HOSPITAL_DIGITS);
    expect(lines.join("\n")).not.toContain(PATIENT);
  });

  it("other text does not register, and a second HOSPITAL from the same sender is not a duplicate", () => {
    const { send, book, registry, printed } = pair();
    expect(send("+15550100903", "hello").reply).toBeUndefined();
    expect(send("+15550100903", "HOVERSCAN").reply).toBeUndefined();
    expect(book.state.roles).toEqual([]);
    expect(registry.list()).toEqual([]);
    expect(printed).toEqual([ignoredLine("0903"), ignoredLine("0903")]);

    const first = send(HOSPITAL, "HOSPITAL");
    const again = send(HOSPITAL, "hospital");
    expect(again.reply).toBeUndefined();
    expect(again.lines).toEqual([]);
    expect(book.state.roles).toHaveLength(1);
    expect(registry.list()).toHaveLength(1);
    expect(printed.filter((line) => line.startsWith("registered"))).toEqual([registeredLine("hospital", "0901")]);
    expect(first.ref).toBe(book.state.roles[0]!.ref);
  });

  it("a restart keeps the saved phone, so the same keyword is not treated as a stranger", () => {
    const first = pair();
    first.send(PATIENT, "PATIENT");
    const again = pair(join(first.file, ".."));
    const turn = again.send(PATIENT, "PATIENT");
    expect(turn.reply).toBeUndefined();
    expect(turn.lines).toEqual([]);
    expect(again.book.state.roles).toHaveLength(1);
  });

  it("no full phone number appears in any printed line", () => {
    const { send, printed, lines } = pair();
    send(HOSPITAL, "HOSPITAL");
    send(PATIENT, "PATIENT");
    send("+15550100903", `call me at ${HOSPITAL}`);
    const blob = [...printed, listenBanner("0123"), ...lines].join("\n");
    expect(blob).not.toContain(HOSPITAL);
    expect(blob).not.toContain(PATIENT);
    expect(blob).not.toContain(HOSPITAL_DIGITS);
    expect(blob).not.toContain(PATIENT_DIGITS);
    expect(blob).not.toContain("5550100903");
    expect(blob).toContain(registeredLine("hospital", "0901"));
    expect(blob).toContain(registeredLine("patient", "0902"));
    expect(blob).toContain(ignoredLine("0903"));
    expect(blob).not.toContain("Prescription");
    expect(blob).not.toContain("Any side effects");
  });
});

describe("registration channel", () => {
  let channel: PhotonChannel | undefined;
  afterEach(async () => {
    await channel?.stop();
    channel = undefined;
  });

  it("sends only the confirmation, and drops any other reply", async () => {
    const sdk = new FakeSpectrum();
    const printed: string[] = [];
    const { logger } = memoryLogger("info");
    const cfg = messagingConfig({ ...liveMessaging("sdk"), recipientsFile: join(tempDir(), "recipients.json"), line: LINE });
    channel = openRegistrationListener({ config: cfg, logger, print: (line) => printed.push(line), sdk });
    await channel.start();
    expect(printed).toEqual([listenBanner("0123"), waitingLine("hospital"), waitingLine("patient")]);
    expect(printed.join("\n")).not.toContain(LINE.replace(/\D/g, ""));

    const inbox = sdk.current.inbox;
    const deliver = async (from: string, text: string) => {
      inbox.push(sdk.inbound(from, { type: "text", text }));
      await vi.waitFor(() => expect(inbox.drained).toBe(true), { timeout: 2000, interval: 2 });
    };
    await deliver(HOSPITAL, "HOSPITAL");
    await deliver(HOSPITAL, "HOSPITAL");
    await deliver(PATIENT, "PATIENT");
    await deliver("+15550100903", "hello");
    expect(sdk.sent.map((item) => item.content)).toEqual([
      { type: "text", text: registrationConfirmation("hospital") },
      { type: "text", text: registrationConfirmation("patient") },
    ]);
    expect(sdk.sent.some((item) => item.content.type === "poll")).toBe(false);

    await channel.stop();
    channel = undefined;

    const gate = new PhotonChannel(cfg, {
      registry: new RecipientRegistry(join(tempDir(), "r.json"), { optIn: "HOVERSCAN", optOut: "STOP" }),
      ledger: new ShareLedger(),
      router: new InboundRouter({
        registry: new RecipientRegistry(join(tempDir(), "r2.json"), { optIn: "HOVERSCAN", optOut: "STOP" }),
        ledger: new ShareLedger(),
        emit: () => undefined,
        logger,
      }),
      logger,
      snapshotDir: tempDir(),
      sdk,
      listen: { onText: () => "Prescription for Alex Wu: Levetiracetam 500 mg twice daily" },
    });
    channel = gate;
    await gate.start();
    const next = sdk.current.inbox;
    next.push(sdk.inbound(PATIENT, { type: "text", text: "PATIENT" }));
    await vi.waitFor(() => expect(next.drained).toBe(true), { timeout: 2000, interval: 2 });
    expect(sdk.sent).toHaveLength(2);
  });

  it("registers PATIENT when the line is the shared pool", async () => {
    const sdk = new FakeSpectrum();
    const printed: string[] = [];
    const { logger } = memoryLogger("info");
    const cfg = messagingConfig({ ...liveMessaging("sdk"), recipientsFile: join(tempDir(), "recipients.json"), line: LINE });
    channel = openRegistrationListener({ config: cfg, logger, print: (line) => printed.push(line), sdk });
    await channel.start();
    const [space, message] = sdk.inbound(PATIENT, { type: "text", text: "patient" });
    (space as unknown as { phone: string }).phone = "shared";
    const inbox = sdk.current.inbox;
    inbox.push([space, message]);
    await vi.waitFor(() => expect(inbox.drained).toBe(true), { timeout: 2000, interval: 2 });
    expect(printed).toContain(registeredLine("patient", "0902"));
    expect(sdk.sent.map((item) => item.content)).toEqual([{ type: "text", text: registrationConfirmation("patient") }]);
  });
});
