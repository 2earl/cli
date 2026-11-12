#!/usr/bin/env node
// @ts-check
import { run } from '../src/cli.js';

/** Standard input as text, or empty when it's a terminal. */
async function readStdin() {
  if (process.stdin.isTTY) return '';
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  readStdin,
});
