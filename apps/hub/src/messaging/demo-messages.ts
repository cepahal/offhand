/**
 * Demonstration hospital and patient messages.
 *
 * Spectrum names used by the existing Photon channel, confirmed in @spectrum-ts/core and
 * @spectrum-ts/imessage 12.16.0 (dist/*.d.ts) and the Stable Photon docs
 * (photon.codes/docs/spectrum-ts, read 2026-11-12):
 *   Spectrum, text, poll(title, choices), attachment, edit, space.send,
 *   imessage(app).space.create(user, { phone }), space.phone, sender address,
 *   isDelivered, dateDelivered.
 * Photon 2.0 beta (photon.codes/docs/beta/get-started/imessage, read 2026-11-12) uses
 * `Photon` from `@photon-ai/api`, which is not installed. Beta iMessage documents text and
 * images only. That client is not called.
 */
import { containsPhoneNumber } from "@hoverscan/contracts";

interface DemoChart {
  name: string;
  mrn: string;
  procedure: string;
  medications: readonly string[];
}

export const HOSPITAL_KEYWORD = "HOSPITAL";
export const PATIENT_KEYWORD = "PATIENT";
export const SIDE_EFFECT_POLL_TITLE = "Any side effects?";
export const SIDE_EFFECT_OPTIONS = ["Yes", "No", "Call the team"] as const;
export const CLINICIAN_APPROVAL_POLICY = "clinician-approves-messages";

/** TODO(verify): Photon 2.0 beta poll method. @photon-ai/api is not installed, and the beta iMessage guide says polls are not available. */
export const BETA_POLL_API = "not configured";

export type DemoRole = "hospital" | "patient";

/** The only outbound text the registration listener may send. */
export function registrationConfirmation(role: DemoRole): string {
  return `HoverScan: registered as ${role}. You will receive updates from this line.`;
}

export function isRegistrationConfirmation(text: string): boolean {
  return text === registrationConfirmation("hospital") || text === registrationConfirmation("patient");
}
export type TimelineKind = "sent" | "delivered" | "read" | "vote";

export interface PersistedRole {
  ref: string;
  role: DemoRole;
  last4: string;
  optedInAt: string;
}

export interface MessagingEvent {
  shareId: string;
  role: DemoRole;
  recipientRef: string;
  kind: TimelineKind;
  text: string;
  at: string;
  optionId?: string;
}

export interface MessagingState {
  roles: PersistedRole[];
  /** Phone to ref. Never serialized. */
  handles: Readonly<Record<string, string>>;
  events: MessagingEvent[];
  attempted: string[];
}

export function emptyMessaging(): MessagingState {
  return { roles: [], handles: {}, events: [], attempted: [] };
}

export function last4(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "????";
}

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function refForHandle(state: MessagingState, phone: string): PersistedRole | undefined {
  const ref = state.handles[phone];
  return ref ? state.roles.find((role) => role.ref === ref) : undefined;
}

export function ingestKeyword(state: MessagingState, handle: string, text: string, now: string, newRef: () => string): { state: MessagingState; outcome: "registered" | "ignored"; role?: DemoRole } {
  const phone = normalizeHandle(handle);
  const word = text.trim().toUpperCase();
  if (!phone || (word !== HOSPITAL_KEYWORD && word !== PATIENT_KEYWORD)) return { state, outcome: "ignored" };
  const role: DemoRole = word === HOSPITAL_KEYWORD ? "hospital" : "patient";
  if (state.roles.some((item) => item.role === role) || refForHandle(state, phone)) return { state, outcome: "ignored" };
  const record: PersistedRole = { ref: newRef(), role, last4: last4(phone), optedInAt: now };
  return {
    state: { ...state, roles: [...state.roles, record], handles: { ...state.handles, [phone]: record.ref } },
    outcome: "registered",
    role,
  };
}

/** What may be written to data/recipients.json. Drops every field except ref, role, last4, and time. */
export function persistRoles(existingJson: string | null, roles: readonly PersistedRole[]): string {
  let recipients: unknown[] = [];
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson) as { recipients?: unknown };
      if (Array.isArray(parsed.recipients)) recipients = parsed.recipients;
    } catch {
      recipients = [];
    }
  }
  const safe = roles.map((role) => ({ ref: role.ref, role: role.role, last4: role.last4, optedInAt: role.optedInAt }));
  return `${JSON.stringify({ version: 1, recipients, roles: safe }, null, 2)}\n`;
}

export function logLine(event: MessagingEvent): string {
  return `${event.at} ${event.kind} ${event.role} ${event.recipientRef} ${event.shareId}`;
}

export function prescriptionText(patient: Pick<DemoChart, "name" | "medications">): string {
  const meds = patient.medications.join("; ");
  return `Prescription for ${patient.name}: ${meds}`;
}

export function hospitalUpdateText(patient: Pick<DemoChart, "name" | "mrn" | "procedure">, theatreName: string): string {
  const procedure = /tumou?r resection/i.test(patient.procedure) ? "tumour resection" : patient.procedure;
  return `${patient.name}, MRN ${patient.mrn}: prescription sent, ${procedure} scheduled, ${theatreName}.`;
}

export interface ReleaseInput {
  shareId: string;
  role: DemoRole;
  text: string;
  confirmed: boolean;
  clinicianApproved: boolean;
  /** live uses the existing Photon channel. Anything else stays on the simulated phone. */
  mode: "live" | "simulated";
  now: string;
}

export type ReleaseResult =
  | { ok: false; reason: "needs_confirm" | "needs_approval" | "duplicate" | "not_registered" | "not configured"; state: MessagingState }
  | { ok: true; transport: "simulated" | "photon"; state: MessagingState };

function scrub(text: string): string {
  return containsPhoneNumber(text) ? "not configured" : text;
}

export function releaseMessage(state: MessagingState, input: ReleaseInput): ReleaseResult {
  if (!input.confirmed) return { ok: false, reason: "needs_confirm", state };
  if (!input.clinicianApproved) return { ok: false, reason: "needs_approval", state };
  if (state.attempted.includes(input.shareId)) return { ok: false, reason: "duplicate", state };
  const record = state.roles.find((role) => role.role === input.role);
  const text = scrub(input.text);
  if (text === "not configured") return { ok: false, reason: "not configured", state };
  if (input.mode === "live") {
    if (!record) return { ok: false, reason: "not_registered", state };
    const handle = Object.entries(state.handles).find(([, ref]) => ref === record.ref)?.[0];
    if (!handle) return { ok: false, reason: "not configured", state };
    if (input.role === "patient") {
      // The beta poll client is not installed. Spectrum poll() is confirmed and is used only by the existing channel.
      void BETA_POLL_API;
    }
  }
  const recipientRef = record?.ref ?? (input.role === "hospital" ? "rcp_demohospital1" : "rcp_demopatient01");
  const next: MessagingState = {
    ...state,
    attempted: [...state.attempted, input.shareId],
    events: [...state.events, { shareId: input.shareId, role: input.role, recipientRef, kind: "sent", text, at: input.now }],
  };
  return { ok: true, transport: input.mode === "live" ? "photon" : "simulated", state: next };
}

/** Simulated phones only. Live delivery comes back from the Photon channel. */
export function advanceSimulated(state: MessagingState, shareId: string, at: string): MessagingState {
  const sent = state.events.find((event) => event.shareId === shareId && event.kind === "sent");
  if (!sent) return state;
  const has = (kind: TimelineKind) => state.events.some((event) => event.shareId === shareId && event.kind === kind);
  const extra: MessagingEvent[] = [];
  if (!has("delivered")) extra.push({ ...sent, kind: "delivered", at });
  if (!has("read")) extra.push({ ...sent, kind: "read", at });
  return extra.length === 0 ? state : { ...state, events: [...state.events, ...extra] };
}

export interface PhonePanel {
  title: string;
  badge: "SIMULATED" | "LIVE";
  last4: string | null;
  messages: { shareId: string; text: string; timeline: TimelineKind[]; poll: { title: string; options: readonly string[] } | null }[];
}

export function phonePanels(state: MessagingState, mode: "live" | "simulated", patientName: string): [PhonePanel, PhonePanel] {
  const panel = (role: DemoRole, title: string): PhonePanel => {
    const record = state.roles.find((item) => item.role === role);
    const live = mode === "live" && !!record;
    const mine = state.events.filter((event) => event.role === role && event.kind === "sent");
    return {
      title,
      badge: live ? "LIVE" : "SIMULATED",
      last4: record?.last4 ?? null,
      messages: mine.map((sent) => ({
        shareId: sent.shareId,
        text: sent.text,
        timeline: (["sent", "delivered", "read"] as const).filter((kind) => state.events.some((event) => event.shareId === sent.shareId && event.kind === kind)),
        poll: role === "patient" ? { title: SIDE_EFFECT_POLL_TITLE, options: SIDE_EFFECT_OPTIONS } : null,
      })),
    };
  };
  return [panel("hospital", "Hospital software inbox"), panel("patient", `Patient: ${patientName}`)];
}

export function renderedBlob(state: MessagingState, mode: "live" | "simulated", patientName: string): string {
  const panels = phonePanels(state, mode, patientName);
  const lines = [panels.map((item) => `${item.title} ${item.badge} ${item.last4 ?? ""} ${item.messages.map((message) => message.text).join(" ")}`).join("\n"), ...state.events.map(logLine), persistRoles(null, state.roles)];
  return lines.join("\n");
}
