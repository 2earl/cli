// @ts-check
/**
 * Signing in with the device authorization grant (RFC 8628) against login.2earl.com, refreshing,
 * and signing out (RFC 7009). The CLI is a public client: no secret, and its tokens are bound to
 * one resource, the MCP gateway (RFC 8707).
 */

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export class OAuthError extends Error {
  /**
   * @param {string} code
   * @param {string} [description]
   */
  constructor(code, description) {
    super(description ? `${code}: ${description}` : code);
    this.code = code;
  }
}

/**
 * @param {string} url
 * @param {Record<string, string>} form
 * @param {typeof fetch} fetchImpl
 */
async function postForm(url, form, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form),
  });
  /** @type {Record<string, unknown>} */
  let body = {};
  try {
    body = /** @type {Record<string, unknown>} */ (await response.json());
  } catch {
    // A body that isn't JSON is reported by status below.
  }
  return { status: response.status, body };
}

/**
 * The server's endpoints, from its metadata (RFC 8414).
 * @param {string} issuer
 * @param {typeof fetch} fetchImpl
 */
export async function discover(issuer, fetchImpl = fetch) {
  const response = await fetchImpl(`${issuer}/.well-known/oauth-authorization-server`);
  if (!response.ok) throw new Error(`Can't read ${issuer}'s metadata (HTTP ${response.status})`);
  const meta = /** @type {Record<string, unknown>} */ (await response.json());
  const need = (/** @type {string} */ key) => {
    const value = meta[key];
    if (typeof value !== 'string') throw new Error(`${issuer} doesn't announce ${key}`);
    return value;
  };
  if (meta.issuer !== issuer)
    throw new Error(`Metadata names another issuer: ${String(meta.issuer)}`);
  return {
    deviceAuthorization: need('device_authorization_endpoint'),
    token: need('token_endpoint'),
    revocation: typeof meta.revocation_endpoint === 'string' ? meta.revocation_endpoint : null,
  };
}

/**
 * @typedef {object} DeviceStart
 * @property {string} device_code
 * @property {string} user_code
 * @property {string} verification_uri
 * @property {string} [verification_uri_complete]
 * @property {number} expires_in
 * @property {number} [interval]
 */

/**
 * @typedef {object} TokenSet
 * @property {string} accessToken
 * @property {string | null} refreshToken
 * @property {number} expiresAt
 * @property {string} scope
 */

/**
 * @param {Record<string, unknown>} body
 * @param {number} now
 * @param {string} fallbackScope
 * @returns {TokenSet}
 */
function tokenSet(body, now, fallbackScope) {
  if (typeof body.access_token !== 'string')
    throw new OAuthError('invalid_response', 'no access token');
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: now + (typeof body.expires_in === 'number' ? body.expires_in : 3600),
    scope: typeof body.scope === 'string' ? body.scope : fallbackScope,
  };
}

/**
 * Runs the whole device flow: asks for codes, shows them, and polls until the person approves,
 * refuses, or the request expires.
 *
 * @param {object} params
 * @param {string} params.issuer
 * @param {string} params.clientId
 * @param {string} params.scope
 * @param {string} params.resource
 * @param {(start: DeviceStart) => void} params.show  Tells the person where to go.
 * @param {typeof fetch} [params.fetchImpl]
 * @param {(ms: number) => Promise<void>} [params.sleep]
 * @param {() => number} [params.now]  Unix seconds.
 * @returns {Promise<TokenSet>}
 */
export async function deviceSignIn({
  issuer,
  clientId,
  scope,
  resource,
  show,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Math.floor(Date.now() / 1000),
}) {
  const endpoints = await discover(issuer, fetchImpl);
  const started = await postForm(
    endpoints.deviceAuthorization,
    { client_id: clientId, scope, resource },
    fetchImpl,
  );
  if (started.status !== 200) {
    throw new OAuthError(
      String(started.body.error ?? `http_${started.status}`),
      typeof started.body.error_description === 'string'
        ? started.body.error_description
        : undefined,
    );
  }
  const start = /** @type {DeviceStart} */ (/** @type {unknown} */ (started.body));
  show(start);

  let interval = Math.max(start.interval ?? 5, 1);
  const deadline = now() + start.expires_in;
  while (now() < deadline) {
    await sleep(interval * 1000);
    const polled = await postForm(
      endpoints.token,
      { grant_type: DEVICE_GRANT, device_code: start.device_code, client_id: clientId },
      fetchImpl,
    );
    if (polled.status === 200) return tokenSet(polled.body, now(), scope);
    const error = String(polled.body.error ?? `http_${polled.status}`);
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      interval += 5;
      continue;
    }
    throw new OAuthError(error);
  }
  throw new OAuthError('expired_token');
}

/**
 * @param {object} params
 * @param {string} params.issuer
 * @param {string} params.clientId
 * @param {string} params.resource
 * @param {string} params.refreshToken
 * @param {string} params.scope
 * @param {typeof fetch} [params.fetchImpl]
 * @param {() => number} [params.now]
 * @returns {Promise<TokenSet>}
 */
export async function refresh({
  issuer,
  clientId,
  resource,
  refreshToken,
  scope,
  fetchImpl = fetch,
  now = () => Math.floor(Date.now() / 1000),
}) {
  const endpoints = await discover(issuer, fetchImpl);
  const result = await postForm(
    endpoints.token,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource },
    fetchImpl,
  );
  if (result.status !== 200) throw new OAuthError(String(result.body.error ?? 'invalid_grant'));
  const set = tokenSet(result.body, now(), scope);
  // Refresh tokens rotate: keep the old one only if the server didn't send a new one.
  return { ...set, refreshToken: set.refreshToken ?? refreshToken };
}

/**
 * Revokes the refresh token, and with it the grant (RFC 7009). Best effort: signing out locally
 * happens either way.
 * @param {object} params
 * @param {string} params.issuer
 * @param {string} params.clientId
 * @param {string} params.token
 * @param {typeof fetch} [params.fetchImpl]
 */
export async function revoke({ issuer, clientId, token, fetchImpl = fetch }) {
  try {
    const endpoints = await discover(issuer, fetchImpl);
    if (!endpoints.revocation) return false;
    const result = await postForm(
      endpoints.revocation,
      { token, token_type_hint: 'refresh_token', client_id: clientId },
      fetchImpl,
    );
    return result.status === 200;
  } catch {
    return false;
  }
}
