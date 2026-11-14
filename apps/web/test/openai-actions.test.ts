import { describe, expect, it } from 'vitest';
import { confirmResult, gestureSignal, planAction, validateModelOutput } from '../src/demo/openai-actions.js';

describe('scanner actions', () => {
  it('parses each of the five actions from a model payload', () => {
    const samples = [
      { action: 'change_medication', patient: 'Alex Wu', value: 'ibuprofen' },
      { action: 'view_history', patient: 'Jordan Ellis' },
      { action: 'view_mri', patient: 'Samira Okonkwo' },
      { action: 'add_note', text: 'margin is clear' },
      { action: 'send_instructions', patient: 'Alex Wu', text: 'rest today' },
    ];
    for (const sample of samples) {
      expect(validateModelOutput(sample).action).toBe(sample.action);
    }
  });

  it('changes nothing when the model output is outside the schema', () => {
    const action = validateModelOutput({ action: 'delete_patient', patient: 'Alex Wu' });
    const result = planAction(action, 'Levetiracetam');
    expect(result.pending).toBeNull();
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/did not understand/i);
  });

  it('shows a diff until confirm, and does not send before that', () => {
    const pending = planAction(validateModelOutput({ action: 'change_medication', patient: 'Alex Wu', value: 'ibuprofen' }), 'Levetiracetam');
    expect(pending.pending).toEqual({ field: 'medication', before: 'Levetiracetam', after: 'ibuprofen' });
    expect(pending.sent).toBe(false);
    expect(confirmResult(pending).sent).toBe(true);
  });

  it('reports a missing gesture signal after 5 seconds', () => {
    expect(gestureSignal([], 10_000, 'usbmodem')).toBe('No signal from gesture board (usbmodem)');
    expect(gestureSignal([{ name: 'left', at: 1000 }], 7000, 'usbmodem')).toBe('No signal from gesture board (usbmodem)');
    expect(gestureSignal([{ name: 'left', at: 6000 }], 7000, 'usbmodem')).toContain('left');
  });
});