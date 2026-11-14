import { z } from 'zod';
import { AppId, Vec3 } from './common.js';
import { SlicePlane, ViewMode } from './command.js';

export const CameraState = z
  .object({
    position: Vec3.describe('Camera position (viewer world coordinates: three.js, x = -R, y = S, z = A).'),
    target: Vec3.describe('Orbit target (viewer world coordinates).'),
    up: Vec3.describe('Camera up vector.'),
    azimuth: z
      .number()
      .optional()
      .describe(
        'Optional (additive, 1.1.0), derived from position/target by cameraOrbit(): degrees around the patient, 0 = looking from anterior, 90 = from the patient\'s right.',
      ),
    elevation: z
      .number()
      .optional()
      .describe('Optional (additive, 1.1.0): degrees above the axial plane, +90 = looking from superior.'),
    distance: z.number().nonnegative().optional().describe('Optional (additive, 1.1.0): position-to-target distance, mm.'),
  })
  .describe('Camera pose. position/target/up are authoritative; azimuth/elevation/distance are derived.');

export const LayerState = z
  .object({
    id: z.string().describe('Layer id from the manifest.'),
    opacity: z.number().min(0).max(1).describe('Current opacity.'),
    visible: z.boolean().describe('Current visibility.'),
  })
  .describe('Runtime state of one surface layer.');

const viewCore = {
  app: AppId.nullable().describe('Loaded app, or null when nothing is loaded.'),
  caseId: z.string().nullable().describe('Loaded case id, or null.'),
  camera: CameraState,
  layers: z.array(LayerState).describe('Per-layer runtime state.'),
  slice: z
    .object({ plane: SlicePlane, index: z.number().int().nonnegative().describe('Slice index.') })
    .describe('Current 2D slice.'),
  timepoint: z.number().int().nonnegative().describe('Active timepoint index.'),
  scrub: z.number().min(0).max(1).describe('Current scrub value.'),
  mode: ViewMode,
  focusedFindingId: z.string().nullable().describe('Focused finding id, or null.'),
};

export const ViewSnapshot = z
  .object(viewCore)
  .describe('A view without bookmarks/pending (stored inside bookmarks).');
export type ViewSnapshot = z.infer<typeof ViewSnapshot>;

export const Bookmark = z
  .object({
    id: z.string().describe('Bookmark id.'),
    label: z.string().describe('Bookmark label.'),
    snapshotUrl: z.string().optional().describe('URL of the PNG snapshot served by the hub.'),
    state: ViewSnapshot,
  })
  .describe('A saved view.');
export type Bookmark = z.infer<typeof Bookmark>;

export const ViewerState = z
  .object({
    ...viewCore,
    bookmarks: z.array(Bookmark).describe('Saved views.'),
    pending: z
      .object({ confirmFor: z.string().optional().describe('Action awaiting confirm/cancel.') })
      .describe('Pending confirmation, if any.'),
  })
  .describe('Viewer state, published by the viewer at most 10 Hz; the hub caches the latest.');
export type ViewerState = z.infer<typeof ViewerState>;
export type CameraState = z.infer<typeof CameraState>;
export type LayerState = z.infer<typeof LayerState>;
