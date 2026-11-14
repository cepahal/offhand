import { describe, expect, it } from 'vitest';
import { commandFromModel, commandLine, interpretCommand } from '../src/demo/hack-commands.js';

describe('Hack commands', () => {
  it('recognizes the six spoken commands', () => {
    expect(interpretCommand("show patient's data").command).toBe('show_patient');
    expect(interpretCommand("change patient's prescription to ibuprofen")).toMatchObject({ command: 'change_prescription', medication: 'ibuprofen' });
    expect(interpretCommand('create a note about checking this tooth again later')).toMatchObject({ command: 'add_note', text: 'Checking this tooth again later' });
    expect(interpretCommand('send a message to the patient that their treatment appointment has been scheduled')).toMatchObject({
      command: 'message_patient',
      text: 'Your treatment appointment has been scheduled.',
    });
    expect(interpretCommand("send a message to the hospital that the patient's treatment plan has been updated")).toMatchObject({
      command: 'message_hospital',
    });
    expect(interpretCommand("view patient's dental scans").command).toBe('view_scans');
    expect(interpretCommand('Open bite simulation.').command).toBe('open_bite');
    expect(interpretCommand("Show the patient's data.").command).toBe('show_patient');
    expect(interpretCommand('Create a note about the right condyle.')).toMatchObject({ command: 'add_note', text: 'The right condyle' });
    expect(interpretCommand('Change the prescription to ibuprofen.')).toMatchObject({ command: 'change_prescription', medication: 'ibuprofen' });
    expect(interpretCommand('Send a message to the patient that their appointment has been scheduled.')).toMatchObject({
      command: 'message_patient',
      text: 'Your appointment has been scheduled.',
    });
    expect(interpretCommand('Send a message to the hospital that the treatment plan has been updated.')).toMatchObject({
      command: 'message_hospital',
      text: 'Hospital update: The treatment plan has been updated.',
    });
    expect(interpretCommand('Hack, open bite simulation.').command).toBe('open_bite');
    expect(interpretCommand('Hack, simulate bite force on tooth 19.')).toMatchObject({ command: 'simulate_bite', tooth: '19' });
    expect(interpretCommand('Hack, check for bone overload.').command).toBe('show_bone');
    expect(interpretCommand('Hack, show biomechanical analysis.').command).toBe('show_analysis');
    expect(interpretCommand('Hack, show suggested adjustments.').command).toBe('show_adjustments');
    expect(interpretCommand('Hack, replay the simulation.').command).toBe('replay_bite');
    expect(interpretCommand('Hack, simulate bite force.').command).toBe('ask');
  });

  it('keeps a long note intact and only falls back to the first 20 words', () => {
    const long = `create a note about ${Array.from({ length: 24 }, (_, index) => `word${index}`).join(' ')}`;
    const noted = interpretCommand(long);
    expect(noted.command).toBe('add_note');
    if (noted.command === 'add_note') expect(noted.text).toContain('word23');
    const noisy = `${"show patient's data "}${'extra '.repeat(16)}change prescription to something`;
    expect(interpretCommand(noisy).command).toBe('show_patient');
  });

  it('asks when the medication is ambiguous and rejects an unknown model action', () => {
    expect(interpretCommand("change patient's prescription to something").command).toBe('ask');
    expect(commandFromModel({ action: 'delete_patient' }).command).toBe('ask');
    const allowed = commandFromModel({ action: 'change_prescription', value: 'ibuprofen' });
    expect(allowed).toMatchObject({ command: 'change_prescription', medication: 'ibuprofen' });
    expect(commandLine(allowed)).toBe('Change prescription to ibuprofen');
  });
});
