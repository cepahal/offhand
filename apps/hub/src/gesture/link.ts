import { EventEmitter } from 'node:events';
import type { GestureEvent } from '@hoverscan/contracts';
import { ReadlineParser, SerialPort } from 'serialport';
import type { GestureConfig } from '../config.js';
import { parseLine } from './parser.js';

export type LinkState =
  | 'off' // GESTURE_PORT=off
  | 'searching' // listing ports
  | 'no_device' // no ESP32 USB bridge found / port does not exist
  | 'connecting' // port opening or open but nothing received yet
  | 'live' // lines arriving
  | 'silent' // port open but nothing ever arrived (wrong firmware/baud?)
  | 'lost' // was live, then USB unplugged or heartbeat stopped
  | 'error'; // port busy / open failed

export type PajHealth = 'ok' | 'missing' | 'lost' | 'unknown';

export interface LinkStatus {
  state: LinkState;
  detail: string;
  port?: string;
  fw?: string;
  paj: PajHealth;
  since: number;
}

export interface PortInfoLite {
  path: string;
  vendorId?: string | undefined;
  productId?: string | undefined;
  manufacturer?: string | undefined;
}

/** USB-UART bridges found on ESP32 dev boards, by USB vendor id. */
export const KNOWN_BRIDGES: Record<string, string> = {
  '10c4': 'Silicon Labs CP210x',
  '1a86': 'WCH CH340/CH9102',
  '0403': 'FTDI',
  '303a': 'Espressif native USB',
};

export function pickEsp32Port(ports: PortInfoLite[]): PortInfoLite | undefined {
  return ports.find((p) => p.vendorId && KNOWN_BRIDGES[p.vendorId.toLowerCase()]);
}

export function describePorts(ports: PortInfoLite[]): string {
  if (ports.length === 0) return 'none';
  return ports
    .map((p) => {
      const vid = p.vendorId?.toLowerCase();
      const what = (vid && KNOWN_BRIDGES[vid]) || p.manufacturer || 'unknown';
      return `${p.path} [${what}${vid ? ` ${vid}:${p.productId ?? '?'}` : ''}]`;
    })
    .join(', ');
}

export interface LinkDeps {
  list: () => Promise<PortInfoLite[]>;
  open: (path: string, baudRate: number) => SerialPort;
  now: () => number;
}

const defaultDeps: LinkDeps = {
  list: () => SerialPort.list(),
  open: (path, baudRate) => new SerialPort({ path, baudRate, autoOpen: false }),
  now: () => Date.now(),
};

export interface LinkEvents {
  status: [LinkStatus];
  event: [GestureEvent];
  comment: [string];
  invalid: [{ line: string; error: string }];
}

/**
 * Owns the USB serial connection to the ESP32. Finds the port, reconnects forever, and reports
 * every failure mode as a status (no device, busy, silent, lost) instead of throwing.
 */
export class GestureLink extends EventEmitter<LinkEvents> {
  private port: SerialPort | null = null;
  private retry: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private openedAt = 0;
  private lastLineAt = 0;
  private stopped = false;
  private _status: LinkStatus;

  constructor(
    private readonly cfg: GestureConfig,
    private readonly deps: LinkDeps = defaultDeps,
  ) {
    super();
    this._status = { state: 'searching', detail: 'starting', paj: 'unknown', since: deps.now() };
  }

  get status(): LinkStatus {
    return this._status;
  }

  start(): void {
    this.stopped = false;
    if (this.cfg.port.toLowerCase() === 'off') {
      this.setStatus({ state: 'off', detail: 'Gesture board disabled (GESTURE_PORT=off).' });
      return;
    }
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    await this.closePort();
  }

  private setStatus(s: Partial<LinkStatus> & { state: LinkState; detail: string }): void {
    const changed = s.state !== this._status.state || s.detail !== this._status.detail;
    this._status = {
      ...this._status,
      ...s,
      since: changed ? this.deps.now() : this._status.since,
    };
    if (changed) this.emit('status', this._status);
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, this.cfg.rescanMs);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let path = this.cfg.port;
    if (path.toLowerCase() === 'auto') {
      let ports: PortInfoLite[];
      try {
        ports = await this.deps.list();
      } catch (e) {
        this.setStatus({ state: 'error', detail: `Could not list serial ports: ${(e as Error).message}` });
        return this.scheduleRetry();
      }
      const pick = pickEsp32Port(ports);
      if (!pick) {
        this.setStatus({
          state: 'no_device',
          detail: `No ESP32 connected (no CP210x/CH340/FTDI/Espressif USB device). Ports seen: ${describePorts(ports)}`,
          paj: 'unknown',
        });
        return this.scheduleRetry();
      }
      path = pick.path;
    }

    this.setStatus({ state: 'connecting', detail: `Opening ${path} @ ${this.cfg.baud} baud`, port: path });
    const port = this.deps.open(path, this.cfg.baud);
    this.port = port;

    port.open((err) => {
      if (err) {
        this.port = null;
        const msg = err.message;
        const missing = /not found|no such file|cannot find|ENOENT/i.test(msg);
        const busy = /access denied|busy|EBUSY|EACCES|resource/i.test(msg);
        this.setStatus({
          state: missing ? 'no_device' : 'error',
          detail: missing
            ? `No ESP32 connected at ${path} (${msg})`
            : busy
              ? `${path} is busy (${msg}). Close the Arduino Serial Monitor or any other program using it.`
              : `Could not open ${path}: ${msg}`,
          paj: 'unknown',
        });
        return this.scheduleRetry();
      }
      this.openedAt = this.deps.now();
      this.lastLineAt = 0;
      this.setStatus({ state: 'connecting', detail: `${path} open, waiting for the board to talk...` });
      this.startWatchdog(path);
    });

    const lines = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    lines.on('data', (line: string) => this.onLine(line, path));

    port.on('close', (err?: Error & { disconnected?: boolean }) => {
      if (this.port !== port) return;
      this.port = null;
      this.stopWatchdog();
      if (this.stopped) return;
      this.setStatus({
        state: 'lost',
        detail: err?.disconnected
          ? `Connection lost: ${path} disconnected (USB unplugged or board reset).`
          : `Connection lost: ${path} closed.`,
        paj: 'unknown',
      });
      this.scheduleRetry();
    });
    port.on('error', (err) => {
      this.setStatus({ state: 'error', detail: `Serial error on ${path}: ${err.message}` });
    });
  }

  private onLine(raw: string, path: string): void {
    const parsed = parseLine(raw);
    if (parsed.kind === 'empty') return;
    this.lastLineAt = this.deps.now();

    const prev = this._status;
    let { fw, paj } = prev;
    if (parsed.kind === 'event' && parsed.ev.t === 'hb') {
      fw = parsed.ev.fw;
      paj = parsed.ev.paj ?? paj;
    }
    if (prev.state !== 'live' || fw !== prev.fw || paj !== prev.paj) {
      const recovered = prev.state === 'lost' || prev.state === 'silent';
      this.setStatus({
        state: 'live',
        detail: (recovered ? 'Recovered. ' : '') + this.liveDetail(path, fw, paj),
        ...(fw !== undefined ? { fw } : {}),
        paj,
      });
    }

    if (parsed.kind === 'comment') this.emit('comment', parsed.text);
    else if (parsed.kind === 'invalid') this.emit('invalid', { line: parsed.line, error: parsed.error });
    else this.emit('event', parsed.ev);
  }

  private liveDetail(path: string, fw: string | undefined, paj: PajHealth): string {
    const pajText =
      paj === 'ok'
        ? 'PAJ7620 OK'
        : paj === 'missing'
          ? 'PAJ7620 NOT CONNECTED (check SDA/SCL/3V3/GND)'
          : paj === 'lost'
            ? 'PAJ7620 CONNECTION LOST (sensor stopped answering on I2C)'
            : 'PAJ7620 status unknown (waiting for heartbeat)';
    return `Board live on ${path}${fw ? ` (${fw})` : ''}; ${pajText}`;
  }

  private startWatchdog(path: string): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      const now = this.deps.now();
      const t = this.cfg.heartbeatTimeoutMs;
      if (this.lastLineAt === 0) {
        if (now - this.openedAt > t && this._status.state !== 'silent') {
          this.setStatus({
            state: 'silent',
            detail: `${path} is open but nothing arrived for ${Math.round(t / 1000)} s. Is the offhand firmware flashed? Is the baud ${this.cfg.baud}?`,
          });
        }
        if (now - this.openedAt > 3 * t) void this.reopen();
        return;
      }
      const quiet = now - this.lastLineAt;
      if (quiet > t && this._status.state === 'live') {
        this.setStatus({
          state: 'lost',
          detail: `Connection lost: no heartbeat from ${path} for ${Math.round(quiet / 1000)} s (board hung, brown-out, or cable fault).`,
          paj: 'unknown',
        });
      }
      if (quiet > 3 * t) void this.reopen();
    }, 500);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private async reopen(): Promise<void> {
    await this.closePort();
    this.scheduleRetry();
  }

  private closePort(): Promise<void> {
    this.stopWatchdog();
    const port = this.port;
    this.port = null;
    if (!port || !port.isOpen) return Promise.resolve();
    return new Promise((res) => port.close(() => res()));
  }
}
