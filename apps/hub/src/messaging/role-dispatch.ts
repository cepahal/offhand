import { randomUUID } from "node:crypto";
import { containsPhoneNumber } from "@hoverscan/contracts";
import { z } from "zod";
import type { ClinicIdentity } from "./clinic.js";
import { last4, type DemoRole } from "./demo-messages.js";
import type { DemoRoleBook } from "./demo-role-book.js";

export const LISTEN_PORT = 8791;

const RequestBody = z.object({
  clientId: z.string().uuid(),
  role: z.enum(["patient", "hospital"]),
  body: z.string().trim().min(1).max(500),
  confirmed: z.boolean(),
  clinicianApproved: z.boolean(),
});

export interface DispatchResult {
  status: "delivered" | "failed";
  role?: DemoRole;
  subject?: string;
  last4?: string;
  reason?: string;
  duplicate?: boolean;
}

export interface DispatchDeps {
  clinic: ClinicIdentity;
  book: DemoRoleBook;
  send: (input: { shareId: string; handle: string; text: string }) => Promise<"delivered" | "unconfirmed">;
  now?: () => number;
}

interface Memory {
  at: number;
  result: DispatchResult;
}

export function patientSubject(body: string): string {
  return /appointment/i.test(body) ? "Treatment appointment scheduled" : "Message for the patient";
}

export function hospitalSubject(body: string): string {
  return /record/i.test(body) ? "Dental records updated" : "Hospital update";
}

/** Structured text. The patient endpoint is named by its last four digits, never the full number. */
export function composeRoleMessage(role: DemoRole, clinic: ClinicIdentity, endpointLast4: string, body: string): { subject: string; text: string } {
  if (role === "patient") {
    const subject = patientSubject(body);
    const text = [`From: ${clinic.doctor}, ${clinic.hospital}`, `To: ${clinic.patientName} (endpoint …${endpointLast4})`, `Subject: ${subject}`, "", body].join("\n");
    return { subject, text };
  }
  const subject = hospitalSubject(body);
  const text = [`From: ${clinic.doctor}`, `Patient ID: ${clinic.patientId}`, `Subject: ${subject}`, "", body].join("\n");
  return { subject, text };
}

/** One send per client id, and one delivered send per role and body inside a minute. */
export function createDispatcher(deps: DispatchDeps): (body: unknown) => Promise<{ http: number; result: DispatchResult }> {
  const byClient = new Map<string, Memory>();
  const delivered = new Map<string, Memory>();
  const now = deps.now ?? Date.now;
  return async (body) => {
    const parsed = RequestBody.safeParse(body);
    if (!parsed.success) return { http: 400, result: { status: "failed", reason: "invalid message" } };
    if (parsed.data.confirmed !== true || parsed.data.clinicianApproved !== true) {
      return { http: 409, result: { status: "failed", reason: "needs confirmation" } };
    }
    const seen = byClient.get(parsed.data.clientId);
    if (seen) return { http: 200, result: { ...seen.result, duplicate: true } };
    const fingerprint = `${parsed.data.role}:${parsed.data.body.toLowerCase()}`;
    const prior = delivered.get(fingerprint);
    if (prior && now() - prior.at < 60_000) return { http: 200, result: { ...prior.result, duplicate: true } };
    const record = deps.book.state.roles.find((item) => item.role === parsed.data.role);
    const handle = deps.book.handleForRole(parsed.data.role);
    if (!record || !handle) {
      const result: DispatchResult = { status: "failed", role: parsed.data.role, reason: `${parsed.data.role} endpoint is not registered` };
      byClient.set(parsed.data.clientId, { at: now(), result });
      return { http: 409, result };
    }
    const composed = composeRoleMessage(parsed.data.role, deps.clinic, record.last4, parsed.data.body);
    if (containsPhoneNumber(composed.text) || last4(handle) !== record.last4) {
      const result: DispatchResult = { status: "failed", role: parsed.data.role, reason: "message was refused" };
      byClient.set(parsed.data.clientId, { at: now(), result });
      return { http: 409, result };
    }
    try {
      const outcome = await deps.send({ shareId: randomUUID(), handle, text: composed.text });
      const result: DispatchResult =
        outcome === "delivered"
          ? { status: "delivered", role: parsed.data.role, subject: composed.subject, last4: record.last4 }
          : { status: "failed", role: parsed.data.role, subject: composed.subject, last4: record.last4, reason: "delivery was not confirmed" };
      const memory = { at: now(), result };
      byClient.set(parsed.data.clientId, memory);
      if (result.status === "delivered") delivered.set(fingerprint, memory);
      return { http: result.status === "delivered" ? 200 : 502, result };
    } catch {
      const result: DispatchResult = { status: "failed", role: parsed.data.role, subject: composed.subject, reason: "Photon send failed" };
      byClient.set(parsed.data.clientId, { at: now(), result });
      return { http: 503, result };
    }
  };
}
