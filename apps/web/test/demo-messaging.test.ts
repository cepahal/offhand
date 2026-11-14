import { describe, expect, it } from 'vitest';
import {
  advanceSimulated,
  emptyMessaging,
  hospitalUpdateText,
  ingestKeyword,
  logLine,
  persistRoles,
  phonePanels,
  prescriptionText,
  releaseMessage,
  renderedBlob,
  type MessagingState,
} from '../../hub/src/messaging/demo-messages.js';
import { patients } from '../src/demo/data.js';

const NOW = '2026-11-12T17:40:00.000Z';
const HOSPITAL_PHONE = '+15551230001';
const PATIENT_PHONE = '+15559876543';
const alex = patients.find((patient) => patient.mrn === '123132');
if (!alex) throw new Error('missing Alex Wu');

function refs(): () => string {
  let n = 0;
  return () => `rcp_${String(n++).padStart(12, '0')}`;
}

function register(state: MessagingState = emptyMessaging()): MessagingState {
  const newRef = refs();
  const hospital = ingestKeyword(state, HOSPITAL_PHONE, 'HOSPITAL', NOW, newRef);
  const patient = ingestKeyword(hospital.state, PATIENT_PHONE, 'patient', NOW, newRef);
  return patient.state;
}

describe('demonstration messaging', () => {
  it('does not send without confirm, approval, or a second time', () => {
    const input = {
      shareId: '11111111-1111-4111-8111-111111111111',
      role: 'patient' as const,
      text: prescriptionText(alex),
      confirmed: false,
      clinicianApproved: true,
      mode: 'simulated' as const,
      now: NOW,
    };
    const unconfirmed = releaseMessage(emptyMessaging(), input);
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) expect(unconfirmed.reason).toBe('needs_confirm');
    expect(unconfirmed.state.events).toEqual([]);

    const unapproved = releaseMessage(emptyMessaging(), { ...input, confirmed: true, clinicianApproved: false });
    expect(unapproved.ok).toBe(false);
    if (!unapproved.ok) expect(unapproved.reason).toBe('needs_approval');
    expect(unapproved.state.attempted).toEqual([]);

    const sent = releaseMessage(emptyMessaging(), { ...input, confirmed: true });
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.transport).toBe('simulated');
      expect(sent.state.events.map((event) => event.kind)).toEqual(['sent']);
      const again = releaseMessage(sent.state, { ...input, confirmed: true });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.reason).toBe('duplicate');
      expect(again.state.events.filter((event) => event.kind === 'sent')).toHaveLength(1);
    }
  });

  it('gives the hospital and the patient different recipient refs', () => {
    const state = register();
    const hospital = state.roles.find((role) => role.role === 'hospital');
    const patient = state.roles.find((role) => role.role === 'patient');
    expect(hospital?.ref).toMatch(/^rcp_[a-z0-9]{6,32}$/);
    expect(patient?.ref).toMatch(/^rcp_[a-z0-9]{6,32}$/);
    expect(hospital?.ref).not.toBe(patient?.ref);
  });

  it('ignores a keyword from a phone that has not registered with HOSPITAL or PATIENT', () => {
    const newRef = refs();
    const hello = ingestKeyword(emptyMessaging(), HOSPITAL_PHONE, 'hello', NOW, newRef);
    const hoverscan = ingestKeyword(hello.state, HOSPITAL_PHONE, 'HOVERSCAN', NOW, newRef);
    expect(hello.outcome).toBe('ignored');
    expect(hoverscan.outcome).toBe('ignored');
    expect(hoverscan.state.roles).toEqual([]);
    expect(hoverscan.state.handles).toEqual({});
  });

  it('keeps the full phone number out of rendered text, logs, and stored roles', () => {
    const state = register();
    const sent = releaseMessage(state, {
      shareId: '22222222-2222-4222-8222-222222222222',
      role: 'patient',
      text: prescriptionText(alex),
      confirmed: true,
      clinicianApproved: true,
      mode: 'simulated',
      now: NOW,
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const delivered = advanceSimulated(sent.state, '22222222-2222-4222-8222-222222222222', NOW);
    const hospital = releaseMessage(delivered, {
      shareId: '33333333-3333-4333-8333-333333333333',
      role: 'hospital',
      text: hospitalUpdateText(alex, 'Theatre 2'),
      confirmed: true,
      clinicianApproved: true,
      mode: 'simulated',
      now: NOW,
    });
    expect(hospital.ok).toBe(true);
    if (!hospital.ok) return;
    const blob = renderedBlob(hospital.state, 'simulated', alex.name);
    const stored = persistRoles(null, hospital.state.roles);
    const logs = hospital.state.events.map(logLine).join('\n');
    for (const phone of [HOSPITAL_PHONE, PATIENT_PHONE, '5551230001', '5559876543']) {
      expect(blob).not.toContain(phone);
      expect(stored).not.toContain(phone);
      expect(logs).not.toContain(phone);
      expect(JSON.stringify(hospital.state.events)).not.toContain(phone);
      expect(JSON.stringify(hospital.state.roles)).not.toContain(phone);
    }
    expect(stored).toContain(hospital.state.roles[0]?.last4);
    const panels = phonePanels(hospital.state, 'simulated', alex.name);
    expect(panels[0]?.title).toBe('Hospital software inbox');
    expect(panels[0]?.badge).toBe('SIMULATED');
    expect(panels[0]?.messages[0]?.poll).toBeNull();
    expect(panels[1]?.title).toBe('Patient: Alex Wu');
    expect(panels[1]?.messages[0]?.poll?.options).toEqual(['Yes', 'No', 'Call the team']);
    expect(panels[1]?.messages[0]?.timeline).toEqual(['sent', 'delivered', 'read']);
    expect(hospital.state.events.some((event) => event.text.includes('Emergency'))).toBe(false);
  });

  it('labels a registered role live only when Photon is live', () => {
    const state = register();
    expect(phonePanels(state, 'simulated', alex.name)[1]?.badge).toBe('SIMULATED');
    expect(phonePanels(state, 'live', alex.name)[1]?.badge).toBe('LIVE');
    expect(phonePanels(state, 'live', alex.name)[0]?.last4).toBe('0001');
  });
});
