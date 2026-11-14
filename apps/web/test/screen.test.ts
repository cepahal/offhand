import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedText } from '@hoverscan/contracts';
import { badgeFor, canSend, shareRow } from '../src/app/timeline.js';
import { readAloud } from '../src/app/speech.js';

const vt = (status: VerifiedText['status'], findings: VerifiedText['findings'] = []): VerifiedText => ({
  text: 'The measured lesion volume is 120 mm³.',
  status,
  findings,
  policyId: 'neuroview',
  checkedAt: '2026-11-11T00:00:00Z',
  checker: 'live',
});

describe('explanation badge', () => {
  it('is green only for verified', () => {
    expect(badgeFor(vt('verified'))).toEqual({ tone: 'ok', label: 'Checked against rulebook', reason: '' });
  });
  it('needs_review is amber with the reason underneath', () => {
    const b = badgeFor(vt('needs_review', [{ type: 'NO_TRANSLATIONS', detail: 'The checker could not read the claim.' }]));
    expect(b).toEqual({ tone: 'review', label: 'Needs review', reason: 'The checker could not read the claim.' });
  });
  it('blocked is red, and VALID findings are not shown as reasons', () => {
    const b = badgeFor(vt('blocked', [{ type: 'VALID', detail: 'ok' }, { type: 'INVALID', detail: 'Contradicts the rulebook.' }]));
    expect(b).toEqual({ tone: 'blocked', label: 'Blocked', reason: 'Contradicts the rulebook.' });
  });
  it('an unknown status is never green and never sendable', () => {
    const odd = { ...vt('verified'), status: 'maybe' } as unknown as VerifiedText;
    expect(badgeFor(odd).tone).toBe('review');
    expect(canSend(odd)).toBe(false);
  });
  it('only verified text can be sent', () => {
    expect(canSend(vt('verified'))).toBe(true);
    expect(canSend(vt('needs_review'))).toBe(false);
    expect(canSend(vt('blocked'))).toBe(false);
    expect(canSend(null)).toBe(false);
  });
});

describe('timeline rows', () => {
  it('labels votes with the poll option label', () => {
    const row = shareRow({ shareId: 's1', kind: 'vote', optionId: 'understood', selected: true, ts: 1 }, { understood: 'I understand' });
    expect(row).toEqual({ kind: 'vote', text: 'Vote: I understand', shareId: 's1' });
  });
  it('shows the not-sent reason', () => {
    const row = shareRow({ shareId: 's1', kind: 'error', detail: 'not sent: messaging unavailable. (down)', ts: 1 });
    expect(row?.text).toBe('not sent: messaging unavailable. (down)');
  });
});

describe('read aloud', () => {
  const speak = vi.fn();
  afterEach(() => {
    speak.mockReset();
    vi.unstubAllGlobals();
  });
  const stubSpeech = () => {
    vi.stubGlobal('window', { speechSynthesis: { speak, cancel: vi.fn() } });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    );
  };

  it('speaks verified text exactly as shown', () => {
    stubSpeech();
    expect(readAloud(vt('verified'), () => undefined)).toBe(true);
    expect(speak).toHaveBeenCalledOnce();
    expect((speak.mock.calls[0]![0] as { text: string }).text).toBe(vt('verified').text);
  });
  it.each(['needs_review', 'blocked'] as const)('never speaks %s text', (status) => {
    stubSpeech();
    expect(readAloud(vt(status), () => undefined)).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });
});
