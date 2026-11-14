import { describe, expect, it } from 'vitest';
import { patients } from '../src/demo/data.js';
import { patientRegionLabel, viewerCommand } from '../src/demo/viewer-commands.js';
import { emptyVoiceMemory, handleUtterance } from '../src/demo/voice-apply.js';
import { layerRole, regionKindFromSources, regionLabel } from '../src/viewer/palette.js';

const NOW = '2026-11-12T18:00:00.000Z';
const alex = patients.find((patient) => patient.mrn === '123132');
if (!alex) throw new Error('missing Alex Wu');

describe('viewer colours and labels', () => {
  it('classifies anatomy and keeps a flat role for cortex', () => {
    expect(layerRole('Brain surface (skull-stripped MPRAGE, visit 1)')).toBe('cortex');
    expect(layerRole('White matter')).toBe('white');
    expect(layerRole('Lateral ventricles')).toBe('ventricle');
    expect(layerRole('Skull shell')).toBe('skull');
    expect(layerRole('Lesion mask, rater 1', 'lesion-1')).toBe('highlight');
  });

  it('calls a region a tumour only when the dataset says so', () => {
    expect(regionKindFromSources('ISBI 2015 Longitudinal MS Lesion Segmentation Challenge')).toBe('lesion');
    expect(regionLabel(regionKindFromSources('BraTS 2023 glioma'))).toBe('tumour (demonstration)');
    expect(patientRegionLabel(alex)).toBe('lesion (demonstration)');
    const procedureOnly = { ...alex, history: [{ date: '2019-01-01', text: 'Clinic visit. No procedure.' }] };
    expect(patientRegionLabel(procedureOnly)).toBe('lesion (demonstration)');
  });
});

describe('voice and gesture viewer commands', () => {
  it('emits the same command from either path', () => {
    const open = handleUtterance('open MRI scans', emptyVoiceMemory(), patients, alex.mrn, NOW, 'open-1');
    const show = handleUtterance('show the tumour', emptyVoiceMemory(), patients, alex.mrn, NOW, 'show-1');
    const lesion = handleUtterance('show the lesion', emptyVoiceMemory(), patients, alex.mrn, NOW, 'show-2');
    const scans = handleUtterance('show the scans', emptyVoiceMemory(), patients, alex.mrn, NOW, 'scans-1');

    expect(open.viewerEvent).toEqual(viewerCommand('open_mri', alex));
    expect(open.viewerEvent).toEqual({ type: 'open_mri', mrn: '123132', studyId: 'wu-t1c' });
    expect(show.viewerEvent).toEqual(viewerCommand('show_region', alex));
    expect(lesion.viewerEvent).toEqual(viewerCommand('show_region', alex));
    expect(scans.viewerEvent).toEqual(viewerCommand('step_scans', alex));
    expect(scans.viewerEvent).toEqual({ type: 'step_scans', mrn: '123132', studyIds: ['wu-t1', 'wu-flair', 'wu-t1c'] });
    expect(scans.say).toBe('Stepping through the scans.');
  });
});
