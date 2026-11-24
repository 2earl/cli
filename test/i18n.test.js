// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { run } from '../src/cli.js';
import { localeFrom, translate, withLanguage } from '../src/i18n.js';

/**
 * Runs the CLI with a fake terminal and the given environment.
 * @param {string[]} argv
 * @param {Record<string, string>} env
 */
async function cli(argv, env) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = await run(argv, {
    env: { XDG_CONFIG_HOME: '/nonexistent', ...env },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    readStdin: async () => '',
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('languages', () => {
  it('takes the language from TWOEARL_LANG, then the locale variables', () => {
    assert.equal(localeFrom({ LANG: 'tr_TR.UTF-8' }), 'tr');
    assert.equal(localeFrom({ LC_ALL: 'tr_TR.UTF-8', LANG: 'en_US.UTF-8' }), 'tr');
    assert.equal(localeFrom({ TWOEARL_LANG: 'en', LANG: 'tr_TR.UTF-8' }), 'en');
    assert.equal(localeFrom({ LC_ALL: 'C', LANG: 'tr_TR.UTF-8' }), 'tr');
    assert.equal(localeFrom({}), 'en');
  });

  it('speaks Turkish when the terminal does', async () => {
    const help = await cli(['--help'], { LANG: 'tr_TR.UTF-8' });
    assert.match(help.out, /^Kullanım$/m);
    const unknown = await cli(['frobnicate'], { LANG: 'tr_TR.UTF-8' });
    assert.equal(unknown.code, 2);
    assert.equal(unknown.err, 'Bilinmeyen komut "frobnicate". `2earl --help` çalıştırın.');
    const english = await cli(['frobnicate'], { LANG: 'en_US.UTF-8' });
    assert.equal(english.err, 'Unknown command "frobnicate". Run `2earl --help`.');
  });

  it('leaves what it doesn’t know as it is, and opens login in the language', () => {
    assert.equal(translate('Some server message', 'tr'), 'Some server message');
    assert.equal(translate('Saved: abc', 'tr'), 'Kaydedildi: abc');
    assert.equal(translate('Saved: done', 'tr'), 'Kaydedildi: tamam');
    assert.equal(
      withLanguage('https://login.2earl.com/device?user_code=ABCD-EFGH', 'tr'),
      'https://login.2earl.com/device?user_code=ABCD-EFGH&lang=tr',
    );
    assert.equal(
      withLanguage('https://login.2earl.com/device', 'en'),
      'https://login.2earl.com/device',
    );
  });
});
