/**
 * Five scanner actions. A model may only return one of these shapes.
 * Anything else becomes a question and changes nothing.
 */

export type ScannerAction =
  | { action: 'change_medication'; patient: string; value: string }
  | { action: 'view_history'; patient: string }
  | { action: 'view_mri'; patient: string }
  | { action: 'add_note'; text: string }
  | { action: 'send_instructions'; patient: string; text: string }
  | { action: 'ask'; question: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateModelOutput(raw: unknown): ScannerAction {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const action = text(row.action);
  const patient = text(row.patient);
  const value = text(row.value);
  const note = text(row.text);
  const question = text(row.question);
  if (action === 'change_medication' && patient && value) return { action, patient, value };
  if (action === 'view_history' && patient) return { action, patient };
  if (action === 'view_mri' && patient) return { action, patient };
  if (action === 'add_note' && note) return { action, text: note };
  if (action === 'send_instructions' && patient && note) return { action, patient, text: note };
  if (action === 'ask' && question) return { action, question };
  return { action: 'ask', question: 'I did not understand that. Which patient, and which of the five actions?' };
}

export const ACTION_TOOLS = [
  'change_medication',
  'view_history',
  'view_mri',
  'add_note',
  'send_instructions',
] as const;

export interface ActionResult {
  action: ScannerAction;
  understood: string;
  pending: { field: string; before: string; after: string } | null;
  table: string[] | null;
  note: string | null;
  error: string | null;
  sent: boolean;
}

export function understoodLine(action: ScannerAction): string {
  switch (action.action) {
    case 'change_medication':
      return `Change medication for ${action.patient} to ${action.value}`;
    case 'view_history':
      return `View allergies and history for ${action.patient}`;
    case 'view_mri':
      return `View latest MRI for ${action.patient}`;
    case 'add_note':
      return `Add a note: ${action.text}`;
    case 'send_instructions':
      return `Send instructions to ${action.patient}`;
    case 'ask':
      return action.question;
  }
}

export function planAction(action: ScannerAction, before: string): ActionResult {
  const understood = understoodLine(action);
  if (action.action === 'ask') {
    return { action, understood, pending: null, table: null, note: null, error: action.question, sent: false };
  }
  if (action.action === 'change_medication') {
    return { action, understood, pending: { field: 'medication', before, after: action.value }, table: null, note: null, error: null, sent: false };
  }
  if (action.action === 'view_history') {
    return { action, understood, pending: null, table: [before], note: null, error: null, sent: false };
  }
  if (action.action === 'view_mri') {
    return { action, understood, pending: null, table: null, note: null, error: null, sent: false };
  }
  if (action.action === 'add_note') {
    return { action, understood, pending: null, table: null, note: action.text, error: null, sent: false };
  }
  return {
    action,
    understood,
    pending: { field: 'instructions', before: '', after: action.text },
    table: null,
    note: null,
    error: null,
    sent: false,
  };
}

export function confirmResult(result: ActionResult): ActionResult {
  if (!result.pending) return result;
  return { ...result, pending: null, sent: true };
}

export interface GestureTick {
  name: string;
  at: number;
}

export function gestureSignal(events: readonly GestureTick[], now: number, portName: string): string {
  const last = events[events.length - 1];
  if (!last || now - last.at >= 5000) return `No signal from gesture board (${portName})`;
  return `${last.name} ${new Date(last.at).toISOString()}`;
}

/** Request body for a structured function call. The key stays on the server. */
export function openAiPayload(transcript: string, patients: readonly { name: string; mrn: string }[]): unknown {
  return {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Choose one function. Patients: ${patients.map((p) => `${p.name} MRN ${p.mrn}`).join('; ')}. Actions: ${ACTION_TOOLS.join(', ')}. If unclear, call ask.`,
      },
      { role: 'user', content: transcript },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'scanner_action',
          parameters: {
            type: 'object',
            properties: {
              action: { enum: [...ACTION_TOOLS, 'ask'] },
              patient: { type: 'string' },
              value: { type: 'string' },
              text: { type: 'string' },
              question: { type: 'string' },
            },
            required: ['action'],
          },
        },
      },
    ],
  };
}
