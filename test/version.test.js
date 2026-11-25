// @ts-check
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { VERSION } from '../src/version.js';
import { CLIENT_INFO } from '../src/mcp.js';

test('the version matches package.json and the changelog', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.equal(CLIENT_INFO.version, VERSION);
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, new RegExp(`^## ${VERSION.replaceAll('.', '\\.')} `, 'm'));
});
