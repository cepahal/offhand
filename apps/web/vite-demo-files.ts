/**
 * Serves NeuroView volumes and scanner notes from this machine so the demo
 * works while the hub is not running. Paths that contain ".." are rejected.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { appendNote, readNotes } from './src/demo/scan-notes-file.js';
import type { ScanNote } from './src/demo/scan-notes.js';
import type { NeuroIndex } from './src/demo/scanner-commands.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const casepackRoot = join(repoRoot, 'casepacks');
const notesDir = join(repoRoot, 'data', 'notes');

const CATEGORIES = new Set(['mark', 'note', 'possible lesion', 'possible defect', 'extraction required']);

export function neuroIndex(dir: string): NeuroIndex {
  if (!existsSync(dir)) return { cases: [] };
  const cases = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = join(dir, entry.name, 'manifest.json');
      if (!existsSync(manifestPath)) return null;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        caseId?: string;
        volumes?: { id?: string; sequence?: string; file?: string }[];
      };
      const volumes = (manifest.volumes ?? [])
        .filter((volume) => typeof volume.file === 'string' && volume.file.endsWith('.nii.gz') && !volume.file.includes('..'))
        .map((volume) => ({ name: volume.sequence || volume.id || 'MRI', file: volume.file as string }));
      if (volumes.length === 0) return null;
      return { caseId: manifest.caseId || entry.name, volumes };
    })
    .filter((item): item is NeuroIndex['cases'][number] => item !== null)
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
  return { cases };
}

function inside(root: string, file: string): boolean {
  const base = resolve(root);
  const target = resolve(file);
  return target === base || target.startsWith(base + sep);
}

function isNote(value: unknown): value is ScanNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as ScanNote;
  return (
    typeof note.text === 'string' &&
    note.text.length > 0 &&
    note.text.length <= 200 &&
    typeof note.category === 'string' &&
    CATEGORIES.has(note.category) &&
    typeof note.mrn === 'string' &&
    typeof note.scanName === 'string' &&
    note.scanName.length <= 200 &&
    typeof note.sliceIndex === 'number' &&
    Number.isFinite(note.sliceIndex) &&
    !!note.coordinates &&
    typeof note.coordinates.x === 'number' &&
    typeof note.coordinates.y === 'number' &&
    typeof note.coordinates.z === 'number' &&
    typeof note.at === 'string' &&
    note.at.length <= 40
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_000) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function demoFiles(): Plugin {
  return {
    name: 'hoverscan-demo-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void route(req, res).then((handled) => {
          if (!handled) next();
        }).catch(() => {
          if (!res.headersSent) sendJson(res, 400, { ok: false });
        });
      });
    },
  };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0] ?? '';
  if (url === '/casepacks/neuroview/index.json' && req.method === 'GET') {
    sendJson(res, 200, neuroIndex(join(casepackRoot, 'neuroview')));
    return true;
  }
  // Keep the standalone NeuroView demo usable without the hub. All other case packs,
  // including the dental candidates, must fall through to Vite's hub proxy.
  if (url.startsWith('/casepacks/neuroview/')) {
    const rel = decodeURIComponent(url.slice('/casepacks/'.length));
    if (rel.includes('..') || rel.includes('\\') || !rel.endsWith('.nii.gz')) {
      sendJson(res, 400, { ok: false });
      return true;
    }
    const file = resolve(casepackRoot, rel);
    if (!inside(casepackRoot, file) || !existsSync(file) || !statSync(file).isFile()) {
      sendJson(res, 404, { ok: false });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    createReadStream(file).pipe(res);
    return true;
  }
  if (url === '/demo-notes' && req.method === 'POST') {
    const parsed: unknown = JSON.parse(await readBody(req));
    if (!isNote(parsed)) {
      sendJson(res, 400, { ok: false });
      return true;
    }
    appendNote(notesDir, parsed);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'GET' && url.startsWith('/demo-notes/')) {
    const mrn = decodeURIComponent(url.slice('/demo-notes/'.length));
    if (!/^\d{3,12}$/.test(mrn)) {
      sendJson(res, 400, { ok: false });
      return true;
    }
    sendJson(res, 200, readNotes(notesDir, mrn));
    return true;
  }
  return false;
}
