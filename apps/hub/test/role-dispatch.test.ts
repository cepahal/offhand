import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DemoRoleBook } from "../src/messaging/demo-role-book.js";
import { composeRoleMessage, createDispatcher } from "../src/messaging/role-dispatch.js";

const clinic = { doctor: "OYO Clinician", hospital: "Princeton Medical Center", patientName: "Alex Johnson", patientId: "AJ-34" };
const clientId = "11111111-1111-4111-8111-111111111111";

function book(): DemoRoleBook {
  const dir = mkdtempSync(join(tmpdir(), "roles-"));
  const file = join(dir, "recipients.json");
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      recipients: [{ ref: "rcp_otherphone01", phone: "+15555550100", optedInAt: 1 }],
      roles: [{ ref: "rcp_patientrole1", role: "patient", last4: "0100", optedInAt: "t" }],
    }),
  );
  return new DemoRoleBook(file);
}

describe("role dispatch", () => {
  it("builds the patient and hospital envelopes from the clinic identity", () => {
    const patient = composeRoleMessage("patient", clinic, "0100", "Your treatment appointment has been scheduled.");
    expect(patient.subject).toBe("Treatment appointment scheduled");
    expect(patient.text).toContain("From: OYO Clinician, Princeton Medical Center");
    expect(patient.text).toContain("To: Alex Johnson (endpoint …0100)");
    expect(patient.text).not.toMatch(/\d(?:[\s().-]*\d){9,}/);
    const hospital = composeRoleMessage("hospital", clinic, "1430", "The patient's dental records have been updated.");
    expect(hospital.subject).toBe("Dental records updated");
    expect(hospital.text).toContain("From: OYO Clinician");
    expect(hospital.text).toContain("Patient ID: AJ-34");
  });

  it("resolves a role whose ref does not match the stored recipient", () => {
    expect(book().handleForRole("patient")).toBe("+15555550100");
  });

  it("refuses an unconfirmed message and sends a confirmed one only once", async () => {
    const sent: string[] = [];
    const dispatch = createDispatcher({
      clinic,
      book: book(),
      send: async (input) => {
        sent.push(input.text);
        return "delivered";
      },
    });
    const refused = await dispatch({ clientId, role: "patient", body: "Your treatment appointment has been scheduled.", confirmed: false, clinicianApproved: false });
    expect(refused.result.reason).toBe("needs confirmation");
    expect(sent).toHaveLength(0);
    const first = await dispatch({ clientId, role: "patient", body: "Your treatment appointment has been scheduled.", confirmed: true, clinicianApproved: true });
    const second = await dispatch({ clientId, role: "patient", body: "Your treatment appointment has been scheduled.", confirmed: true, clinicianApproved: true });
    expect(first.result.status).toBe("delivered");
    expect(second.result.duplicate).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Subject: Treatment appointment scheduled");
  });

  it("does not report delivered when the endpoint never confirms delivery", async () => {
    const dispatch = createDispatcher({
      clinic,
      book: book(),
      send: async () => "unconfirmed",
    });
    const result = await dispatch({
      clientId: "22222222-2222-4222-8222-222222222222",
      role: "patient",
      body: "Your treatment appointment has been scheduled.",
      confirmed: true,
      clinicianApproved: true,
    });
    expect(result.http).toBe(502);
    expect(result.result.status).toBe("failed");
    expect(result.result.reason).toBe("delivery was not confirmed");
  });
});
