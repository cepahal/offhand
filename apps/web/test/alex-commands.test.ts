import { describe, expect, it } from 'vitest';
import { actionFromModel, actionFromText, commandLabel } from '../src/demo/alex-commands.js';

describe('Alex commands', () => {
  it('reads a prose model reply that names the MRN', () => {
    const action = actionFromText('View allergies and history for 123132');
    expect(action).toEqual({ action: 'view_history', patient: '123132' });
    expect(commandLabel(action)).toBe('View allergies and history for 123132');
  });

  it('parses the six spoken commands and rejects a bad model payload', () => {
    expect(actionFromText("show me Alex's history").action).toBe('view_history');
    expect(actionFromText('show me Alex prescriptions').action).toBe('view_prescription');
    expect(actionFromText('change Alex prescription to paracetamol')).toMatchObject({ action: 'change_prescription', value: 'paracetamol' });
    expect(actionFromText('send a message to the hospital about the visit').action).toBe('message_hospital');
    expect(actionFromText('send a message to Alex rest today').action).toBe('message_patient');
    expect(actionFromText('view Alex MRI scans').action).toBe('view_mri');
    expect(actionFromText('put a note that I have to check this again').action).toBe('add_note');
    const bad = actionFromModel({ action: 'delete_patient' });
    expect(bad.action).toBe('ask');
  });
});