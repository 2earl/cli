// @ts-check
import { readFile } from 'node:fs/promises';
import {
  deleteCredentials,
  loadCredentials,
  saveCredentials,
  settings as readSettings,
} from './config.js';
import { McpError, callTool, listTools } from './mcp.js';
import { OAuthError, deviceSignIn, refresh, revoke } from './oauth.js';

/**
 * The `2earl` command. Everything it needs from the outside comes in `io`, so tests can run it
 * against a fake login and gateway.
 */

export const VERSION = '0.1.1';

const HELP = `2earl ${VERSION}: your 2earl account and Prompt share from the terminal.

Usage
  2earl login                 Sign in: open the link shown, check the code, approve
  2earl logout                Sign out here and revoke this device's access
  2earl whoami                Who you are signed in as

  2earl prompts search [words] [--scope mine|shared|public|all]
  2earl prompts get <id> [--fill name=value ...]
  2earl prompts save --title <title> [--description <text>] [--file <path>]
                              The prompt's text comes from --file, or from standard input
  2earl sessions list
  2earl sessions load <id or title> [--since brief]
  2earl sessions note <id or title> <text> [--kind note|decision|question|task|summary]

  2earl tools                 Every tool the gateway offers you
  2earl call <tool> [json]    Call any tool with JSON arguments

Options
  --json                      Print what the gateway answered, unchanged
  -h, --help                  This help
  -v, --version               The version

Your sign-in is kept in ~/.config/2earl/credentials.json (readable by you only).
Source and issues: https://github.com/2earl/cli`;

/**
 * @typedef {object} IO
 * @property {NodeJS.ProcessEnv} env
 * @property {(text: string) => void} out
 * @property {(text: string) => void} err
 * @property {() => Promise<string>} readStdin
 * @property {typeof fetch} [fetchImpl]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [now]
 */

/** Command-line words: positionals, `--flag value` options, and repeatable ones. */
export function parseArgs(/** @type {string[]} */ argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string[]>} */
  const options = {};
  const booleans = new Set(['json', 'help', 'version']);
  const aliases = /** @type {Record<string, string>} */ ({ h: 'help', v: 'version' });
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] ?? '';
    const match = /^--?([a-z][a-z-]*)(?:=(.*))?$/.exec(word);
    if (!match || word === '-' || /^-\d/.test(word)) {
      positional.push(word);
      continue;
    }
    const name = aliases[match[1] ?? ''] ?? match[1] ?? '';
    let value = match[2];
    if (value === undefined) value = booleans.has(name) ? 'true' : (argv[++i] ?? '');
    (options[name] ??= []).push(value);
  }
  return { positional, options };
}

export class UsageError extends Error {}

/**
 * Runs one command; returns the exit code.
 * @param {string[]} argv
 * @param {IO} io
 */
export async function run(argv, io) {
  const { positional, options } = parseArgs(argv);
  const json = options.json !== undefined;
  const settings = readSettings(io.env);
  const fetchImpl = io.fetchImpl ?? fetch;
  const now = io.now ?? (() => Math.floor(Date.now() / 1000));
  const [command, sub, ...rest] = positional;

  if (options.version) {
    io.out(VERSION);
    return 0;
  }
  if (options.help || !command || command === 'help') {
    io.out(HELP);
    return command && command !== 'help' ? 1 : 0;
  }

  /** A valid access token, refreshed when it has (nearly) expired. */
  const accessToken = async () => {
    const credentials = await loadCredentials(settings.credentialsFile);
    if (!credentials || credentials.issuer !== settings.issuer) {
      throw new UsageError('Not signed in. Run `2earl login` first.');
    }
    if (credentials.expiresAt - now() > 60) return credentials.accessToken;
    if (!credentials.refreshToken) throw new UsageError('Your sign-in expired. Run `2earl login`.');
    try {
      const fresh = await refresh({
        issuer: settings.issuer,
        clientId: credentials.clientId,
        resource: credentials.resource,
        refreshToken: credentials.refreshToken,
        scope: credentials.scope,
        fetchImpl,
        now,
      });
      await saveCredentials(settings.credentialsFile, { ...credentials, ...fresh });
      return fresh.accessToken;
    } catch (error) {
      if (error instanceof OAuthError) {
        throw new UsageError('Your sign-in expired or was revoked. Run `2earl login`.');
      }
      throw error;
    }
  };

  /** @param {string} name @param {Record<string, unknown>} [args] */
  const tool = async (name, args = {}) =>
    callTool({ url: settings.gateway, accessToken: await accessToken(), name, args, fetchImpl });

  /** @param {string} text */
  const print = (text) => io.out(text);

  try {
    switch (command) {
      case 'login': {
        const tokens = await deviceSignIn({
          issuer: settings.issuer,
          clientId: settings.clientId,
          scope: options.scope?.[0] ?? settings.scope,
          resource: settings.gateway,
          fetchImpl,
          now,
          ...(io.sleep ? { sleep: io.sleep } : {}),
          show: (start) => {
            io.err(
              [
                '',
                `  Open   ${start.verification_uri}`,
                `  Code   ${start.user_code}`,
                '',
                start.verification_uri_complete
                  ? `  Or open ${start.verification_uri_complete} and check the code matches.`
                  : '',
                '  Waiting for you to approve…',
              ]
                .filter((line, index, all) => line !== '' || all[index - 1] !== '')
                .join('\n'),
            );
          },
        });
        await saveCredentials(settings.credentialsFile, {
          issuer: settings.issuer,
          clientId: settings.clientId,
          resource: settings.gateway,
          ...tokens,
        });
        io.err('Signed in.');
        return 0;
      }

      case 'logout': {
        const credentials = await loadCredentials(settings.credentialsFile);
        if (credentials?.refreshToken) {
          await revoke({
            issuer: credentials.issuer,
            clientId: credentials.clientId,
            token: credentials.refreshToken,
            fetchImpl,
          });
        }
        await deleteCredentials(settings.credentialsFile);
        io.err(credentials ? 'Signed out.' : 'You weren’t signed in.');
        return 0;
      }

      case 'whoami': {
        const { text } = await tool('whoami');
        print(json ? text : describeWhoami(text));
        return 0;
      }

      case 'tools': {
        const tools = await listTools({
          url: settings.gateway,
          accessToken: await accessToken(),
          fetchImpl,
        });
        print(
          json
            ? JSON.stringify(tools, null, 2)
            : tools
                .map((t) => `${t.name}${t.description ? `  ${firstSentence(t.description)}` : ''}`)
                .join('\n'),
        );
        return 0;
      }

      case 'call': {
        if (!sub) throw new UsageError('Usage: 2earl call <tool> [json arguments]');
        const args = rest[0] ? parseJsonArgs(rest[0]) : {};
        const { text } = await tool(sub, args);
        print(text);
        return 0;
      }

      case 'prompts': {
        if (sub === 'search') {
          const { text } = await tool('promptshare__search_prompts', {
            ...(rest.length ? { query: rest.join(' ') } : {}),
            scope: options.scope?.[0] ?? 'all',
          });
          print(json ? text : listing(text, ['id', 'title']));
          return 0;
        }
        if (sub === 'get') {
          const id = rest[0];
          if (!id) throw new UsageError('Usage: 2earl prompts get <id> [--fill name=value ...]');
          /** @type {Record<string, string>} */
          const fill = {};
          for (const pair of options.fill ?? []) {
            const eq = pair.indexOf('=');
            if (eq < 1) throw new UsageError(`--fill takes name=value, not "${pair}"`);
            fill[pair.slice(0, eq)] = pair.slice(eq + 1);
          }
          const { text } = await tool('promptshare__get_prompt', {
            id,
            ...(Object.keys(fill).length ? { fill } : {}),
          });
          print(json ? text : (field(text, 'body') ?? text));
          return 0;
        }
        if (sub === 'save') {
          const title = options.title?.[0];
          if (!title)
            throw new UsageError('Usage: 2earl prompts save --title <title> [--file <path>]');
          const body = options.file?.[0]
            ? await readFile(options.file[0], 'utf8')
            : await io.readStdin();
          if (!body.trim())
            throw new UsageError('The prompt is empty: pass --file, or pipe the text in.');
          const { text } = await tool('promptshare__save_prompt', {
            title,
            body,
            ...(options.description?.[0] ? { description: options.description[0] } : {}),
          });
          print(json ? text : `Saved: ${field(text, 'id') ?? 'done'}`);
          return 0;
        }
        throw new UsageError('Usage: 2earl prompts search|get|save …');
      }

      case 'sessions': {
        if (sub === 'list') {
          const { text } = await tool('promptshare__list_sessions');
          print(json ? text : listing(text, ['id', 'title']));
          return 0;
        }
        if (sub === 'load') {
          const id = rest.join(' ');
          if (!id) throw new UsageError('Usage: 2earl sessions load <id or title>');
          const { text } = await tool('promptshare__load_session', {
            id,
            ...(options.since?.[0] ? { since: options.since[0] } : {}),
          });
          print(text);
          return 0;
        }
        if (sub === 'note') {
          const [id, ...words] = rest;
          if (!id || words.length === 0) {
            throw new UsageError('Usage: 2earl sessions note <id or title> <text> [--kind note]');
          }
          const { text } = await tool('promptshare__save_to_session', {
            id,
            text: words.join(' '),
            kind: options.kind?.[0] ?? 'note',
          });
          print(json ? text : 'Saved to the session.');
          return 0;
        }
        throw new UsageError('Usage: 2earl sessions list|load|note …');
      }

      default:
        throw new UsageError(`Unknown command "${command}". Run \`2earl --help\`.`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      return 2;
    }
    if (error instanceof OAuthError) {
      io.err(signInMessage(error.code));
      return 1;
    }
    if (error instanceof McpError) {
      io.err(
        error.status === 401
          ? 'Your sign-in expired or was revoked. Run `2earl login`.'
          : error.message,
      );
      return 1;
    }
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** @param {string} code */
function signInMessage(code) {
  switch (code) {
    case 'access_denied':
      return 'Sign-in was refused on the approval page.';
    case 'expired_token':
      return 'The code expired before it was approved. Run `2earl login` again.';
    case 'unauthorized_client':
    case 'invalid_client':
      return 'login.2earl.com doesn’t accept this version of the CLI. Update it.';
    default:
      return `Sign-in failed (${code}).`;
  }
}

/** @param {string} text */
function parseJsonArgs(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // reported below
  }
  throw new UsageError('Tool arguments must be a JSON object, e.g. \'{"query":"email"}\'');
}

/** @param {string} text */
function firstSentence(text) {
  const end = text.search(/\.\s/);
  return end > 0 ? text.slice(0, end + 1) : text;
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One field of a JSON tool answer, or null.
 * @param {string} text
 * @param {string} name
 */
function field(text, name) {
  const value = tryJson(text);
  if (value && typeof value === 'object' && name in value) {
    const found = /** @type {Record<string, unknown>} */ (value)[name];
    return typeof found === 'string' ? found : null;
  }
  return null;
}

/**
 * A list in a tool answer (an array, or the first array inside an object) as aligned lines.
 * @param {string} text
 * @param {string[]} columns
 */
function listing(text, columns) {
  const value = tryJson(text);
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value).find(Array.isArray)
      : undefined;
  if (!Array.isArray(rows)) return text;
  if (rows.length === 0) return 'Nothing yet.';
  const lines = rows.map((row) =>
    columns.map((c) => String(/** @type {Record<string, unknown>} */ (row)?.[c] ?? '')),
  );
  const width = Math.max(...lines.map((l) => (l[0] ?? '').length));
  return lines
    .map(([first = '', ...others]) => [first.padEnd(width), ...others].join('  '))
    .join('\n');
}

/** @param {string} text */
function describeWhoami(text) {
  const value = tryJson(text);
  if (!value || typeof value !== 'object') return text;
  const me = /** @type {{ account?: unknown, app?: unknown, permissions?: unknown }} */ (value);
  return [
    `Account      ${String(me.account ?? 'unknown')}`,
    `App          ${String(me.app ?? 'unknown')}`,
    `Permissions  ${Array.isArray(me.permissions) ? me.permissions.join(', ') : 'none'}`,
  ].join('\n');
}
