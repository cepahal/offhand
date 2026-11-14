import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { CONTRACTS_VERSION, type BusEnvelope } from '@hoverscan/contracts';
import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import { Bus } from './bus/bus.js';
import { loadConfig, RUN_MODE } from './config.js';
import { liveStartupGate } from './live/startup.js';
import { createLogger, SessionLog } from './log/logger.js';
import { createModules } from './modules.js';

if (RUN_MODE === 'live') await liveStartupGate();
const cfg = loadConfig();
const log = createLogger();
for (const d of [cfg.casepackDir, cfg.logDir, cfg.snapshotDir]) mkdirSync(d, { recursive: true });

const session = new SessionLog(cfg.logDir);
const bus = new Bus(session);
const modules = createModules({ cfg, bus, log });
const startedAt = Date.now();

const app = Fastify({
  loggerInstance: log.child({ module: 'http' }) as FastifyBaseLogger,
  logController: new LogController({ disableRequestLogging: true }),
  bodyLimit: 20 * 1024 * 1024,
});
await app.register(fastifyWebsocket);

// ---- health -------------------------------------------------------------------------------
app.get('/api/health', async () => ({
  ok: true,
  contractsVersion: CONTRACTS_VERSION,
  uptimeS: Math.round((Date.now() - startedAt) / 1000),
  session: session.path,
  modules: Object.fromEntries(modules.map((m) => [m.name, m.health()])),
}));

// ---- voice action (OpenAI function call; the browser validates the shape again) ------------
app.post<{ Body: { transcript?: string; patients?: { name: string; mrn: string }[] } }>('/api/voice/action', async (req) => {
  const transcript = req.body?.transcript?.trim() ?? '';
  const people = Array.isArray(req.body?.patients) ? req.body.patients : [];
  const key = process.env.OPENAI_API_KEY;
  if (!key || !transcript) return { action: 'ask', question: 'OpenAI is not configured. Nothing was changed.' };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Patients: ${people.map((p) => `${p.name} MRN ${p.mrn}`).join('; ')}. Use the scanner_action tool. Dental commands: show_patient, change_prescription (value is the medication), add_note (text), message_patient (text), message_hospital (text), view_scans. If the medication or the command is unclear, action ask. Do not invent an action outside the enum.` },
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
                action: { enum: ['change_medication', 'view_history', 'view_mri', 'add_note', 'send_instructions', 'show_patient', 'change_prescription', 'message_patient', 'message_hospital', 'view_scans', 'ask'] },
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
    }),
  });
  if (!response.ok) return { action: 'ask', question: 'The model did not answer. Nothing was changed.' };
  const body = (await response.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: { function?: { arguments?: string } }[] } }[];
  };
  const message = body.choices?.[0]?.message;
  const args = message?.tool_calls?.[0]?.function?.arguments;
  if (args) {
    try {
      return JSON.parse(args) as unknown;
    } catch {
      return { content: args };
    }
  }
  if (message?.content) return { content: message.content };
  return { action: 'ask', question: 'The model returned no action. Nothing was changed.' };
});

// ---- snapshots (capture command) ----------------------------------------------------------
app.post<{ Body: { requestId?: string; dataUrl?: string } }>('/api/snapshots', async (req, reply) => {
  const { requestId, dataUrl } = req.body ?? {};
  const m = typeof dataUrl === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m?.[1]) return reply.code(400).send({ error: 'dataUrl must be a base64 PNG data URL' });
  const safeId = (requestId ?? randomUUID()).replace(/[^\w-]/g, '').slice(0, 64) || randomUUID();
  const file = `${Date.now()}-${safeId}.png`;
  writeFileSync(join(cfg.snapshotDir, file), Buffer.from(m[1], 'base64'));
  const url = `/snapshots/${file}`;
  bus.publish({ ch: 'log', level: 'info', module: 'snapshots', msg: 'snapshot saved', data: { requestId: safeId, url } }, 'http');
  return { url };
});
await app.register(fastifyStatic, { root: cfg.snapshotDir, prefix: '/snapshots/', decorateReply: false, index: false });

// ---- modules ------------------------------------------------------------------------------
for (const m of modules) await m.registerRoutes?.(app);

// ---- WebSocket bus ------------------------------------------------------------------------
const clients = new Map<string, WebSocket>();

/** Clients render these as facts, so they are forwarded only from the module that owns them. */
const OWNER: Partial<Record<BusEnvelope['ch'], string>> = { verified: 'ai', share: 'messaging' };

bus.subscribe((env: BusEnvelope, origin: string) => {
  const owner = OWNER[env.ch];
  if (owner && origin !== owner) return;
  const text = JSON.stringify(env);
  for (const [id, ws] of clients) {
    // The viewer that produced a state does not need it echoed back.
    if (env.ch === 'state' && origin === `ws:${id}`) continue;
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
});

app.get('/ws', { websocket: true }, (socket) => {
  const id = randomUUID().slice(0, 8);
  clients.set(id, socket);
  log.info(`ws: client ${id} connected (${clients.size} total)`);
  const latest = bus.latestState;
  if (latest) socket.send(JSON.stringify({ ch: 'state', state: latest }));

  socket.on('message', (data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      socket.send(JSON.stringify({ ch: 'log', level: 'warn', module: 'bus', msg: 'message is not JSON' }));
      return;
    }
    for (const m of modules) if (m.onClientMessage?.(raw, id)) return;
    const r = bus.publish(raw, `ws:${id}`);
    if (!r.ok) {
      log.warn({ err: r.error }, `ws: rejected message from ${id}`);
      socket.send(JSON.stringify({ ch: 'log', level: 'warn', module: 'bus', msg: `rejected: ${r.error}` }));
    }
  });
  socket.on('close', () => {
    clients.delete(id);
    log.info(`ws: client ${id} disconnected (${clients.size} left)`);
  });
});

// ---- built viewer (production); in dev Vite serves the viewer and proxies /api + /ws -------
if (existsSync(cfg.webDist)) {
  await app.register(fastifyStatic, { root: cfg.webDist, prefix: '/', decorateReply: false });
  const indexHtml = readFileSync(join(cfg.webDist, 'index.html'));
  app.get('/debug', async (_req, reply) => reply.type('text/html; charset=utf-8').send(indexHtml));
}

// ---- start / stop -------------------------------------------------------------------------
for (const m of modules) {
  try {
    await m.start();
  } catch (e) {
    log.error({ err: e }, `module ${m.name} failed to start`);
  }
}
await app.listen({ port: cfg.port, host: cfg.bind });
log.info(`hoverscan hub (${RUN_MODE ?? 'per-module modes'}) on http://${cfg.bind}:${cfg.port}  (session log: ${session.path})`);

let stopping = false;
const shutdown = async (sig: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  log.info(`${sig}: shutting down`);
  for (const m of [...modules].reverse()) await m.stop?.();
  for (const ws of clients.values()) ws.close();
  await app.close();
  await session.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
