import { z } from 'zod';
import { AppId, Vec3 } from './common.js';

const relFile = z
  .string()
  .regex(/^(?!\/)(?!.*\.\.)[\w./-]+$/)
  .describe('Path relative to the case pack folder (no "..", no leading "/").');

export const CaseLayer = z
  .object({
    id: z.string().describe('Layer id, unique within the case.'),
    label: z.string().describe('Display label (from the dataset label map).'),
    file: relFile.describe('GLB file, relative to the case folder.'),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .describe('Display colour, #rrggbb.'),
    defaultOpacity: z.number().min(0).max(1).describe('Initial opacity.'),
    peelOrder: z.number().int().nonnegative().describe('0 = outermost (peeled first).'),
    kind: z.literal('surface').describe('Layer kind. Only surfaces for now.'),
  })
  .describe('One surface mesh layer.');

export const CaseVolume = z
  .object({
    id: z.string().describe('Volume id.'),
    file: relFile.describe('NIfTI file (RAS), relative to the case folder.'),
    modality: z.string().describe('e.g. "MR", "CT", "CBCT".'),
    sequence: z.string().describe('e.g. "qDESS", "FLAIR", "T1".'),
    timepointId: z.string().optional().describe('Timepoint this volume belongs to.'),
  })
  .describe('A volume for the slice panel.');

export const CaseTimepoint = z
  .object({
    id: z.string().describe('Timepoint id.'),
    label: z.string().describe('Display label, e.g. "Visit 2".'),
    order: z.number().int().describe('Sort order.'),
  })
  .describe('A timepoint (longitudinal studies).');

export const CaseFinding = z
  .object({
    id: z.string().describe('Finding id.'),
    label: z.string().describe('Display label, taken from the dataset (never invented).'),
    layerId: z.string().optional().describe('Layer the finding belongs to.'),
    center: Vec3.describe('Centre, RAS mm.'),
    radiusMm: z.number().nonnegative().describe('Approximate radius, mm.'),
    provenance: z
      .enum(['dataset_label', 'dataset_report', 'measured'])
      .describe(
        'Where it came from: dataset label mask, dataset report text, or measured by the pipeline.',
      ),
    reportExcerpt: z.string().optional().describe('Verbatim excerpt from the dataset report, if any.'),
    timepointId: z.string().optional().describe('Timepoint the finding belongs to.'),
  })
  .describe('A finding taken from the dataset (labels/report) or measured from it.');

export const CasePackManifest = z
  .object({
    schema: z.literal(1).describe('Manifest schema version.'),
    app: AppId,
    caseId: z
      .string()
      .regex(/^[\w-]+$/)
      .describe('Case id (folder name).'),
    title: z.string().describe('Display title.'),
    source: z
      .object({
        dataset: z.string().describe('Dataset name.'),
        url: z.string().describe('Dataset landing page.'),
        license: z.string().describe('Dataset licence (shown on screen).'),
        citation: z.string().describe('Required citation.'),
        subjectId: z.string().describe('Subject/case id inside the dataset.'),
      })
      .describe('Provenance, shown on screen.'),
    deidentified: z.literal(true).describe('Must be true; only de-identified public data.'),
    coordinateSystem: z.literal('RAS').describe('All coordinates are RAS.'),
    units: z.literal('mm').describe('All lengths are millimetres.'),
    layers: z.array(CaseLayer).describe('Surface layers.'),
    volumes: z.array(CaseVolume).describe('Volumes for the slice panel (may be empty).'),
    timepoints: z.array(CaseTimepoint).optional().describe('Timepoints (longitudinal cases).'),
    findings: z.array(CaseFinding).describe('Findings (may be empty).'),
    report: z
      .object({
        text: z.string().describe('Report text from the dataset.'),
        provenance: z.enum(['dataset_report', 'measured']).describe('Origin of the report text.'),
      })
      .optional()
      .describe('Dataset report, if the dataset has one.'),
    share: z
      .object({
        templateId: z.string().describe('Share template id.'),
        pollOptions: z
          .array(z.object({ id: z.string(), label: z.string() }).describe('Poll option.'))
          .describe('Poll options offered to the patient.'),
      })
      .describe('Share-to-patient settings.'),
    policyId: z.string().describe('Rulebook/policy id used to check text for this case.'),
  })
  .describe('manifest.json at the root of every case pack.');
export type CasePackManifest = z.infer<typeof CasePackManifest>;
export type CaseLayer = z.infer<typeof CaseLayer>;
export type CaseVolume = z.infer<typeof CaseVolume>;
export type CaseFinding = z.infer<typeof CaseFinding>;
export type CaseTimepoint = z.infer<typeof CaseTimepoint>;
