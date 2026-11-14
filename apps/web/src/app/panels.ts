/**
 * Side-panel registry. Each feature adds one entry; App renders them in `order`.
 * Owners add their own panels here (append-only), e.g. the voice and share panels.
 */
import type { ComponentType } from 'preact';
import { GestureHud } from '../hud/GestureHud.js';
import { BookmarksPanel, FindingsPanel, LayersPanel } from '../panels/ViewerPanels.js';

export interface PanelDef {
  id: string;
  order: number;
  component: ComponentType;
}

export const panels: PanelDef[] = [
  { id: 'gesture-hud', order: 10, component: GestureHud },
  { id: 'layers', order: 20, component: LayersPanel },
  { id: 'findings', order: 30, component: FindingsPanel },
  { id: 'bookmarks', order: 40, component: BookmarksPanel },
];
