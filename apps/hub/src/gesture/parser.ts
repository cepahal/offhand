import { GestureEvent } from '@hoverscan/contracts';

export type ParsedLine =
  | { kind: 'event'; ev: GestureEvent }
  | { kind: 'comment'; text: string }
  | { kind: 'empty' }
  | { kind: 'invalid'; line: string; error: string };

/**
 * One line from the board. Contract lines are JSON; lines starting with "#" are the firmware's
 * human-readable serial-monitor output (self tests, status) and are passed through as comments.
 * Anything else (e.g. ESP32 ROM boot chatter) is "invalid" and should only be logged at debug.
 */
export function parseLine(raw: string): ParsedLine {
  const line = raw.replace(/\r$/, '').trim();
  if (!line) return { kind: 'empty' };
  if (line.startsWith('#')) return { kind: 'comment', text: line.replace(/^#\s?/, '') };
  if (!line.startsWith('{')) return { kind: 'invalid', line, error: 'not JSON' };
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (e) {
    return { kind: 'invalid', line, error: `bad JSON: ${(e as Error).message}` };
  }
  const parsed = GestureEvent.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { kind: 'invalid', line, error: `contract: ${issue?.path.join('.')} ${issue?.message}` };
  }
  return { kind: 'event', ev: parsed.data };
}
