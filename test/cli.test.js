// @ts-check
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { parseArgs, run } from '../src/cli.js';
import { DEVICE_GRANT } from '../src/oauth.js';

const ISSUER = 'https://login.test';
const GATEWAY = 'https://mcp.test/mcp';

/**
 * A fake login and gateway, answering like the real ones (RFC 8414, RFC 8628, MCP over HTTP).
 * `script` decides how the person reacts on the approval page.
 */
function fakeServers(
  /** @type {{ polls?: string[], toolText?: Record<string, string>, sse?: boolean }} */ script = {},
) {
  const polls = [...(script.polls ?? ['authorization_pending', 'ok'])];
  /** @type {{ url: string, body: string, auth: string | null }[]} */
  const calls = [];
  let issued = 0;

  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';
    const headers = new Headers(init.headers);
    calls.push({ url, body, auth: headers.get('authorization') });
    const json = (/** @type {unknown} */ value, status = 200, extra = {}) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json', ...extra },
      });

    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return json({
        issuer: ISSUER,
        token_endpoint: `${ISSUER}/oauth/token`,
        device_authorization_endpoint: `${ISSUER}/oauth/device_authorization`,
        revocation_endpoint: `${ISSUER}/oauth/revoke`,
      });
    }
    if (url === `${ISSUER}/oauth/device_authorization`) {
      const form = new URLSearchParams(body);
      assert.equal(form.get('resource'), GATEWAY);
      return json({
        device_code: 'device-code-1',
        user_code: 'BCDF-GHJK',
        verification_uri: `${ISSUER}/device`,
        verification_uri_complete: `${ISSUER}/device?user_code=BCDF-GHJK`,
        expires_in: 600,
        interval: 5,
      });
    }
    if (url === `${ISSUER}/oauth/token`) {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === DEVICE_GRANT) {
        const next = polls.shift() ?? 'ok';
        if (next !== 'ok') return json({ error: next }, 400);
      } else if (form.get('grant_type') === 'refresh_token') {
        if (form.get('refresh_token') !== `refresh-${issued}`)
          return json({ error: 'invalid_grant' }, 400);
      }
      issued++;
      return json({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'mcp:tools.read mcp:promptshare.read',
      });
    }
    if (url === `${ISSUER}/oauth/revoke`) return new Response(null, { status: 200 });
    if (url === GATEWAY) {
      if (!headers.get('authorization')?.startsWith('Bearer access-')) {
        return new Response(null, {
          status: 401,
          headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
        });
      }
      const message = JSON.parse(body);
      /** @type {unknown} */
      let result;
      if (message.method === 'tools/list') {
        result = { tools: [{ name: 'whoami', description: 'Shows who. More.' }] };
      } else {
        const name = message.params.name;
        const text = script.toolText?.[name];
        result =
          text === undefined
            ? { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
            : { content: [{ type: 'text', text }] };
      }
      const answer = { jsonrpc: '2.0', id: message.id, result };
      if (script.sse) {
        return new Response(`event: message\ndata: ${JSON.stringify(answer)}\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return json(answer);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

/** @type {string} */
let dir;
/** @type {{ out: string[], err: string[] }} */
let output;
let clock = 1_800_000_000;

/**
 * @param {string[]} argv
 * @param {ReturnType<typeof fakeServers>} servers
 * @param {string} [stdin]
 */
function cli(argv, servers, stdin = '') {
  return run(argv, {
    env: {
      TWOEARL_ISSUER: ISSUER,
      TWOEARL_GATEWAY: GATEWAY,
      TWOEARL_CREDENTIALS: join(dir, 'credentials.json'),
    },
    out: (t) => output.out.push(t),
    err: (t) => output.err.push(t),
    readStdin: async () => stdin,
    fetchImpl: servers.fetchImpl,
    sleep: async (ms) => {
      clock += ms / 1000;
    },
    now: () => Math.floor(clock),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), '2earl-cli-'));
  output = { out: [], err: [] };
});

describe('2earl login', () => {
  it('shows the code, waits for approval, and keeps the tokens readable by this user only', async () => {
    const servers = fakeServers({ polls: ['authorization_pending', 'slow_down', 'ok'] });
    assert.equal(await cli(['login'], servers), 0);
    const shown = output.err.join('\n');
    assert.match(shown, /Open {3}https:\/\/login\.test\/device/);
    assert.match(shown, /Code {3}BCDF-GHJK/);
    assert.match(shown, /Signed in\./);

    const file = join(dir, 'credentials.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.accessToken, 'access-1');
    assert.equal(saved.resource, GATEWAY);
    assert.equal(saved.clientId, 'https://2earl.com/cli/client.json');
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);

    const polls = servers.calls.filter((c) => c.body.includes('device_code=')).length;
    assert.equal(polls, 3);
  });

  it('says so when the person refuses, or the code expires', async () => {
    assert.equal(await cli(['login'], fakeServers({ polls: ['access_denied'] })), 1);
    assert.match(output.err.join('\n'), /refused/);
    output = { out: [], err: [] };
    assert.equal(await cli(['login'], fakeServers({ polls: ['expired_token'] })), 1);
    assert.match(output.err.join('\n'), /expired/);
  });
});

describe('using Prompt share', () => {
  /** @param {Record<string, string>} toolText @param {boolean} [sse] */
  async function signedIn(toolText, sse = false) {
    const servers = fakeServers({ toolText, sse });
    await cli(['login'], servers);
    output = { out: [], err: [] };
    return servers;
  }

  it('whoami shows the account, the app and the permissions', async () => {
    const servers = await signedIn({
      whoami: JSON.stringify({
        account: 'u-1',
        app: 'https://2earl.com/cli/client.json',
        permissions: ['mcp:tools.read'],
      }),
    });
    assert.equal(await cli(['whoami'], servers), 0);
    assert.match(output.out[0] ?? '', /Account {6}u-1/);
    assert.match(output.out[0] ?? '', /Permissions {2}mcp:tools\.read/);
    const call = servers.calls.find((c) => c.url === GATEWAY);
    assert.equal(call?.auth, 'Bearer access-1');
  });

  it('reads answers sent as an event stream too', async () => {
    const servers = await signedIn({ whoami: '{"account":"u-2"}' }, true);
    assert.equal(await cli(['whoami', '--json'], servers), 0);
    assert.equal(output.out[0], '{"account":"u-2"}');
  });

  it('searches, gets with variables, and saves from standard input', async () => {
    const servers = await signedIn({
      promptshare__search_prompts: JSON.stringify([
        { id: 'p1', title: 'Email reply' },
        { id: 'p22', title: 'Code review' },
      ]),
      promptshare__get_prompt: JSON.stringify({ id: 'p1', body: 'Reply kindly about {{topic}}' }),
      promptshare__save_prompt: JSON.stringify({ id: 'p3' }),
    });
    assert.equal(await cli(['prompts', 'search', 'email', '--scope', 'mine'], servers), 0);
    assert.equal(output.out[0], 'p1   Email reply\np22  Code review');
    const search = servers.calls.findLast((c) => c.url === GATEWAY);
    assert.deepEqual(JSON.parse(search?.body ?? '{}').params.arguments, {
      query: 'email',
      scope: 'mine',
    });

    assert.equal(await cli(['prompts', 'get', 'p1', '--fill', 'topic=invoices'], servers), 0);
    assert.equal(output.out[1], 'Reply kindly about {{topic}}');
    const get = servers.calls.findLast((c) => c.url === GATEWAY);
    assert.deepEqual(JSON.parse(get?.body ?? '{}').params.arguments, {
      id: 'p1',
      fill: { topic: 'invoices' },
    });

    assert.equal(await cli(['prompts', 'save', '--title', 'New'], servers, 'Body text'), 0);
    assert.equal(output.out[2], 'Saved: p3');
  });

  it('shows a tool’s own error, and tells you to sign in when the token is refused', async () => {
    const servers = await signedIn({});
    assert.equal(await cli(['call', 'nope'], servers), 1);
    assert.match(output.err[0] ?? '', /Unknown tool: nope/);

    const file = join(dir, 'credentials.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    await (
      await import('node:fs/promises')
    ).writeFile(file, JSON.stringify({ ...saved, accessToken: 'stolen', expiresAt: clock + 3600 }));
    assert.equal(await cli(['whoami'], servers), 1);
    assert.match(output.err[1] ?? '', /Run `2earl login`/);
  });
});

describe('staying signed in, and signing out', () => {
  it('refreshes an expired access token and keeps the rotated refresh token', async () => {
    const servers = fakeServers({ toolText: { whoami: '{"account":"u"}' } });
    await cli(['login'], servers);
    clock += 7200;
    assert.equal(await cli(['whoami'], servers), 0);
    const saved = JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'));
    assert.equal(saved.accessToken, 'access-2');
    assert.equal(saved.refreshToken, 'refresh-2');
  });

  it('logout revokes the refresh token and forgets the sign-in', async () => {
    const servers = fakeServers();
    await cli(['login'], servers);
    assert.equal(await cli(['logout'], servers), 0);
    const revoked = servers.calls.find((c) => c.url === `${ISSUER}/oauth/revoke`);
    assert.match(revoked?.body ?? '', /token=refresh-1/);
    await assert.rejects(stat(join(dir, 'credentials.json')));
    assert.equal(await cli(['whoami'], servers), 2);
    assert.match(output.err.at(-1) ?? '', /Not signed in/);
  });
});

describe('the command line', () => {
  it('reads options, repeated options and flags', () => {
    assert.deepEqual(parseArgs(['prompts', 'get', 'p1', '--fill', 'a=1', '--fill=b=2', '--json']), {
      positional: ['prompts', 'get', 'p1'],
      options: { fill: ['a=1', 'b=2'], json: ['true'] },
    });
  });

  it('prints help, and a usage error for unknown commands', async () => {
    assert.equal(await cli(['--help'], fakeServers()), 0);
    assert.match(output.out[0] ?? '', /2earl login/);
    assert.equal(await cli(['frobnicate'], fakeServers()), 2);
    assert.match(output.err[0] ?? '', /Unknown command/);
  });
});
