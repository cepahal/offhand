/** Side panels for the viewer: layers, findings, bookmarks, log. All actions are ViewerCommands. */
import { controller } from '../app/controller.js';
import { ui, useStore } from '../app/store.js';
import { layerAtTimepoint, orderedTimepoints, PROVENANCE_TEXT } from '../viewer/logic.js';
import { regionKindFromSources, regionLabel } from '../viewer/palette.js';
import { GroupBox } from '../ui/win95.js';

const send = controller.dispatch.bind(controller);

export function LayersPanel() {
  const { manifest, view } = useStore(ui);
  if (!manifest) return null;
  const tp = orderedTimepoints(manifest)[view?.timepoint ?? 0];
  const layers = manifest.layers
    .filter((l) => layerAtTimepoint(l, tp?.id))
    .sort((a, b) => a.peelOrder - b.peelOrder);
  return (
    <GroupBox label={`Layers (outer → inner)${tp && manifest.layers.some((l) => l.timepointId) ? ` · ${tp.label}` : ''}`}>
      <div class="listbox">
        {layers.map((l) => {
          const st = view?.layers.find((x) => x.id === l.id);
          const idx = manifest.layers.findIndex((x) => x.id === l.id) + 1;
          return (
            <div
              class="row"
              key={l.id}
              onMouseEnter={() => controller.highlightLayer(l.id)}
              onMouseLeave={() => controller.highlightLayer(null)}
            >
              <input
                type="checkbox"
                checked={st?.visible ?? true}
                onChange={(e) =>
                  send({ type: 'set_layer', layerId: l.id, visible: (e.target as HTMLInputElement).checked }, 'mouse')
                }
              />
              <span class="swatch" style={{ background: l.color }} />
              <span class="grow" title={`${l.label} (key ${idx})`}>
                {l.label}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((st?.opacity ?? l.defaultOpacity) * 100)}
                onChange={(e) =>
                  send(
                    { type: 'set_layer', layerId: l.id, opacity: Number((e.target as HTMLInputElement).value) / 100 },
                    'mouse',
                  )
                }
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <button onClick={() => send({ type: 'peel', dir: 'out' }, 'mouse')}>Peel out</button>
        <button onClick={() => send({ type: 'peel', dir: 'in' }, 'mouse')}>Peel in</button>
      </div>
    </GroupBox>
  );
}

/** Timepoint control for longitudinal cases. The scrub gesture drives the same state. */
export function TimepointPanel() {
  const { manifest, view, caseConfig } = useStore(ui);
  const tps = manifest ? orderedTimepoints(manifest) : [];
  if (tps.length < 2) return null;
  const i = Math.min(view?.timepoint ?? 0, tps.length - 1);
  const go = (index: number) => send({ type: 'timepoint', index }, 'mouse');
  return (
    <GroupBox label={`Timepoint: ${tps[i]!.label}`}>
      <div class="timepoints">
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button disabled={i === 0} onClick={() => go(i - 1)} title="Previous visit">
            ◄
          </button>
          <input
            type="range"
            min={0}
            max={tps.length - 1}
            step={1}
            value={i}
            aria-label="Timepoint"
            onInput={(e) => go(Number((e.target as HTMLInputElement).value))}
          />
          <button disabled={i === tps.length - 1} onClick={() => go(i + 1)} title="Next visit">
            ►
          </button>
        </div>
        <div class="ticks small">
          {tps.map((t, k) => (
            <span key={t.id} style={{ fontWeight: k === i ? 'bold' : 'normal' }}>
              {t.label.replace(/^Visit /, 'V')}
            </span>
          ))}
        </div>
        {caseConfig?.scrub.target === 'timepoint' && (
          <div class="small">Scrub gesture (hover, hold still, move up/down) also steps through visits.</div>
        )}
      </div>
    </GroupBox>
  );
}

export function FindingsPanel() {
  const { manifest, view, mock } = useStore(ui);
  if (!manifest) return null;
  const focused = manifest.findings.find((f) => f.id === view?.focusedFindingId);
  const kind = regionKindFromSources(`${manifest.source.dataset} ${manifest.findings.map((item) => item.label).join(' ')}`);
  const what = mock ? 'Mock targets' : 'Findings';
  return (
    <GroupBox label={`${what} (${manifest.findings.length})`}>
      {kind && <div class="small">{regionLabel(kind)}</div>}
      {manifest.findings.length === 0 ? (
        <div class="small">This case has no findings.</div>
      ) : (
        <div class="listbox">
          {manifest.findings.map((f) => (
            <div
              class={`row ${f.id === view?.focusedFindingId ? 'sel' : ''}`}
              key={f.id}
              onClick={() => send({ type: 'focus_finding', findingId: f.id }, 'mouse')}
            >
              <span class="grow">{f.label}</span>
              <span class="small" style={{ color: 'inherit' }}>
                {f.radiusMm.toFixed(0)} mm
              </span>
            </div>
          ))}
        </div>
      )}
      {focused && (
        <div class="small" style={{ marginTop: '4px' }}>
          <b>{focused.label}</b> —{' '}
          {mock ? 'a highlight target on a mock shape. Not a finding, not anatomy' : PROVENANCE_TEXT[focused.provenance]}.
          {focused.reportExcerpt && <div>“{focused.reportExcerpt}”</div>}
        </div>
      )}
      {manifest.report && (
        <div class="small" style={{ marginTop: '4px' }}>
          Report text is {manifest.report.provenance === 'dataset_report' ? "from the dataset's report" : 'provided'}.
        </div>
      )}
    </GroupBox>
  );
}

export function BookmarksPanel() {
  const { bookmarks, manifest } = useStore(ui);
  if (!manifest) return null;
  return (
    <GroupBox label={`Bookmarks (${bookmarks.length})`}>
      {bookmarks.length > 0 && (
        <div class="listbox">
          {bookmarks.map((b) => (
            <div class="row" key={b.id} onClick={() => controller.restoreBookmark(b.id)} title="Restore this view">
              <span class="grow">{b.label}</span>
              {b.snapshotUrl && (
                <a href={b.snapshotUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  png
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <button onClick={() => send({ type: 'bookmark' }, 'mouse')}>Bookmark</button>
        <button onClick={() => send({ type: 'capture', requestId: crypto.randomUUID() }, 'mouse')}>Capture</button>
      </div>
    </GroupBox>
  );
}

export function SuggestionPanel() {
  const { suggestion } = useStore(ui);
  if (!suggestion) return null;
  return (
    <GroupBox label="Suggested view">
      <div class="small">{suggestion.text}</div>
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <button onClick={() => controller.applySuggestion()}>Apply</button>
        <button onClick={() => controller.dismissSuggestion()}>Not now</button>
      </div>
    </GroupBox>
  );
}

export function LogPanel() {
  const { log } = useStore(ui);
  return (
    <div class="sunken log">
      {log.length === 0 && <div class="muted">Event log is empty.</div>}
      {[...log].reverse().map((l, i) => (
        <div key={log.length - i} class={l.level}>
          {new Date(l.at).toLocaleTimeString([], { hour12: false })} {l.text}
        </div>
      ))}
    </div>
  );
}
