import { z } from 'zod';
import { AppId } from './common.js';

export const CommandSource = z
  .enum(['gesture', 'mouse', 'keyboard', 'voice', 'integration', 'patient', 'system'])
  .describe('Which input produced the command.');
export type CommandSource = z.infer<typeof CommandSource>;

export const SlicePlane = z.enum(['axial', 'coronal', 'sagittal']).describe('Slice plane.');
export type SlicePlane = z.infer<typeof SlicePlane>;

export const ViewMode = z
  .enum(['orbit', 'scrub'])
  .describe('orbit = discrete gestures turn/zoom/peel; scrub = hand height drives the app scrub axis.');
export type ViewMode = z.infer<typeof ViewMode>;

const base = {
  id: z.uuid().describe('Unique command id (uuid).'),
  ts: z.number().describe('Creation time, epoch milliseconds.'),
  source: CommandSource,
};

const cmd = <T extends string, S extends z.ZodRawShape>(type: T, shape: S, description: string) =>
  z.object({ type: z.literal(type), ...base, ...shape }).describe(description);

export const RotateCmd = cmd(
  'rotate',
  {
    yawDeg: z.number().optional().describe('Yaw around the vertical axis, degrees (+ = turn right).'),
    pitchDeg: z.number().optional().describe('Pitch around the screen horizontal axis, degrees (+ = tilt up).'),
  },
  'Rotate the 3D view (animated).',
);
export const ZoomCmd = cmd(
  'zoom',
  { factor: z.number().positive().describe('> 1 zooms in, < 1 zooms out.') },
  'Zoom the 3D view (animated).',
);
export const PeelCmd = cmd(
  'peel',
  { dir: z.enum(['out', 'in']).describe('out = hide the next outermost layer; in = restore it.') },
  'Peel layers by manifest peelOrder (0 = outermost).',
);
export const SetLayerCmd = cmd(
  'set_layer',
  {
    layerId: z.string().describe('Layer id from the case manifest.'),
    visible: z.boolean().optional().describe('Show/hide.'),
    opacity: z.number().min(0).max(1).optional().describe('Opacity 0..1.'),
  },
  'Set one layer visibility/opacity.',
);
export const SliceCmd = cmd(
  'slice',
  {
    plane: SlicePlane,
    index: z.number().int().nonnegative().optional().describe('Absolute slice index.'),
    delta: z.number().int().optional().describe('Relative slice step (used when index is absent).'),
  },
  'Change the 2D slice.',
);
export const ScrubCmd = cmd(
  'scrub',
  {
    value: z
      .number()
      .min(0)
      .max(1)
      .describe('Normalised scrub position; the app config maps it to slice/time/bite/jaw.'),
  },
  'Set the scrub position.',
);
export const TimepointCmd = cmd(
  'timepoint',
  {
    index: z.number().int().nonnegative().optional().describe('Absolute timepoint index (manifest order).'),
    delta: z.number().int().optional().describe('Relative step (used when index is absent).'),
  },
  'Change the active timepoint.',
);
export const FocusFindingCmd = cmd(
  'focus_finding',
  {
    findingId: z.string().describe('Finding id from the manifest, or the literal "next" / "prev".'),
  },
  'Fly the camera to a finding.',
);
export const BookmarkCmd = cmd(
  'bookmark',
  { label: z.string().optional().describe('Optional bookmark label.') },
  'Store the current view (state + snapshot).',
);
export const ResetViewCmd = cmd('reset_view', {}, 'Reset camera, layers and peel to defaults.');
export const CaptureCmd = cmd(
  'capture',
  { requestId: z.string().describe('Correlates the resulting snapshot with the requester.') },
  'Render a PNG snapshot of the current view.',
);
export const ModeCmd = cmd('mode', { mode: ViewMode }, 'Switch interaction mode.');
export const ListenCmd = cmd(
  'listen',
  { on: z.boolean().describe('true = start listening (push-to-talk down).') },
  'Voice push-to-talk.',
);
export const ExplainCmd = cmd(
  'explain',
  { findingId: z.string().optional().describe('Finding to explain; default = focused finding.') },
  'Ask for a plain-language explanation.',
);
export const ShareToPatientCmd = cmd(
  'share_to_patient',
  { bookmarkIds: z.array(z.string()).describe('Bookmarks to include.') },
  'Start the share-to-patient flow.',
);
export const ConfirmCmd = cmd(
  'confirm',
  { for: z.string().describe('What is being confirmed (matches ViewerState.pending.confirmFor).') },
  'Confirm a pending action.',
);
export const CancelCmd = cmd(
  'cancel',
  { for: z.string().describe('What is being cancelled.') },
  'Cancel a pending action.',
);
export const LoadCaseCmd = cmd(
  'load_case',
  { app: AppId, caseId: z.string().describe('Case id (folder name under casepacks/<app>/).') },
  'Load a case pack.',
);

export const ViewerCommand = z
  .discriminatedUnion('type', [
    RotateCmd,
    ZoomCmd,
    PeelCmd,
    SetLayerCmd,
    SliceCmd,
    ScrubCmd,
    TimepointCmd,
    FocusFindingCmd,
    BookmarkCmd,
    ResetViewCmd,
    CaptureCmd,
    ModeCmd,
    ListenCmd,
    ExplainCmd,
    ShareToPatientCmd,
    ConfirmCmd,
    CancelCmd,
    LoadCaseCmd,
  ])
  .describe('Every input (gesture, mouse, keyboard, voice, integration, patient) becomes one of these.');
export type ViewerCommand = z.infer<typeof ViewerCommand>;
export type ViewerCommandType = ViewerCommand['type'];

/** Distributes over the union so each member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A command without the envelope fields; `makeCommand` fills id/ts/source. */
export type ViewerCommandBody = DistributiveOmit<ViewerCommand, 'id' | 'ts' | 'source'>;
