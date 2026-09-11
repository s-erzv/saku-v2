/** Registers the `@/` resolver for `node --test`. See `scripts/test-alias-hooks.mjs`. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

register(pathToFileURL(path.join(import.meta.dirname, 'test-alias-hooks.mjs')).href);
