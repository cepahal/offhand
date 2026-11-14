import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

const SECRET_KEYS = ['phone', 'phoneNumber', 'handle', 'apiKey', 'token', 'authorization', 'password', 'recipient'];
/** A leading "*." matches exactly one level in pino's redactor, so list each depth explicitly. */
const MAX_REDACT_DEPTH = 4;
export const REDACT_PATHS = SECRET_KEYS.flatMap((key) =>
  Array.from({ length: MAX_REDACT_DEPTH + 1 }, (_, depth) => `${'*.'.repeat(depth)}${key}`),
);

/** E.164 numbers ("+" then 7-15 digits), also with spaces, dots, dashes or parentheses between digits. */
const E164_RE = /\+[1-9](?:[\s().-]*\d){6,14}/g;

export function redactPhone(s: string): string {
  return s.replace(E164_RE, '***');
}

/**
 * Secrets are removed by key and phone numbers are masked in every string argument, so no
 * module can log one by accident. `destination` is for tests.
 */
export function createLogger(opts: { level?: string; destination?: DestinationStream } = {}): Logger {
  const pretty = !opts.destination && process.stdout.isTTY && process.env.NODE_ENV !== 'production';
  const options = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '***' },
    hooks: {
      logMethod(this: Logger, args: Parameters<Logger['info']>, method: Logger['info']) {
        const masked = args.map((a: unknown) => (typeof a === 'string' ? redactPhone(a) : a));
        return method.apply(this, masked as Parameters<Logger['info']>);
      },
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } } }
      : {}),
  };
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

/** Append-only JSONL record of everything that crossed the bus: logs/session-<ts>.jsonl. */
export class SessionLog {
  readonly path: string;
  private stream: WriteStream;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.path = join(dir, `session-${stamp}.jsonl`);
    this.stream = createWriteStream(this.path, { flags: 'a' });
  }

  write(from: string, env: unknown): void {
    this.stream.write(JSON.stringify({ t: Date.now(), from, env }) + '\n');
  }

  close(): Promise<void> {
    return new Promise((res) => this.stream.end(res));
  }
}
