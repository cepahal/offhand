/** The whole page: one Win95 window on a teal desktop, plus a taskbar. */
import { useEffect, useState } from 'preact/hooks';
import { CONTRACTS_VERSION } from '@offhand/contracts';
import { controller } from './controller.js';
import { panels } from './panels.js';
import { ui, useStore } from './store.js';
import { installKeyboard } from '../input/keyboard.js';
import { LogPanel } from '../panels/ViewerPanels.js';
import { SlicePanel } from '../slices/SlicePanel.js';
import { ViewerPane } from '../viewer/ViewerPane.js';
import { Clock, Dialog, MenuBar, MenuList, Window, type Menu } from '../ui/win95.js';

export const DISCLAIMER = 'For communication and education. Not for diagnosis.';
const send = controller.dispatch.bind(controller);

export function App() {
  const s = useStore(ui);
  const [startOpen, setStartOpen] = useState(false);

  useEffect(() => installKeyboard(controller), []);
  useEffect(() => {
    document.body.classList.toggle('big', s.bigUi);
  }, [s.bigUi]);

  const m = s.manifest;
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Open case...', hint: 'O', onClick: () => ui.set({ dialog: 'open' }) },
        { label: 'Rescan case packs', onClick: () => void rescan() },
        'sep',
        { label: 'Capture PNG', hint: 'C', disabled: !m, onClick: () => send({ type: 'capture', requestId: crypto.randomUUID() }, 'mouse') },
        { label: 'Bookmark view', hint: 'B', disabled: !m, onClick: () => send({ type: 'bookmark' }, 'mouse') },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Reset view', hint: 'R', disabled: !m, onClick: () => send({ type: 'reset_view' }, 'mouse') },
        { label: 'Peel out', hint: '[', disabled: !m, onClick: () => send({ type: 'peel', dir: 'out' }, 'mouse') },
        { label: 'Peel in', hint: ']', disabled: !m, onClick: () => send({ type: 'peel', dir: 'in' }, 'mouse') },
        { label: 'Next finding', hint: 'N', disabled: !m, onClick: () => send({ type: 'focus_finding', findingId: 'next' }, 'mouse') },
        'sep',
        {
          label: 'Scrub mode',
          hint: 'M',
          checked: s.view?.mode === 'scrub',
          disabled: !m,
          onClick: () => send({ type: 'mode', mode: s.view?.mode === 'scrub' ? 'orbit' : 'scrub' }, 'mouse'),
        },
        { label: 'Slice panel', hint: 'S', checked: s.slicePanel, onClick: () => ui.set({ slicePanel: !s.slicePanel }) },
        { label: 'Big UI (kiosk)', checked: s.bigUi, onClick: () => ui.set({ bigUi: !s.bigUi }) },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keys & gestures', hint: '?', onClick: () => ui.set({ dialog: 'keys' }) },
        { label: 'About offhand', onClick: () => ui.set({ dialog: 'about' }) },
      ],
    },
  ];

  const hubDot = s.hub === 'open' ? 'live' : s.hub === 'connecting' ? 'mock' : 'error';
  const title = `offhand - ${m ? m.title : 'Viewer'}`;

  return (
    <>
      <div class="desktop">
        <Window title={title} icon="▣" className="main-window">
          <MenuBar menus={menus} />
          <div class="toolbar">
            <button disabled={!m} onClick={() => send({ type: 'rotate', yawDeg: -30 }, 'mouse')} title="Turn left (←)">
              ◄ Turn
            </button>
            <button disabled={!m} onClick={() => send({ type: 'rotate', yawDeg: 30 }, 'mouse')} title="Turn right (→)">
              Turn ►
            </button>
            <button disabled={!m} onClick={() => send({ type: 'zoom', factor: 1.25 }, 'mouse')} title="Zoom in (+)">
              Zoom +
            </button>
            <button disabled={!m} onClick={() => send({ type: 'zoom', factor: 0.8 }, 'mouse')} title="Zoom out (-)">
              Zoom −
            </button>
            <span class="sep" />
            <button disabled={!m} onClick={() => send({ type: 'peel', dir: 'out' }, 'mouse')}>
              Peel out
            </button>
            <button disabled={!m} onClick={() => send({ type: 'peel', dir: 'in' }, 'mouse')}>
              Peel in
            </button>
            <span class="sep" />
            <button disabled={!m} onClick={() => send({ type: 'reset_view' }, 'mouse')}>
              Reset
            </button>
            <button onClick={() => ui.set({ dialog: 'open' })}>Open...</button>
          </div>
          <div class="workarea">
            <div class="viewport-col">
              <ViewerPane />
              {s.slicePanel && <SlicePanel />}
              <LogPanel />
            </div>
            <div class="side">
              {[...panels]
                .sort((a, b) => a.order - b.order)
                .map((p) => (
                  <p.component key={p.id} />
                ))}
            </div>
          </div>
          <div class="statusbar">
            <div class="grow">
              {m ? `Source: ${m.source.dataset} (${m.source.subjectId}) · License: ${m.source.license}` : 'Ready'}
            </div>
            <div>
              <span class={`dot ${hubDot}`} />
              Hub: {s.hub}
            </div>
            {Object.entries(s.modules).map(([name, h]) => (
              <div key={name} title={h.detail}>
                <span class={`dot ${h.status}`} />
                {name}
              </div>
            ))}
            <div>{DISCLAIMER}</div>
          </div>
        </Window>
      </div>

      <div class="taskbar">
        <button class={`start ${startOpen ? 'pressed' : ''}`} onClick={() => setStartOpen(!startOpen)}>
          ▤ Start
        </button>
        <button class="task active">▣ {title}</button>
        <span class="spacer" />
        <div class="tray">
          <span class="disclaimer">{DISCLAIMER}</span>
          <Clock />
        </div>
      </div>
      {startOpen && (
        <MenuList
          className="startmenu"
          onPick={() => setStartOpen(false)}
          items={[
            { label: 'Open case...', onClick: () => ui.set({ dialog: 'open' }) },
            'sep',
            ...controller.localCases().map((c) => ({
              label: c.title.replace(/ — MOCK.*$/, ' (mock)'),
              onClick: () => send({ type: 'load_case', app: c.app, caseId: c.caseId }, 'mouse'),
            })),
            'sep',
            { label: 'Keys & gestures', onClick: () => ui.set({ dialog: 'keys' }) },
            { label: s.bigUi ? 'Normal UI' : 'Big UI (kiosk)', onClick: () => ui.set({ bigUi: !s.bigUi }) },
            { label: 'About offhand', onClick: () => ui.set({ dialog: 'about' }) },
            'sep',
            { label: 'Restart viewer', onClick: () => location.reload() },
          ]}
        />
      )}

      {s.dialog === 'open' && <OpenDialog />}
      {s.dialog === 'keys' && <KeysDialog />}
      {s.dialog === 'about' && <AboutDialog />}
    </>
  );
}

async function rescan(): Promise<void> {
  await fetch('/api/cases/rescan', { method: 'POST' }).catch(() => undefined);
  await controller.refreshCases();
}

function OpenDialog() {
  const s = useStore(ui);
  const [sel, setSel] = useState<string | null>(s.manifest ? `${s.manifest.app}/${s.manifest.caseId}` : null);
  const mocks = controller.localCases();
  const close = () => ui.set({ dialog: null });
  const open = (key: string | null) => {
    if (!key) return;
    const [app, caseId] = key.split('/') as [string, string];
    send({ type: 'load_case', app, caseId }, 'mouse');
    close();
  };
  return (
    <Dialog title="Open case" onClose={close} width={620}>
      {s.hub !== 'open' && (
        <p>
          The hub is not connected, so no case packs can be listed (start it with <kbd>pnpm dev</kbd>). The
          frontend mocks below still work.
        </p>
      )}
      <div class="sunken" style={{ maxHeight: '300px', overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Case</th>
              <th>Title</th>
              <th>Dataset</th>
              <th>Layers</th>
            </tr>
          </thead>
          <tbody>
            {s.cases.map((c) => {
              const key = `${c.app}/${c.caseId}`;
              return (
                <tr key={key} class={sel === key ? 'sel' : ''} onClick={() => setSel(key)} onDblClick={() => open(key)}>
                  <td>{c.app}</td>
                  <td>{c.caseId}</td>
                  <td>{c.title}</td>
                  <td>{c.dataset}</td>
                  <td>{c.layers}</td>
                </tr>
              );
            })}
            {s.cases.length === 0 && (
              <tr>
                <td colSpan={5} class="muted">
                  No case packs found. Run <kbd>pnpm testpattern</kbd>, then File → Rescan.
                </td>
              </tr>
            )}
            {mocks.length > 0 && (
              <tr>
                <td colSpan={5} class="group-row">
                  Frontend mocks — primitive shapes, NOT anatomy, no patient data
                </td>
              </tr>
            )}
            {mocks.map((c) => {
              const key = `${c.app}/${c.caseId}`;
              return (
                <tr key={key} class={sel === key ? 'sel' : ''} onClick={() => setSel(key)} onDblClick={() => open(key)}>
                  <td>{c.app}</td>
                  <td>{c.caseId}</td>
                  <td>{c.title}</td>
                  <td>none (mock)</td>
                  <td>—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {s.invalid.length > 0 && (
        <details style={{ marginTop: '6px' }}>
          <summary>{s.invalid.length} invalid case pack(s)</summary>
          {s.invalid.map((i) => (
            <div key={i.path} class="small">
              <b>{i.path}</b>: {i.errors.join('; ')}
            </div>
          ))}
        </details>
      )}
      <div class="buttons">
        <button onClick={() => void rescan()}>Rescan</button>
        <button disabled={!sel} onClick={() => open(sel)}>
          Open
        </button>
        <button onClick={close}>Cancel</button>
      </div>
    </Dialog>
  );
}

const KEYS: [string, string][] = [
  ['← →', 'Swipe left / right: turn the model'],
  ['↑ ↓', 'Swipe up / down: tilt the model'],
  ['+ / −', 'Push / pull: zoom in / out'],
  ['[  ]', 'Spin clockwise / counter-clockwise: peel a layer away / back'],
  ['W', 'Wave: push-to-talk (voice)'],
  ['hold H', 'Hover mock: move the mouse; hold still 1 s to enter scrub, then move up/down'],
  [', .', 'Scrub down / up'],
  ['M', 'Toggle orbit / scrub mode'],
  ['N  P', 'Next / previous finding'],
  ['1 … 9', 'Show / hide layer'],
  ['R', 'Reset view'],
  ['B  C', 'Bookmark / capture PNG'],
  ['O  S', 'Open case / slice panel'],
  ['Mouse', 'Drag: orbit · Right-drag: pan · Wheel: zoom'],
];

function KeysDialog() {
  const close = () => ui.set({ dialog: null });
  return (
    <Dialog title="Keys & gestures" onClose={close} width={520}>
      <p>Keys marked as gestures go through the same gesture mapper as the hand-tracking board.</p>
      <table>
        <tbody>
          {KEYS.map(([k, d]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="buttons">
        <button onClick={close}>OK</button>
      </div>
    </Dialog>
  );
}

function AboutDialog() {
  const { manifest } = useStore(ui);
  const close = () => ui.set({ dialog: null });
  return (
    <Dialog title="About offhand" onClose={close} width={460}>
      <p>
        <b>offhand</b> — touch-free 3D scan viewer.
        <br />
        Contracts v{CONTRACTS_VERSION}
      </p>
      <p>
        <b>{DISCLAIMER}</b>
      </p>
      {manifest && (
        <p class="small">
          Current case: {manifest.source.dataset}, subject {manifest.source.subjectId}.
          <br />
          License: {manifest.source.license}
          <br />
          {manifest.source.citation}
          {manifest.source.url && (
            <>
              <br />
              <a href={manifest.source.url} target="_blank" rel="noreferrer">
                {manifest.source.url}
              </a>
            </>
          )}
        </p>
      )}
      <div class="buttons">
        <button onClick={close}>OK</button>
      </div>
    </Dialog>
  );
}
