/** Writes schema/<Name>.json (JSON Schema 2020-12) for every exported contract. */
import { mkdirSync, writeFileSync } from 'node:fs';
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

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  const doc = {
    $id: `offhand/${name}.json`,
    title: name,
    'x-contracts-version': CONTRACTS_VERSION,
    ...json,
  };
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(doc, null, 2) + '\n');
  console.log(`wrote schema/${name}.json`);
}
