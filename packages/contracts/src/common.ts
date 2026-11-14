import { z } from 'zod';

export const Vec3 = z
  .tuple([z.number(), z.number(), z.number()])
  .describe('3-vector [x, y, z]. In case packs this is RAS millimetres.');
export type Vec3 = z.infer<typeof Vec3>;

export const Unit = z.number().min(0).max(1);

export const AppId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .describe('App id, e.g. "chairside", "kneeview", "neuroview", "jawline", or "test-pattern".');
export type AppId = z.infer<typeof AppId>;

/**
 * Phone-number detector shared by the hub's log masking and its no-phone checks.
 * Matches "+" followed by 7+ digits, or any run of 10+ digits, allowing spaces, dots, dashes
 * and parentheses between digits. Dates and short ids do not match; long numeric ids
 * (e.g. DICOM UIDs, epoch-ms timestamps) can, so never log those next to patient text.
 */
export const PHONE_PATTERN = String.raw`\+\s*\d(?:[\s().-]*\d){6,}|\d(?:[\s().-]*\d){9,}`;
const PHONE_RE = new RegExp(PHONE_PATTERN);

export function containsPhoneNumber(text: string): boolean {
  return PHONE_RE.test(text);
}

export const PollOption = z
  .object({ id: z.string().describe('Option id, echoed back as ShareEvent.optionId.'), label: z.string().describe('Text shown to the patient.') })
  .describe('Poll option.');
export type PollOption = z.infer<typeof PollOption>;
