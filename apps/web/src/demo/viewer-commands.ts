/**
 * One command object for a viewer action, whether a voice phrase or a gesture asked for it.
 */
import { regionKindFromSources, regionLabel, SURROUND_OPACITY } from '../viewer/palette.js';
import type { DemoPatient, DemoStudy } from './types.js';

export interface OpenMriCommand {
  type: 'open_mri';
  mrn: string;
  studyId: string;
}

export interface ShowRegionCommand {
  type: 'show_region';
  mrn: string;
  label: string;
  surroundOpacity: typeof SURROUND_OPACITY;
}

export interface StepScansCommand {
  type: 'step_scans';
  mrn: string;
  studyIds: string[];
}

export type DemoViewerCommand = OpenMriCommand | ShowRegionCommand | StepScansCommand;
export type ViewerAction = DemoViewerCommand['type'];

const SCAN_RANK = ['t1', 't2-flair', 'contrast t1'];

function scanRank(sequence: string): number {
  const key = sequence.toLowerCase();
  const index = SCAN_RANK.findIndex((item) => key === item);
  return index === -1 ? SCAN_RANK.length : index;
}

/** MRI studies in demonstration order: T1, T2-FLAIR, contrast T1, then anything else. */
export function orderedMri(patient: DemoPatient): DemoStudy[] {
  return patient.studies
    .filter((study) => study.modality.toLowerCase() === 'mri')
    .sort((a, b) => scanRank(a.sequence) - scanRank(b.sequence) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function latestStudy(patient: DemoPatient): DemoStudy | undefined {
  return [...patient.studies].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).at(-1);
}

/** History and study names. The procedure field is a surgery name, not a dataset label. */
export function patientRegionLabel(patient: DemoPatient): string {
  const dataset = [...patient.history.map((entry) => entry.text), ...patient.studies.map((study) => `${study.modality} ${study.sequence}`)].join(' ');
  return regionLabel(regionKindFromSources(dataset));
}

/** Voice and gesture both call this, so the emitted command is the same object shape. */
export function viewerCommand(action: ViewerAction, patient: DemoPatient): DemoViewerCommand | null {
  if (action === 'open_mri') {
    const study = latestStudy(patient);
    if (!study) return null;
    return { type: 'open_mri', mrn: patient.mrn, studyId: study.id };
  }
  if (action === 'show_region') {
    return { type: 'show_region', mrn: patient.mrn, label: patientRegionLabel(patient), surroundOpacity: SURROUND_OPACITY };
  }
  const studies = orderedMri(patient);
  if (studies.length === 0) return null;
  return { type: 'step_scans', mrn: patient.mrn, studyIds: studies.map((study) => study.id) };
}
