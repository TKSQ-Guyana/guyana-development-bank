// Copies the authoritative spec (docs/openapi.yaml) into public/ so nginx and
// the vite dev server can serve it same-origin with /api — that is what lets
// Swagger UI's "Try it out" carry the Frappe sid cookie.
//
// The Docker build context is frontend/ only, so ../docs is absent there: the
// copy in public/ is committed and this script simply no-ops when the source
// is out of reach.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'docs', 'openapi.yaml');
const dest = join(here, '..', 'public', 'openapi.yaml');

if (!existsSync(src)) {
  console.log('sync-openapi: ../docs/openapi.yaml not present, keeping public/openapi.yaml');
  process.exit(0);
}
copyFileSync(src, dest);
console.log('sync-openapi: docs/openapi.yaml -> public/openapi.yaml');
