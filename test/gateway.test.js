// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Server, createMcpHandler } from '@modelcontextprotocol/server';
import { callTool, headerValue, listTools } from '../src/mcp.js';

/**
 * The CLI's MCP requests against the real MCP server library, set up like the 2earl gateway
 * (2earl/mcp src/gateway.ts: `createMcpHandler` over a low-level `Server`, one per request). The
 * fake gateway in cli.test.js only checks the flow; this checks the wire format, which is where
 * revision 2026-07-28 is strict: the `_meta` envelope and the `Mcp-Method`/`Mcp-Name` headers.
 */

const URL = 'https://mcp.test/mcp';

function gateway() {
  const handler = createMcpHandler(() => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const server = new Server(
      { name: '2earl-mcp-gateway', version: 'test' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler('tools/list', async () => ({
      tools: [
        {
          name: 'whoami',
          description: 'Shows which account.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'promptshare__search_prompts',
          description: 'Searches prompts.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    }));
    server.setRequestHandler('tools/call', async (request) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tool: request.params.name, args: request.params.arguments ?? {} }),
        },
      ],
    }));
    return server;
  });
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => handler.fetch(new Request(String(input), init));
  return fetchImpl;
}

describe('the CLI against the real MCP server library (revision 2026-07-28)', () => {
  it('lists tools', async () => {
    const tools = await listTools({ url: URL, accessToken: 't', fetchImpl: gateway() });
    assert.deepEqual(
      tools.map((t) => t.name),
      ['whoami', 'promptshare__search_prompts'],
    );
  });

  it('calls a tool with arguments', async () => {
    const { text } = await callTool({
      url: URL,
      accessToken: 't',
      name: 'promptshare__search_prompts',
      args: { query: 'email' },
      fetchImpl: gateway(),
    });
    assert.deepEqual(JSON.parse(text), {
      tool: 'promptshare__search_prompts',
      args: { query: 'email' },
    });
  });

  it('calls a tool without arguments', async () => {
    const { text } = await callTool({
      url: URL,
      accessToken: 't',
      name: 'whoami',
      fetchImpl: gateway(),
    });
    assert.equal(JSON.parse(text).tool, 'whoami');
  });
});

describe('header values', () => {
  it('pass printable ASCII as is, and encode everything else', () => {
    assert.equal(headerValue('promptshare__get_prompt'), 'promptshare__get_prompt');
    assert.equal(headerValue('é'), `=?base64?${Buffer.from('é').toString('base64')}?=`);
    assert.equal(headerValue(' x'), `=?base64?${Buffer.from(' x').toString('base64')}?=`);
    assert.equal(headerValue(''), '=?base64??=');
  });
});
