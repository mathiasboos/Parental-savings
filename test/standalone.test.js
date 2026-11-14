import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildStandalone, OUTPUT } from '../scripts/build-standalone.mjs';

test('lika-delat.html is built from the current sources (run "npm run build")', () => {
  assert.equal(fs.readFileSync(OUTPUT, 'utf8'), buildStandalone());
});

test('the standalone file loads nothing from outside itself', () => {
  const html = buildStandalone();
  assert.equal(/<link[^>]+href="(?!data:)/.test(html), false);
  assert.equal(/<script[^>]+src=/.test(html), false);
  assert.equal(/^import\b|^export\b/m.test(html), false);
});
