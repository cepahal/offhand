import type { CommandSource, ViewerCommand, ViewerCommandBody } from './command.js';
import type { ViewerState } from './state.js';

/** Fill id/ts/source on a command body. Works in Node >= 19 and all modern browsers. */
export function makeCommand(
  body: ViewerCommandBody,
  source: CommandSource,
  now: number = Date.now(),
): ViewerCommand {
  return { ...body, id: globalThis.crypto.randomUUID(), ts: now, source } as ViewerCommand;
}

/** The state the viewer starts in before any case is loaded. */
export function emptyViewerState(): ViewerState {
  return {
    app: null,
    caseId: null,
    camera: { position: [0, 0, 300], target: [0, 0, 0], up: [0, 1, 0] },
    layers: [],
    slice: { plane: 'axial', index: 0 },
    timepoint: 0,
    scrub: 0,
    mode: 'orbit',
    focusedFindingId: null,
    bookmarks: [],
    pending: {},
  };
}
