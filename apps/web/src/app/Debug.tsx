/** /debug: module health, Slicer link, the clinic inbox (NeuroView stand-in), timeline and hub log. */
import { useEffect, useState } from 'preact/hooks';
import { DISCLAIMER } from './App.js';
import { ui, useStore } from './store.js';

interface InboxEntry {
  ts: string;
  shareId: string;
  app: string;
  caseId: string;
  recipientRef: string;
  optionId: string;
  optionLabel: string;
  selected: boolean;
}

type Fetched<T> = { ok: true; data: T } | { ok: false; error: string } | null;

async function getJson<T>(url: string): Promise<Fetched<T>> {
  try {
    const r = await fetch(url);
    if (r.status === 404) return { ok: false, error: 'not enabled' };
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, data: (await r.json()) as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function usePoll<T>(url: string, everyMs = 3000): Fetched<T> {
  const [v, setV] = useState<Fetched<T>>(null);
  useEffect(() => {
    let live = true;
    const tick = () => void getJson<T>(url).then((x) => live && setV(x));
    tick();
    const t = setInterval(tick, everyMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [url]);
  return v;
}

export function DebugPage() {
  const s = useStore(ui);
  const inbox = usePoll<{ file: string; entries: InboxEntry[] }>('/api/integrations/clinicinbox/entries');
  const slicer = usePoll<Record<string, unknown>>('/api/integrations/slicer/status');

  return (
    <div class="debug">
      <header class="screen-top">
        <strong>HoverScan debug</strong>
        <a href="/">Back to the screen</a>
        <div class={`hub-dot ${s.hub === 'open' ? 'ok' : 'down'}`}>{s.hub === 'open' ? 'hub' : 'hub offline'}</div>
      </header>

      <section class="card">
        <h2>Modules</h2>
        <table>
          <tbody>
            {Object.entries(s.modules).map(([name, h]) => (
              <tr key={name}>
                <td>{name}</td>
                <td class={`st-${h.status}`}>{h.status}</td>
                <td>{h.detail ?? ''}</td>
              </tr>
            ))}
            {Object.keys(s.modules).length === 0 && (
              <tr>
                <td class="muted">No health data (hub offline?).</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Clinic inbox (NeuroView stand-in)</h2>
        {!inbox ? (
          <p class="muted">Loading…</p>
        ) : !inbox.ok ? (
          <p class="muted">Clinic inbox: {inbox.error}. Set INTEG_CLINIC_INBOX=live (or mock).</p>
        ) : (
          <>
            <p class="muted">
              {inbox.data.file} · {inbox.data.entries.length} vote(s), newest first. No phone numbers are stored.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Case</th>
                  <th>Share</th>
                  <th>Recipient</th>
                  <th>Vote</th>
                </tr>
              </thead>
              <tbody>
                {inbox.data.entries.map((e) => (
                  <tr key={`${e.ts}-${e.shareId}-${e.optionId}`}>
                    <td>{new Date(e.ts).toLocaleString()}</td>
                    <td>
                      {e.app}/{e.caseId}
                    </td>
                    <td class="mono">{e.shareId.slice(0, 8)}</td>
                    <td class="mono">{e.recipientRef}</td>
                    <td>
                      {e.selected ? '' : 'withdrawn: '}
                      {e.optionLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section class="card">
        <h2>3D Slicer link</h2>
        {!slicer ? (
          <p class="muted">Loading…</p>
        ) : slicer.ok ? (
          <pre>{JSON.stringify(slicer.data, null, 2)}</pre>
        ) : (
          <p class="muted">Slicer: {slicer.error}.</p>
        )}
      </section>

      <section class="card">
        <h2>Timeline (this page session)</h2>
        <ol class="timeline">
          {s.timeline.length === 0 && <li class="muted">Nothing yet.</li>}
          {[...s.timeline].reverse().map((r) => (
            <li key={`${r.at}-${r.text}`}>
              {new Date(r.at).toLocaleTimeString()} · {r.kind} · {r.text}
            </li>
          ))}
        </ol>
      </section>

      <section class="card">
        <h2>Hub log</h2>
        <ol class="log">
          {[...s.log].reverse().map((l) => (
            <li key={`${l.at}-${l.text}`} class={`lv-${l.level}`}>
              {new Date(l.at).toLocaleTimeString()} {l.text}
            </li>
          ))}
        </ol>
      </section>
      <footer class="screen-footer">{DISCLAIMER}</footer>
    </div>
  );
}
