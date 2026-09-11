/**
 * Teaches `node --test` the `@/` alias that `tsconfig.json` defines for the bundler.
 *
 * Node resolves bare specifiers against node_modules and has never heard of a path alias, so
 * without this every test that imports a module which itself imports `@/lib/...` fails at load.
 * The alternative the repo used before — copying the file and rewriting the import with sed, as
 * `scripts/verify-tx-policy.sh` does — tests a copy rather than the thing that ships.
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** TypeScript lets an import omit the extension; Node does not, so put it back. */
function withExtension(target) {
  if (path.extname(target)) return target;
  for (const candidate of [`${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return target;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = withExtension(path.join(root, specifier.slice(2)));
    return nextResolve(pathToFileURL(target).href, context);
  }
  return nextResolve(specifier, context);
}
