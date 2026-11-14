/**
 * The five review focuses for the ToothFairy2 CBCT candidates. Labels describe what the dataset
 * segments; the dataset has no pathology labels, so nothing here is a finding.
 * Listed in the order the sidebar shows them: the two pressure-analysis cases first.
 */
export interface DentalTraining {
  n: 1 | 2 | 3 | 4 | 5;
  /** Short name for lists and tabs. */
  tabLabel: string;
  /** Full title of the review focus. */
  title: string;
  /** FDI teeth or region the review is about. */
  fdi: string;
  /** Layer id of the structure to frame, when the focus is one tooth. */
  focusLayer: string | null;
  /** Side of the joint, for the TMJ reviews. */
  side: 'right' | 'left' | null;
  /** What the case pack actually supplies for this focus. */
  context: string;
}

export const DENTAL_TRAININGS: readonly DentalTraining[] = [
  {
    n: 3,
    tabLabel: 'Tooth 36',
    title: 'Root canal review · tooth 36',
    fdi: '36',
    focusLayer: 'tooth-36',
    side: null,
    context: 'Whole-tooth segmentation. Pulp chamber and canals are not segmented.',
  },
  {
    n: 5,
    tabLabel: 'Tooth 48',
    title: 'Impacted tooth 48',
    fdi: '48',
    focusLayer: 'tooth-48',
    side: null,
    context: 'Tooth 48 and the neighbouring mandible and nerve canal are segmented.',
  },
  {
    n: 1,
    tabLabel: 'Right TMJ',
    title: 'Right TMJ region',
    fdi: '18 / 48',
    focusLayer: null,
    side: 'right',
    context: 'Jaw anatomy only. The dataset labels bone, not the disc or joint pathology.',
  },
  {
    n: 2,
    tabLabel: 'Left TMJ',
    title: 'Left TMJ region',
    fdi: '28 / 38',
    focusLayer: null,
    side: 'left',
    context: 'Jaw anatomy only. The dataset labels bone, not the disc or joint pathology.',
  },
  {
    n: 4,
    tabLabel: 'Tooth 11',
    title: 'Periapical review · tooth 11',
    fdi: '11',
    focusLayer: 'tooth-11',
    side: null,
    context: 'Review prompt only. The dataset has no periapical lesion label.',
  },
];
