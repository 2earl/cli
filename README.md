# 2earl CLI

Your 2earl account and [Prompt share](https://promptshare.cc) from the terminal.

```sh
npx github:2earl/cli login
```

Node.js 20 or newer. No dependencies at run time.

## Sign in

```sh
2earl login
```

```
  Open   https://login.2earl.com/device
  Code   BCDF-GHJK

  Waiting for you to approve…
```

Open the address on any device where you can sign in to 2earl, check that the code matches, and
approve. The approval page shows what the CLI may do; untick anything you don't want to allow.
The CLI never sees your Google account, your email codes or your passkeys.

This is the OAuth device authorization grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)).
**Only approve a code you started yourself.** 2earl never asks you for this code by email, chat or
phone.

## Commands

| Command                                                            | What it does                                    |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| `2earl login`                                                      | Sign in                                         |
| `2earl logout`                                                     | Sign out here and revoke this device's access   |
| `2earl whoami`                                                     | The account, the app, and what it may do        |
| `2earl prompts search [words] [--scope mine\|shared\|public\|all]` | Find prompts                                    |
| `2earl prompts get <id> [--fill name=value …]`                     | Print a prompt, with its `{{variables}}` filled |
| `2earl prompts save --title <title> [--file <path>]`               | Save a prompt from a file or standard input     |
| `2earl sessions list`                                              | Your shared sessions                            |
| `2earl sessions load <id or title> [--since brief]`                | Read a session: brief, open tasks, entries      |
| `2earl sessions note <id or title> <text> [--kind …]`              | Add an entry to a session                       |
| `2earl tools`                                                      | Every tool the gateway offers you               |
| `2earl call <tool> [json]`                                         | Call any tool with JSON arguments               |

Add `--json` to print the gateway's answer unchanged, for scripts:

```sh
2earl prompts get p_123 --fill topic=invoices | pbcopy
echo "Summarise the meeting" | 2earl prompts save --title "Meeting summary"
2earl call promptshare__search_prompts '{"query":"review","scope":"mine"}' --json | jq .
```

## How it works

- **Sign-in.** The CLI is a public OAuth client. Its client ID is a
  [client metadata document](https://2earl.com/cli/client.json) on 2earl.com, which tells
  login.2earl.com its name and its only redirect address. It has no secret.
- **Tokens.** The access token is bound to one resource, the MCP gateway at
  `https://mcp.2earl.com/mcp` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)), so it is
  useless anywhere else. It is refreshed automatically; refresh tokens rotate.
- **Storage.** `~/.config/2earl/credentials.json` (on Windows `%APPDATA%\2earl\`), readable by
  you only (mode 600). `2earl logout` revokes the refresh token
  ([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009)) and deletes the file. You can also
  disconnect the CLI in your account at login.2earl.com.
- **Calls.** Each command is one MCP JSON-RPC request to the gateway (Streamable HTTP, protocol
  `2026-07-28`). Answers come as JSON or as an event stream; both are read.

For testing against another deployment: `TWOEARL_ISSUER`, `TWOEARL_GATEWAY`, `TWOEARL_CLIENT_ID`,
`TWOEARL_SCOPE`, `TWOEARL_CREDENTIALS`.

## Development

```sh
npm install
npm test          # node:test, against a fake login and gateway
npm run typecheck # tsc over JSDoc types
npm run lint      # prettier
```

## License

[AGPL-3.0](LICENSE), like the rest of 2earl.
