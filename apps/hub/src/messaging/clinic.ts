import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "../config.js";

const ClinicFile = z.object({
  doctor: z.string().trim().min(2).max(80),
  hospital: z.string().trim().min(2).max(120),
  patientName: z.string().trim().min(2).max(80),
  patientId: z.string().trim().min(2).max(40),
});

export type ClinicIdentity = z.infer<typeof ClinicFile>;

/** Doctor, hospital, and patient labels. Env values override the config file. No phone numbers. */
export function loadClinicIdentity(env: NodeJS.ProcessEnv = process.env, file = join(REPO_ROOT, "config", "clinic.json")): ClinicIdentity {
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown) : {};
  const merged = {
    ...(typeof fromFile === "object" && fromFile ? fromFile : {}),
    ...(env.CLINIC_DOCTOR?.trim() ? { doctor: env.CLINIC_DOCTOR.trim() } : {}),
    ...(env.CLINIC_HOSPITAL?.trim() ? { hospital: env.CLINIC_HOSPITAL.trim() } : {}),
    ...(env.CLINIC_PATIENT_NAME?.trim() ? { patientName: env.CLINIC_PATIENT_NAME.trim() } : {}),
    ...(env.CLINIC_PATIENT_ID?.trim() ? { patientId: env.CLINIC_PATIENT_ID.trim() } : {}),
  };
  const parsed = ClinicFile.safeParse(merged);
  if (!parsed.success) throw new Error("clinic identity is not configured");
  return parsed.data;
}
