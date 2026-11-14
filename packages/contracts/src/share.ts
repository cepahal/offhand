import { z } from 'zod';

export const VerifiedText = z
  .object({
    text: z.string().describe('Text that was checked.'),
    status: z.enum(['verified', 'needs_review', 'blocked']).describe('Check result.'),
    findings: z
      .array(z.object({ type: z.string(), detail: z.string() }).describe('One check finding.'))
      .describe('Why the status was given.'),
    policyId: z.string().describe('Policy used.'),
    checkedAt: z.string().describe('ISO timestamp.'),
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
    pollOptions: z
      .array(z.object({ id: z.string(), label: z.string() }).describe('Poll option.'))
      .describe('Poll options.'),
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
