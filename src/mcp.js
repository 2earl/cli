// @ts-check
/**
 * A minimal MCP client for the 2earl gateway: JSON-RPC over Streamable HTTP, one request per call.
 * The gateway is stateless (MCP 2026-07-28), so there is no session to set up; answers come as
 * JSON or as a short event stream, and both are read here.
 *
 * Revision 2026-07-28 (SEP-2243) asks every request to carry:
 * - an envelope in `params._meta`: the protocol version and the client's capabilities;
 * - the headers `MCP-Protocol-Version` and `Mcp-Method`, and for `tools/call` also `Mcp-Name`
 *   (the tool's name), which servers check against the body.
 */

export const PROTOCOL_VERSION = '2026-07-28';
export const CLIENT_INFO = { name: '2earl-cli', version: '0.1.1' };

/** Methods whose `Mcp-Name` header mirrors a field of `params`. */
const NAME_FIELD = /** @type {Record<string, string>} */ ({
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
});

/**
 * A header value as the spec encodes it: printable ASCII as is, anything else (or leading and
 * trailing spaces) as `=?base64?…?=` of its UTF-8.
 * @param {string} value
 */
export function headerValue(value) {
  const plain = value.length > 0 && value === value.trim() && /^[\t\x20-\x7e]*$/.test(value);
  if (plain && !(value.startsWith('=?base64?') && value.endsWith('?='))) return value;
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export class McpError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, challenge?: string | null }} [extra]
   */
  constructor(message, extra = {}) {
    super(message);
    this.status = extra.status ?? 0;
    this.challenge = extra.challenge ?? null;
  }
}

let nextId = 1;

/**
 * Reads a JSON-RPC response from a JSON body or from `data:` lines of an event stream.
 * @param {Response} response
 * @returns {Promise<Record<string, unknown>>}
 */
async function readMessage(response) {
  const type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (type.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      const message = /** @type {Record<string, unknown>} */ (JSON.parse(data));
      if ('result' in message || 'error' in message) return message;
    }
    throw new McpError('The gateway sent no answer');
  }
  return /** @type {Record<string, unknown>} */ (JSON.parse(text));
}

/**
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.accessToken
 * @param {string} params.method
 * @param {Record<string, unknown>} [params.params]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<unknown>}
 */
export async function rpc({ url, accessToken, method, params = {}, fetchImpl = fetch }) {
  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'Mcp-Method': method,
  };
  const nameField = NAME_FIELD[method];
  const name = nameField ? params[nameField] : undefined;
  if (typeof name === 'string') headers['Mcp-Name'] = headerValue(name);
  const body = {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
      },
    },
  };
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (response.status === 401 || response.status === 403) {
    throw new McpError(
      response.status === 401 ? 'Not signed in, or the sign-in expired' : 'Not allowed',
      { status: response.status, challenge: response.headers.get('www-authenticate') },
    );
  }
  if (response.status === 429)
    throw new McpError('Too many requests. Wait a minute.', { status: 429 });
  if (!response.ok) {
    // The gateway explains a refused request in a JSON-RPC error: show that, not just the status.
    const explained = await readMessage(response).catch(() => null);
    const error = /** @type {{ message?: unknown } | undefined} */ (explained?.error);
    throw new McpError(
      typeof error?.message === 'string'
        ? `The gateway refused the request: ${error.message}`
        : `The gateway answered HTTP ${response.status}`,
      { status: response.status },
    );
  }
  const message = await readMessage(response);
  if (message.error && typeof message.error === 'object') {
    const error = /** @type {{ message?: unknown }} */ (message.error);
    throw new McpError(typeof error.message === 'string' ? error.message : 'MCP error');
  }
  return message.result;
}

/**
 * @typedef {object} ToolResult
 * @property {{ type: string, text?: string }[]} content
 * @property {boolean} [isError]
 * @property {unknown} [structuredContent]
 */

/**
 * Calls a tool and returns its text, or throws the tool's own error message.
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.accessToken
 * @param {string} params.name
 * @param {Record<string, unknown>} [params.args]
 * @param {typeof fetch} [params.fetchImpl]
 */
export async function callTool({ url, accessToken, name, args = {}, fetchImpl = fetch }) {
  const result = /** @type {ToolResult} */ (
    await rpc({
      url,
      accessToken,
      method: 'tools/call',
      params: { name, arguments: args },
      fetchImpl,
    })
  );
  const text = (result.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
  if (result.isError) throw new McpError(text || `${name} failed`);
  return { text, structured: result.structuredContent };
}

/**
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.accessToken
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{ name: string, description?: string }[]>}
 */
export async function listTools({ url, accessToken, fetchImpl = fetch }) {
  const result = /** @type {{ tools?: { name: string, description?: string }[] }} */ (
    await rpc({ url, accessToken, method: 'tools/list', fetchImpl })
  );
  return result.tools ?? [];
}
