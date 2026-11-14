import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(): Logger {
  const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } } }
      : {}),
  });
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
