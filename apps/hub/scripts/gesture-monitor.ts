/**
 * Host-side serial monitor for the gesture board. Shows exactly what the hub would see:
 * link status (no ESP32 / busy / silent / lost / recovered), the firmware's "#" test lines,
 * contract events, and the ViewerCommands the mapper would produce.
 *
 *   pnpm gesture:monitor                 auto-detect the ESP32
 *   pnpm gesture:monitor --port COM5     use a specific port
 *   pnpm gesture:monitor --list          list serial ports and exit
 *   pnpm gesture:monitor --raw           also print hover events and ignored lines
 *
 * Close the Arduino IDE Serial Monitor first: only one program can hold the port.
 */
import { SerialPort } from 'serialport';
import { loadConfig } from '../src/config.js';
import { describePorts, GestureLink, KNOWN_BRIDGES, type LinkStatus } from '../src/gesture/link.js';
import { GestureMapper } from '../src/gesture/mapper.js';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const color = process.stdout.isTTY;
const c = (code: number, s: string): string => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const ts = (): string => new Date().toISOString().slice(11, 23);
const out = (tag: string, msg: string): void => console.log(`${c(90, ts())} ${tag} ${msg}`);

if (flag('list')) {
  const ports = await SerialPort.list();
  console.log(ports.length ? 'Serial ports:' : 'No serial ports found.');
  for (const p of ports) {
    const vid = p.vendorId?.toLowerCase();
    const known = vid ? KNOWN_BRIDGES[vid] : undefined;
    console.log(`  ${p.path.padEnd(14)} ${known ? c(32, known) : (p.manufacturer ?? 'unknown')}  ${vid ?? '----'}:${p.productId ?? '----'}`);
  }
  process.exit(0);
}

const base = loadConfig().gesture;
const port = opt('port');
const baud = opt('baud');
const cfg = { ...base, port: port ?? base.port, baud: baud ? Number(baud) : base.baud };
const raw = flag('raw');

const link = new GestureLink(cfg);
const mapper = new GestureMapper('gesture', { debounceMs: cfg.debounceMs });

const STATUS_COLOR: Record<LinkStatus['state'], number> = {
  off: 90,
  searching: 36,
  no_device: 33,
  connecting: 36,
  live: 32,
  silent: 33,
  lost: 31,
  error: 31,
};

link.on('status', (s) => out(c(STATUS_COLOR[s.state], `[link:${s.state.toUpperCase()}]`), s.detail));
link.on('comment', (text) => out(c(35, '[fw]'), text));
link.on('invalid', ({ line, error }) => {
  if (raw) out(c(90, '[ignored]'), `${error}: ${line}`);
});
link.on('event', (ev) => {
  const now = Date.now();
  if (ev.t === 'h') {
    if (raw) out(c(90, '[hover]'), `x=${ev.x.toFixed(2)} y=${ev.y.toFixed(2)} z=${ev.z.toFixed(2)}`);
  } else if (ev.t === 'g') {
    out(c(96, '[gesture]'), `${ev.g.toUpperCase()}  seq=${ev.seq} ms=${ev.ms}`);
  } else if (ev.t === 'hb') {
    out(c(90, '[heartbeat]'), `fw=${ev.fw} paj=${ev.paj ?? '?'} uptime=${Math.round(ev.ms / 1000)}s`);
  } else {
    out(c(31, '[board-error]'), ev.msg);
  }
  for (const cmd of mapper.handle(ev, now)) out(c(94, '  -> cmd'), describeCmd(cmd));
});

setInterval(() => {
  for (const cmd of mapper.tick(Date.now())) out(c(94, '  -> cmd'), describeCmd(cmd));
}, 50);

function describeCmd(cmd: { type: string } & Record<string, unknown>): string {
  const { id: _id, ts: _ts, source: _src, type, ...rest } = cmd;
  return `${type} ${JSON.stringify(rest)}`;
}

console.log(`offhand gesture monitor - port=${cfg.port} baud=${cfg.baud}. Ctrl+C to quit.`);
if (cfg.port === 'auto') {
  const ports = await SerialPort.list().catch(() => []);
  out(c(36, '[ports]'), describePorts(ports));
}
link.start();

process.on('SIGINT', async () => {
  await link.stop();
  process.exit(0);
});
