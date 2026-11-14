/** Share events as timeline rows, and the explanation badge. Pure, so they are unit-tested. */
import type { ShareEvent, VerifiedText } from '@hoverscan/contracts';
import type { TimelineRow } from './store.js';

export function shareRow(ev: ShareEvent, labels: Record<string, string> = {}): Omit<TimelineRow, 'at'> | null {
  const id = ev.shareId;
  const option = ev.optionId ? (labels[ev.optionId] ?? ev.optionId) : (ev.detail ?? '(unknown option)');
  switch (ev.kind) {
    case 'sent':
      return { kind: 'sent', text: 'Sent', shareId: id };
    case 'delivered':
      return { kind: 'delivered', text: 'Delivered', shareId: id };
    case 'read':
      return { kind: 'read', text: 'Read', shareId: id };
    case 'vote':
      return { kind: 'vote', text: ev.selected === false ? `Vote withdrawn: ${option}` : `Vote: ${option}`, shareId: id };
    case 'reaction':
      return { kind: 'reaction', text: `Reaction: ${ev.detail ?? ''}`.trim(), shareId: id };
    case 'error':
      return { kind: 'error', text: ev.detail ?? 'Not sent.', shareId: id };
    default:
      return null;
  }
}

export type BadgeTone = 'ok' | 'review' | 'blocked';

export interface Badge {
  tone: BadgeTone;
  label: string;
  /** Why it is not verified (empty when verified). */
  reason: string;
}

/** Only status "verified" is green. Anything else, including an unknown status, is not. */
export function badgeFor(vt: VerifiedText): Badge {
  if (vt.status === 'verified') return { tone: 'ok', label: 'Checked against rulebook', reason: '' };
  const why = vt.findings
    .filter((f) => f.type !== 'VALID')
    .map((f) => f.detail ?? f.type)
    .filter(Boolean);
  const reason = why.length ? why.join(' ') : 'No reason was given.';
  if (vt.status === 'blocked') return { tone: 'blocked', label: 'Blocked', reason };
  return { tone: 'review', label: 'Needs review', reason };
}

export function canSend(vt: VerifiedText | null): boolean {
  return vt?.status === 'verified';
}
