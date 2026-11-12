// @ts-check
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Where the CLI talks to, and where it keeps its sign-in.
 *
 * The client ID is a client metadata document (draft-ietf-oauth-client-id-metadata-document) on
 * 2earl.com: the CLI has no secret, and login learns its name and its one redirect URI (the device
 * callback) from that document.
 */
export const DEFAULTS = {
  issuer: 'https://login.2earl.com',
  gateway: 'https://mcp.2earl.com/mcp',
  clientId: 'https://2earl.com/cli/client.json',
  // Read and write prompts, and use shared sessions. The consent page lets the person untick any.
  scope: 'mcp:tools.read mcp:promptshare.read mcp:promptshare.write mcp:promptshare.state',
};

/**
 * @typedef {object} Settings
 * @property {string} issuer
 * @property {string} gateway
 * @property {string} clientId
 * @property {string} scope
 * @property {string} credentialsFile
 */

/**
 * Settings from the environment, for testing against another login or gateway.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Settings}
 */
export function settings(env = process.env) {
  return {
    issuer: env.TWOEARL_ISSUER ?? DEFAULTS.issuer,
    gateway: env.TWOEARL_GATEWAY ?? DEFAULTS.gateway,
    clientId: env.TWOEARL_CLIENT_ID ?? DEFAULTS.clientId,
    scope: env.TWOEARL_SCOPE ?? DEFAULTS.scope,
    credentialsFile: env.TWOEARL_CREDENTIALS ?? join(configDir(env), 'credentials.json'),
  };
}

/** @param {NodeJS.ProcessEnv} env */
function configDir(env) {
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, '2earl');
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), '2earl');
}

/**
 * @typedef {object} Credentials
 * @property {string} issuer
 * @property {string} clientId
 * @property {string} resource
 * @property {string} accessToken
 * @property {string | null} refreshToken
 * @property {number} expiresAt  Unix seconds.
 * @property {string} scope
 */

/**
 * @param {string} file
 * @returns {Promise<Credentials | null>}
 */
export async function loadCredentials(file) {
  try {
    return /** @type {Credentials} */ (JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Saved readable by this user only: the refresh token is a long-lived credential.
 * @param {string} file
 * @param {Credentials} credentials
 */
export async function saveCredentials(file, credentials) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined);
}

/** @param {string} file */
export async function deleteCredentials(file) {
  await rm(file, { force: true });
}
