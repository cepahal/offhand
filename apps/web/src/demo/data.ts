/** Demonstration catalogues. The app and the tests both read these JSON files. */
import hospitalsFile from '../../../../config/demo/hospitals.json';
import policiesFile from '../../../../config/demo/policies.json';
import patientsFile from '../../../../config/demo/patients.json';
import type { Catalog, DemoPatient, HitlItem, Hospital, PolicyCard } from './types.js';

export const hospitals: Hospital[] = hospitalsFile.hospitals;
export const policies: PolicyCard[] = policiesFile.policies;
export const hitlItems: HitlItem[] = policiesFile.humanInTheLoop;
export const patients: DemoPatient[] = patientsFile.patients;

export const catalog: Catalog = { hospitals, policies, hitl: hitlItems };

if (hospitals.length !== 3) throw new Error('config/demo/hospitals.json must list three hospitals');
if (policies.length === 0 || hitlItems.length === 0) throw new Error('config/demo/policies.json is empty');
if (patients.length !== 10) throw new Error('config/demo/patients.json must list ten patients');
