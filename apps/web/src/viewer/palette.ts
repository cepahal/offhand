/**
 * Modest colours for the demonstration brain. Cortex is a flat fill.
 * A region is called a tumour only when the dataset text says so (BraTS, or the word tumour).
 * A lesion dataset, including ISBI, is "lesion (demonstration)".
 */

export const PALETTE = {
  cortex: '#c9b2b0',
  whiteMatter: '#f3ead7',
  ventricles: '#8aa0ad',
  skull: '#e6d3b8',
  skullOpacity: 0.15,
  highlight: '#f5d33b',
} as const;

export const SURROUND_OPACITY = 0.4;
export const LESION_LABEL = 'lesion (demonstration)';
export const TUMOUR_LABEL = 'tumour (demonstration)';

export type AnatomyRole = 'cortex' | 'white' | 'ventricle' | 'skull' | 'highlight' | 'other';
export type RegionKind = 'lesion' | 'tumour';

export function layerRole(label: string, id = ''): AnatomyRole {
  const text = `${label} ${id}`.toLowerCase();
  if (/lesion|tumou?r|highlight/.test(text)) return 'highlight';
  if (/white matter/.test(text)) return 'white';
  if (/ventricle/.test(text)) return 'ventricle';
  if (/cortex|brain surface|grey matter|gray matter/.test(text)) return 'cortex';
  if (/skull-stripped/.test(text)) return 'other';
  if (/skull|scalp|bone/.test(text)) return 'skull';
  return 'other';
}

export function roleColor(role: AnatomyRole, fallback: string): string {
  if (role === 'cortex') return PALETTE.cortex;
  if (role === 'white') return PALETTE.whiteMatter;
  if (role === 'ventricle') return PALETTE.ventricles;
  if (role === 'skull') return PALETTE.skull;
  if (role === 'highlight') return PALETTE.highlight;
  return fallback;
}

/** Dataset wording only. A procedure name such as "tumour resection" is not passed in. */
export function regionKindFromSources(text: string): RegionKind | null {
  if (/brats/i.test(text)) return 'tumour';
  if (/lesion/i.test(text)) return 'lesion';
  if (/\btumou?rs?\b/i.test(text)) return 'tumour';
  return null;
}

export function regionLabel(kind: RegionKind | null): string {
  return kind === 'tumour' ? TUMOUR_LABEL : LESION_LABEL;
}
