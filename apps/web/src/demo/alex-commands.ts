/**
 * Alex Wu only. A model object or a plain sentence both become one of the six actions.
 * Anything else is a question and changes nothing.
 */
export type AlexAction =
  | { action: 'view_history'; patient: string }
  | { action: 'view_prescription'; patient: string }
  | { action: 'change_prescription'; patient: string; value: string }
  | { action: 'message_hospital'; text: string }
  | { action: 'message_patient'; text: string }
  | { action: 'view_mri'; patient: string }
  | { action: 'add_note'; text: string }
  | { action: 'ask'; question: string };

const ASK = 'I did not understand that. Which of Alex’s history, prescription, MRI, a note, or a message?';

function clean(text: string): string {
  return text
    .replace(/^understood as:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAlex(text: string): boolean {
  return /\balex\b|123132/.test(text.toLowerCase());
}

function who(text: string): string {
  return text.includes('123132') ? '123132' : 'Alex Wu';
}

export function actionFromText(input: string): AlexAction {
  const text = clean(input);
  const lower = text.toLowerCase();
  if (!text) return { action: 'ask', question: ASK };
  if (/\b(jordan|samira|chris|riley)\b/.test(lower) && !isAlex(lower)) {
    return { action: 'ask', question: 'This screen is Alex Wu, MRN 123132.' };
  }
  const change = /(?:change|set|update).*(?:prescription|medication)(?:.*\bto\b)?\s+(.+)$/i.exec(text);
  if (change?.[1] && (isAlex(lower) || !/\b(jordan|samira|chris|riley)\b/.test(lower))) {
    return { action: 'change_prescription', patient: who(text), value: change[1].replace(/[.?!]+$/, '').trim() };
  }
  if (/history|allerg/.test(lower)) return { action: 'view_history', patient: who(text) };
  if (/prescription|medication/.test(lower)) return { action: 'view_prescription', patient: who(text) };
  if (/hospital/.test(lower)) {
    const body = text.replace(/.*hospital\s*/i, '').trim() || 'Update from the scanner.';
    return { action: 'message_hospital', text: body };
  }
  if (/(message|text|send).*(patient|alex)|to alex/.test(lower)) {
    const body = text.replace(/.*(patient|alex)\s*/i, '').trim() || 'Update from the scanner.';
    return { action: 'message_patient', text: body };
  }
  if (/mri|scan/.test(lower)) return { action: 'view_mri', patient: who(text) };
  if (/note/.test(lower)) {
    const body = text.replace(/.*note(?:\s+that)?\s*/i, '').trim();
    if (!body) return { action: 'ask', question: ASK };
    return { action: 'add_note', text: body };
  }
  return { action: 'ask', question: ASK };
}

export function actionFromModel(raw: unknown): AlexAction {
  if (typeof raw === 'string') return actionFromText(raw);
  if (!raw || typeof raw !== 'object') return { action: 'ask', question: ASK };
  const row = raw as Record<string, unknown>;
  const content = typeof row.content === 'string' ? row.content : typeof row.message === 'string' ? row.message : '';
  const action = typeof row.action === 'string' ? row.action : '';
  const patient = typeof row.patient === 'string' ? row.patient : '';
  const value = typeof row.value === 'string' ? row.value : '';
  const note = typeof row.text === 'string' ? row.text : '';
  if (action === 'view_history' && (patient || content)) return { action: 'view_history', patient: patient || who(content) };
  if ((action === 'view_prescription' || action === 'change_medication') && !value && patient) return { action: 'view_prescription', patient };
  if ((action === 'change_prescription' || action === 'change_medication') && value) return { action: 'change_prescription', patient: patient || 'Alex Wu', value };
  if (action === 'message_hospital' && note) return { action: 'message_hospital', text: note };
  if ((action === 'message_patient' || action === 'send_instructions') && note) return { action: 'message_patient', text: note };
  if (action === 'view_mri') return { action: 'view_mri', patient: patient || 'Alex Wu' };
  if (action === 'add_note' && note) return { action: 'add_note', text: note };
  if (content) return actionFromText(content);
  if (action === 'ask') return { action: 'ask', question: typeof row.question === 'string' && row.question ? row.question : ASK };
  return { action: 'ask', question: ASK };
}

export function commandLabel(action: AlexAction): string {
  switch (action.action) {
    case 'view_history':
      return `View allergies and history for ${action.patient}`;
    case 'view_prescription':
      return `View prescription for ${action.patient}`;
    case 'change_prescription':
      return `Change prescription for ${action.patient} to ${action.value}`;
    case 'message_hospital':
      return 'Message to the hospital';
    case 'message_patient':
      return 'Message to Alex';
    case 'view_mri':
      return `View MRI for ${action.patient}`;
    case 'add_note':
      return `Note: ${action.text}`;
    case 'ask':
      return action.question;
  }
}
