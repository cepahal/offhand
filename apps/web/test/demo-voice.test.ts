import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { patients } from '../src/demo/data.js';
import { auditEntries } from '../src/demo/logic.js';
import { emptyVoiceMemory, handleUtterance } from '../src/demo/voice-apply.js';
import { EMERGENCY_TEXT, RECIPIENT_QUESTION, UNKNOWN_SAY, parseUtterance, type VoiceIntent } from '../src/demo/voice-intent.js';
import { probeWhisper, transcribeWav } from '../src/demo/voice-listen.js';

const NOW = '2026-11-12T17:00:00.000Z';

interface Fixture {
  phrase: string;
  intent: VoiceIntent['type'];
  mrn?: string;
  reason?: 'mismatch' | 'ambiguous';
  target?: 'tumour' | 'lesion';
  field?: string;
  value?: string;
  draft?: 'prescription' | 'hospital_update';
}

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/demo-voice.json', import.meta.url), 'utf8')) as Fixture[];

describe('voice fixtures', () => {
  it('parses every fixture phrase', () => {
    expect(fixtures).toHaveLength(30);
    for (const fixture of fixtures) {
      const parsed = parseUtterance(fixture.phrase, patients);
      expect(parsed.intent.type, fixture.phrase).toBe(fixture.intent);
      if (parsed.intent.type === 'open_patient') expect(parsed.intent.mrn, fixture.phrase).toBe(fixture.mrn);
      if (parsed.intent.type === 'refuse') expect(parsed.intent.reason, fixture.phrase).toBe(fixture.reason);
      if (parsed.intent.type === 'show_finding') expect(parsed.intent.target, fixture.phrase).toBe(fixture.target);
      if (parsed.intent.type === 'propose_edit') {
        expect(parsed.intent.field, fixture.phrase).toBe(fixture.field);
        expect(parsed.intent.value, fixture.phrase).toBe(fixture.value);
      }
      if (parsed.intent.type === 'open_draft') expect(parsed.intent.draft, fixture.phrase).toBe(fixture.draft);
      if (parsed.intent.type === 'unknown') expect(parsed.say, fixture.phrase).toBe(UNKNOWN_SAY);
    }
  });
});

describe('voice confirm gate', () => {
  it('keeps an edit pending until confirm', () => {
    const proposed = handleUtterance('change allergy to latex', emptyVoiceMemory(), patients, '123132', NOW, 'edit-1');
    expect(proposed.memory.edits[0]?.status).toBe('pending');
    expect(proposed.say).toBe('Say confirm to save.');
    expect(auditEntries(proposed.memory.edits)).toEqual([]);
    expect(proposed.memory.pending).toEqual({ kind: 'edit', id: 'edit-1' });

    const ignored = handleUtterance('open MRI scans', proposed.memory, patients, '123132', NOW, 'mri-1');
    expect(auditEntries(ignored.memory.edits)).toEqual([]);
    expect(ignored.memory.edits[0]?.status).toBe('pending');

    const saved = handleUtterance('confirm', ignored.memory, patients, '123132', NOW, 'edit-2');
    expect(auditEntries(saved.memory.edits)).toHaveLength(1);
    expect(saved.memory.edits[0]?.after).toBe('latex');
    expect(saved.memory.pending).toBeNull();
    expect(saved.say).toBe('Saved.');
  });

  it('keeps a message draft unsent until confirm, and cancel drops it', () => {
    const draft = handleUtterance('send prescription to patient', emptyVoiceMemory(), patients, '123132', NOW, 'msg-1');
    expect(draft.memory.drafts[0]?.status).toBe('draft');
    expect(draft.memory.drafts[0]?.body).toContain('Levetiracetam');
    expect(draft.navigate).toBe('/demo/app/messages');
    expect(draft.say).toBe('Say confirm to save.');

    const waiting = handleUtterance('send update to hospital software', draft.memory, patients, '123132', NOW, 'msg-2');
    expect(waiting.memory.drafts.map((item) => item.status)).toEqual(['draft']);
    expect(waiting.memory.drafts[0]?.kind).toBe('hospital_update');

    const confirmed = handleUtterance('confirm', waiting.memory, patients, '123132', NOW, 'msg-3');
    expect(confirmed.memory.drafts[0]?.status).toBe('confirmed');
    expect(confirmed.say).toBe('Confirmed. Nothing was sent outside this demonstration.');
    expect(confirmed.navigate).toBe('/demo/app/messages');

    const another = handleUtterance('send prescription to patient', confirmed.memory, patients, '123132', NOW, 'msg-4');
    const cancelled = handleUtterance('cancel', another.memory, patients, '123132', NOW, 'msg-5');
    expect(cancelled.memory.drafts.map((item) => item.id)).toEqual(['msg-2']);
    expect(cancelled.memory.pending).toBeNull();
    expect(cancelled.say).toBe('Cancelled. Nothing was sent.');
  });

  it('does not edit, draft, or open MRI when no patient is open', () => {
    const edit = handleUtterance('change allergy to latex', emptyVoiceMemory(), patients, null, NOW, 'edit-1');
    expect(edit.memory.edits).toEqual([]);
    expect(edit.navigate).toBeNull();
    expect(edit.say).toBe('Open a patient first.');

    const message = handleUtterance('send prescription to patient', emptyVoiceMemory(), patients, null, NOW, 'msg-1');
    expect(message.memory.drafts).toEqual([]);

    const scans = handleUtterance('open MRI scans', emptyVoiceMemory(), patients, null, NOW, 'mri-1');
    expect(scans.navigate).toBeNull();
  });

  it('does not open a patient when the name and number disagree or the name is ambiguous', () => {
    const mismatch = handleUtterance('give me Alex Wu patient number 440218 details', emptyVoiceMemory(), patients, null, NOW, 'x');
    expect(mismatch.intent.type).toBe('refuse');
    expect(mismatch.navigate).toBeNull();

    const twin = patients.find((patient) => patient.name === 'Alex Wu');
    if (!twin) throw new Error('missing Alex Wu');
    const parsed = parseUtterance('open Alex Wu', [...patients, { ...twin, mrn: '999999' }]);
    expect(parsed.intent).toEqual({ type: 'refuse', reason: 'ambiguous' });
  });

  it('logs contact emergency and leaves the chart alone', () => {
    const proposed = handleUtterance('change allergy to latex', emptyVoiceMemory(), patients, '123132', NOW, 'edit-1');
    const paged = handleUtterance('contact emergency', proposed.memory, patients, '123132', NOW, 'page-1');
    expect(paged.toast).toBe(EMERGENCY_TEXT);
    expect(paged.say).toBe(EMERGENCY_TEXT);
    expect(paged.doing).toBe(EMERGENCY_TEXT);
    expect(paged.navigate).toBeNull();
    expect(paged.memory.edits).toEqual(proposed.memory.edits);
    expect(paged.memory.pending).toEqual(proposed.memory.pending);
    expect(paged.memory.log.at(-1)?.kind).toBe('emergency');
  });

  it('keeps a pending change out of the record until confirm', () => {
    const proposed = handleUtterance('change allergy to latex', emptyVoiceMemory(), patients, '123132', NOW, 'edit-1');
    expect(proposed.memory.edits[0]?.status).toBe('pending');
    expect(auditEntries(proposed.memory.edits)).toEqual([]);
    expect(proposed.navigate).toBe('/demo/app/messages');
    expect(proposed.memory.drafts).toEqual([]);
    const saved = handleUtterance('confirm', proposed.memory, patients, '123132', NOW, 'edit-2');
    expect(auditEntries(saved.memory.edits)).toHaveLength(1);
    expect(saved.memory.edits[0]?.status).toBe('confirmed');
  });

  it('asks instead of guessing an unclear recipient', () => {
    for (const phrase of ['send this to Alex', 'send this to Alex Wu', 'send this to the ward']) {
      const asked = handleUtterance(phrase, emptyVoiceMemory(), patients, '123132', NOW, 'ask-1');
      expect(asked.say, phrase).toBe(RECIPIENT_QUESTION);
      expect(asked.intent.type, phrase).toBe('ask_recipient');
      expect(asked.memory.drafts, phrase).toEqual([]);
      expect(asked.memory.edits, phrase).toEqual([]);
      expect(asked.navigate, phrase).toBeNull();
    }
  });

  it('holds a prescription draft until confirm', () => {
    const draft = handleUtterance('send this to the patient', emptyVoiceMemory(), patients, '123132', NOW, 'rx-1');
    expect(draft.memory.drafts[0]?.status).toBe('draft');
    expect(draft.memory.drafts[0]?.kind).toBe('prescription');
    expect(draft.memory.drafts[0]?.body).toContain('Levetiracetam');
    expect(draft.say).toBe('Say confirm to save.');
    expect(draft.navigate).toBe('/demo/app/messages');
    const sent = handleUtterance('confirm', draft.memory, patients, '123132', NOW, 'rx-2');
    expect(sent.memory.drafts[0]?.status).toBe('confirmed');
  });

  it('opens the latest scan for the current patient', () => {
    const opened = handleUtterance('open latest scan', emptyVoiceMemory(), patients, '123132', NOW, 'scan-1');
    expect(opened.intent.type).toBe('open_mri');
    expect(opened.viewerEvent).toEqual({ type: 'open_mri', mrn: '123132', studyId: 'wu-t1c' });
    expect(opened.navigate).toBe('/demo/app/imaging?patient=123132');
  });

  it('emits a viewer event for the heard region and does not navigate', () => {
    const shown = handleUtterance('show the tumour', emptyVoiceMemory(), patients, '123132', NOW, 'view-1');
    expect(shown.intent).toEqual({ type: 'show_finding', target: 'tumour' });
    expect(shown.viewerEvent).toEqual({ type: 'show_region', mrn: '123132', label: 'lesion (demonstration)', surroundOpacity: 0.4 });
    expect(shown.say).toBe('Showing the lesion (demonstration).');
    expect(shown.navigate).toBeNull();
    expect(shown.memory.edits).toEqual([]);
    expect(shown.memory.drafts).toEqual([]);
  });
});

describe('local whisper probe', () => {
  it('checks the API before posting audio', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (url.endsWith('/v1/models')) return new Response('{}', { status: 404 });
      if (url.endsWith('/inference') && method === 'OPTIONS') return new Response(null, { status: 200 });
      if (url.endsWith('/inference') && method === 'POST') return Response.json({ text: 'open Alex Wu' });
      return new Response('missing', { status: 404 });
    };
    await expect(transcribeWav('http://127.0.0.1:8080', new Blob(['wav']), fetchImpl)).resolves.toBe('open Alex Wu');
    expect(calls.map((call) => call.split(' ')[0])).toEqual(['GET', 'OPTIONS', 'POST']);
    expect(calls[2]).toContain('/inference');
  });

  it('uses the OpenAI-compatible path when /v1/models answers', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/v1/models')) return new Response('{}', { status: 200 });
      if (url.endsWith('/v1/audio/transcriptions')) return Response.json({ text: 'confirm' });
      return new Response('missing', { status: 404 });
    };
    await expect(transcribeWav('http://127.0.0.1:8080/', new Blob(['wav']), fetchImpl)).resolves.toBe('confirm');
    expect(calls.some((call) => call.includes('/inference'))).toBe(false);
    expect(calls.at(-1)).toContain('POST');
  });

  it('posts nothing when the server offers neither API', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response('missing', { status: 404 });
    };
    const probe = await probeWhisper('http://127.0.0.1:9', fetchImpl);
    expect(probe.ok).toBe(false);
    await expect(transcribeWav('http://127.0.0.1:9', new Blob(['wav']), fetchImpl)).rejects.toThrow(/No audio was sent/);
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
  });
});
