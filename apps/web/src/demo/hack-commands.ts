/**
 * Hack commands. A model may only return one of these actions.
 * Anything else is a question and changes nothing.
 */
export type HackCommand =
  | { command: 'show_patient' }
  | { command: 'change_prescription'; medication: string }
  | { command: 'add_note'; text: string }
  | { command: 'message_patient'; text: string }
  | { command: 'message_hospital'; text: string }
  | { command: 'view_scans' }
  | { command: 'ask'; question: string };

export type HackPhase = 'Idle' | 'Listening' | 'Understanding' | 'Preparing' | 'Awaiting Confirmation' | 'Executing' | 'Completed';

const ASK = 'I did not understand that. Try show data, change prescription, a note, a message, or view scans.';
const WHICH_MEDICATION = 'Which medication should I enter?';

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function ask(question: string): HackCommand {
  return { command: 'ask', question };
}

export function isAmbiguousMedication(value: string): boolean {
  const text = value.trim();
  if (text.length < 3) return true;
  return /^(something|anything|it|that|this|medicine|medication|a medication|the usual|whatever|unsure|uncertain|unknown|unspecified)$/i.test(text) || /[?]/.test(text);
}

function medication(text: string): string {
  return /(?:prescription|medication)\s+to\s+(.+)$/i.exec(text)?.[1]?.replace(/[.?!]+$/, '').trim() ?? '';
}

function afterThat(text: string): string {
  const match = /\bthat\s+(.+)$/i.exec(text);
  return (match?.[1] ?? text).replace(/[.?!]+$/, '').trim();
}

function noteText(text: string): string {
  const body = text.replace(/^.*\bnote\b(?:\s+about|\s+that|\s+to)?\s*/i, '').replace(/[.?!]+$/, '').trim();
  if (!body) return '';
  return body.charAt(0).toUpperCase() + body.slice(1);
}

export function commandFromText(input: string): HackCommand {
  const text = clean(input);
  const lower = text.toLowerCase();
  if (!text) return ask(ASK);
  if (/(change|set|update).*(prescription|medication)/.test(lower)) {
    const named = medication(text);
    if (isAmbiguousMedication(named)) return ask(WHICH_MEDICATION);
    return { command: 'change_prescription', medication: named };
  }
  if (/(show|open|view).*(data|record|chart)|patient'?s data/.test(lower)) return { command: 'show_patient' };
  if (/(message|send|tell)/.test(lower) && /hospital/.test(lower)) {
    const body = afterThat(text);
    return { command: 'message_hospital', text: `Hospital update: ${body.charAt(0).toUpperCase()}${body.slice(1)}.` };
  }
  if (/(message|send|tell)/.test(lower) && /patient/.test(lower)) {
    let body = afterThat(text).replace(/^their\s+/i, 'your ');
    if (!/^your\b/i.test(body)) body = `your ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
    return { command: 'message_patient', text: `${body.charAt(0).toUpperCase()}${body.slice(1)}.` };
  }
  if (/(scan|scans|mri|cbct)/.test(lower)) return { command: 'view_scans' };
  if (/\bnote\b/.test(lower)) {
    const textNote = noteText(text);
    if (!textNote) return ask('What should the note say?');
    return { command: 'add_note', text: textNote };
  }
  return ask(ASK);
}

/** Full sentence first. The first 20 words are used only when the full sentence is not a command. */
export function interpretCommand(input: string): HackCommand {
  const full = commandFromText(input);
  if (full.command !== 'ask') return full;
  const words = clean(input).split(' ');
  if (words.length <= 20) return full;
  const shorter = commandFromText(words.slice(0, 20).join(' '));
  return shorter.command === 'ask' ? full : shorter;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function commandFromModel(raw: unknown): HackCommand {
  if (typeof raw === 'string') return interpretCommand(raw);
  if (!raw || typeof raw !== 'object') return ask(ASK);
  const row = raw as Record<string, unknown>;
  const content = textOf(row.content) || textOf(row.message);
  const action = textOf(row.action);
  const value = textOf(row.value);
  const note = textOf(row.text);
  const question = textOf(row.question);
  if (action === 'show_patient' || action === 'view_history') return { command: 'show_patient' };
  if (action === 'view_scans' || action === 'view_mri') return { command: 'view_scans' };
  if ((action === 'change_prescription' || action === 'change_medication') && value) {
    if (isAmbiguousMedication(value)) return ask(WHICH_MEDICATION);
    return { command: 'change_prescription', medication: value };
  }
  if (action === 'add_note' && note) return { command: 'add_note', text: note };
  if ((action === 'message_patient' || action === 'send_instructions') && note) return { command: 'message_patient', text: note };
  if (action === 'message_hospital' && note) return { command: 'message_hospital', text: note };
  if (action === 'ask' && question) return ask(question);
  if (content) return interpretCommand(content);
  return ask(ASK);
}

export function commandLine(command: HackCommand): string {
  switch (command.command) {
    case 'show_patient':
      return "Show the patient's data";
    case 'change_prescription':
      return `Change prescription to ${command.medication}`;
    case 'add_note':
      return `Note: ${command.text}`;
    case 'message_patient':
      return 'Message to the patient';
    case 'message_hospital':
      return 'Message to the hospital';
    case 'view_scans':
      return "View the patient's dental scans";
    case 'ask':
      return command.question;
  }
}
