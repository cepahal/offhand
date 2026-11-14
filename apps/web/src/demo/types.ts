/** Shapes for the browser-only demonstration. Nothing here is a real patient. */

export interface Theatre {
  id: string;
  name: string;
}

export interface Site {
  id: string;
  name: string;
  theatres: Theatre[];
}

export interface Hospital {
  id: string;
  name: string;
  sites: Site[];
}

export interface PolicyCard {
  id: string;
  name: string;
  description: string;
  required: boolean;
}

export interface HitlItem {
  id: string;
  label: string;
}

export interface DemoStudy {
  id: string;
  modality: string;
  sequence: string;
  date: string;
}

export interface HistoryEntry {
  date: string;
  text: string;
}

export interface DemoPatient {
  mrn: string;
  name: string;
  age: number;
  sex: string;
  dob: string;
  procedure: string;
  scheduled: string;
  allergies: string[];
  medications: string[];
  history: HistoryEntry[];
  studies: DemoStudy[];
  notes: string;
}

export interface Catalog {
  hospitals: Hospital[];
  policies: PolicyCard[];
  hitl: HitlItem[];
}

export type OnboardingStep = 'hospital' | 'location' | 'policies' | 'hitl' | 'review';

export interface OnboardingDraft {
  hospitalId: string | null;
  siteId: string | null;
  theatreId: string | null;
  policyIds: string[];
  hitl: Record<string, boolean>;
}

export interface DemoSession extends OnboardingDraft {
  hospitalId: string;
  siteId: string;
  theatreId: string;
  completedAt: string;
}

export const CHART_FIELDS = ['procedure', 'allergies', 'medications', 'history', 'notes'] as const;
export type ChartField = (typeof CHART_FIELDS)[number];

export interface ChartEdit {
  id: string;
  mrn: string;
  field: ChartField;
  before: string;
  after: string;
  status: 'pending' | 'confirmed';
  savedAt: string;
  confirmedAt?: string;
}

export type AppSection = 'patients' | 'surgery' | 'imaging' | 'messages' | 'wards' | 'theatres' | 'audit' | 'settings';
