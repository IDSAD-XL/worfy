// The command line and the headings config shared by check-handoff.mjs and check-lessons.mjs.
//
// Both take `[--headings <file>] [<one argument>]`. The config is scripts/doc-headings.json unless
// --headings names another file: data in the language of the repository's documents, so neither
// script names a section or a word itself. Whatever cannot be used — a bad command line, a file that
// cannot be read, text that is not JSON — is one line on stderr and exit code 2.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The folder of these scripts. */
export const SCRIPTS = dirname(fileURLToPath(import.meta.url))

const message = (error) => (error instanceof Error ? error.message : String(error))

/** Stops the script with exit code 2 and this line on stderr. */
export function stop(line) {
  process.stderr.write(`${line}\n`)
  process.exit(2)
}

/**
 * The command line of `script`: `{ arg, config }`, where `arg` is the one positional argument (or
 * undefined) and `config` the parsed headings config with its `path`.
 */
export function readCommandLine(script, argName) {
  const args = process.argv.slice(2)
  const option = args.indexOf('--headings')
  const path = option === -1 ? join(SCRIPTS, 'doc-headings.json') : args[option + 1]
  if (option !== -1) args.splice(option, 2)
  if (path === undefined || args.length > 1) stop(`usage: ${script} [--headings <file>] [<${argName}>]`)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    stop(`${path}: the headings config cannot be read: ${message(error)}`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch (error) {
    stop(`${path}: the headings config is not JSON: ${message(error)}`)
  }
  return { arg: args[0], config: { path, json } }
}

/** A string that is not blank, trimmed; undefined for anything else. */
export function word(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}
