import { z } from 'zod';
import { PollOption } from './common.js';

export const VERIFIED_STATUSES = ['verified', 'needs_review', 'blocked'] as const;
export type VerifiedStatus = (typeof VERIFIED_STATUSES)[number];

/** Opaque recipient id issued at opt-in. The phone number never leaves the messaging adapter. */
export const RECIPIENT_REF_PATTERN = /^rcp_[a-z0-9]{6,32}$/;

export const VerifiedText = z
  .object({
    text: z.string().describe('Text that was checked.'),
    status: z.enum(VERIFIED_STATUSES).describe('Check result. Only "verified" may be sent to a patient.'),
    findings: z
      .array(z.object({ type: z.string(), detail: z.string() }).describe('One check finding.'))
      .describe('Why the status was given.'),
    policyId: z.string().describe('Policy used.'),
    checkedAt: z.string().describe('ISO timestamp.'),
    checker: z
      .enum(['live', 'mock'])
      .optional()
      .describe('Optional (additive, 1.1.0): "live" = Bedrock Automated Reasoning, "mock" = fixture results.'),
  })
  .describe('Text after a policy check.');
export type VerifiedText = z.infer<typeof VerifiedText>;

export const ShareRequest = z
  .object({
    shareId: z.string().describe('Share id.'),
    recipientRef: z.string().describe('Opaque recipient reference (never a raw phone number in logs).'),
    bookmarks: z
      .array(z.object({ snapshotUrl: z.string(), label: z.string() }).describe('Shared view.'))
      .describe('Views to send.'),
    verified: VerifiedText,
    pollOptions: z.array(PollOption).describe('Poll options.'),
  })
  .describe('Request to send a share card to a patient.');
export type ShareRequest = z.infer<typeof ShareRequest>;

export const ShareEvent = z
  .object({
    shareId: z.string().describe('Share id.'),
    kind: z.enum(['sent', 'delivered', 'read', 'vote', 'reaction', 'error']).describe('Event kind.'),
    optionId: z.string().optional().describe('Poll option (vote).'),
    selected: z.boolean().optional().describe('Vote selected/unselected.'),
    detail: z.string().optional().describe('Extra detail.'),
    ts: z.number().describe('Epoch ms.'),
  })
  .describe('Delivery/vote/reaction event for a share.');
export type ShareEvent = z.infer<typeof ShareEvent>;
