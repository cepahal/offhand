/** Writes schema/<Name>.json (JSON Schema 2020-12) for every exported contract. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  BusEnvelope,
  CasePackManifest,
  CONTRACTS_VERSION,
  GestureEvent,
  ShareEvent,
  ShareRequest,
  VerifiedText,
  ViewerCommand,
  ViewerState,
} from '../src/index.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');
mkdirSync(outDir, { recursive: true });

const schemas: Record<string, z.ZodType> = {
  GestureEvent,
  ViewerCommand,
  ViewerState,
  CasePackManifest,
  VerifiedText,
  ShareRequest,
  ShareEvent,
  BusEnvelope,
};

const check = process.argv.includes('--check');
const stale: string[] = [];

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  const doc = {
    $id: `hoverscan/${name}.json`,
    title: name,
    'x-contracts-version': CONTRACTS_VERSION,
    ...json,
  };
  const file = join(outDir, `${name}.json`);
  const text = JSON.stringify(doc, null, 2) + '\n';
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) stale.push(`schema/${name}.json`);
    continue;
  }
  writeFileSync(file, text);
  console.log(`wrote schema/${name}.json`);
}

if (stale.length) {
  console.error(`Stale generated schemas: ${stale.join(', ')}. Run "pnpm gen:schema" and commit the result.`);
  process.exit(1);
}
if (check) console.log('schemas are up to date');
