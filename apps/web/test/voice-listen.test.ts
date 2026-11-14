import { describe, expect, it } from 'vitest';
import { probeWhisper, transcribeWav } from '../src/demo/voice-listen.js';

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
