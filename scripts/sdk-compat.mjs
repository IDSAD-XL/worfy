#!/usr/bin/env node
// The shapes of Agent SDK messages, and how two captures of them differ: the SDK version worfy pins
// against the next one. Run `node scripts/sdk-compat.mjs --help`.
//
// A capture is a folder like test/fixtures/sdk-messages/: `*.jsonl` files of SDK messages, one JSON
// per line (lines of the capture script's own `probe_error` are skipped), and `manifest.json`, what
// the messages were captured with: `{ sdk, claudeCode, queryMethods }` — the SDK package version, the
// Claude Code version inside it, and each method of the SDK's `Query` with the first line of its
// declaration in sdk.d.ts. `manifest` prints that record for the SDK installed in this checkout.
//
// The shape of a message is its kind — `type`, or `type/subtype` — and each key path in it with the
// JSON types seen there. A path goes through objects (`message.usage.input_tokens`) and arrays
// (`content[]`); an object with a string `type` carries it in brackets (`content[](tool_use).id`),
// so blocks and stream events of different types keep their own keys. Values that are not the
// SDK's own shape are recorded without their insides: a tool's `input` and the `structured_output`
// a caller asked for. Records keyed by data (`modelUsage` by model, `wire_tool_inputs` by tool use)
// get `*` for the key.
//
// Reads only; never starts Claude Code or the SDK. Capturing messages of a new SDK version is a
// paid run of scripts/spikes/sdk-probe.ts and is not done here.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HELP = `usage: node scripts/sdk-compat.mjs diff <old capture> <new capture>
       node scripts/sdk-compat.mjs manifest [<SDK package folder>]

diff      the message shapes of two capture folders (*.jsonl of SDK messages and
          manifest.json): message kinds, key paths and their JSON types, the
          versions and the Query methods of the manifests. Exit 0: no difference;
          1: differences, printed; 2: a folder cannot be read.
          Keys are compared only for kinds both captures have: a kind's keys
          depend on what its scenarios made Claude Code do, so compare captures
          of the same scenarios (scripts/spikes/sdk-probe.ts).
manifest  manifest.json for an installed SDK package (default: the one this
          checkout resolves): its version, claudeCodeVersion and Query methods.`

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'

/** Keys whose object is keyed by data, not by the SDK: their keys become `*`. */
const RECORD_KEYS = new Set(['modelUsage', 'wire_tool_inputs'])

const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value)

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** `(text)` for an object with a string `type`, else nothing. */
const tagOf = (value) => (isObject(value) && typeof value.type === 'string' ? `(${value.type})` : '')

/** `type/subtype` of an SDK message, or its `type`. */
export function kindOf(message) {
  const base = isObject(message) && typeof message.type === 'string' ? message.type : 'untyped'
  return isObject(message) && typeof message.subtype === 'string' ? `${base}/${message.subtype}` : base
}

/** Whether the value at `key` under `path` is a caller's or a tool's, not a shape of the SDK. */
const opaque = (path, key, parentKey) => (key === 'input' && path.endsWith('(tool_use)')) || key === 'structured_output' || parentKey === 'wire_tool_inputs'

function walk(value, path, parentKey, paths) {
  if (path !== '') (paths[path] ??= new Set()).add(typeOf(value))
  if (Array.isArray(value)) {
    for (const element of value) walk(element, `${path}[]${tagOf(element)}`, null, paths)
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    // A string type is in the tag of its object, and the message's type and subtype in its kind.
    if (key === 'type' && typeof child === 'string') continue
    if (path === '' && key === 'subtype' && typeof child === 'string') continue
    const name = RECORD_KEYS.has(parentKey) ? '*' : key
    const childPath = `${path === '' ? '' : `${path}.`}${name}${tagOf(child)}`
    if (opaque(path, key, parentKey)) (paths[childPath] ??= new Set()).add(typeOf(child))
    else walk(child, childPath, key, paths)
  }
}

/** The key paths of one message, each with its JSON type: `{ path: [type] }`. */
export function shapeOf(message) {
  const paths = {}
  walk(message, '', null, paths)
  return Object.fromEntries(Object.entries(paths).map(([path, types]) => [path, [...types].sort()]))
}

/** The shapes of many messages, merged by kind: `{ kind: { path: [types] } }`. */
export function shapesOf(messages) {
  const kinds = {}
  for (const message of messages) {
    const kind = (kinds[kindOf(message)] ??= {})
    for (const [path, types] of Object.entries(shapeOf(message))) kind[path] = [...new Set([...(kind[path] ?? []), ...types])].sort()
  }
  return kinds
}

/** SDK messages of a `.jsonl` file; the capture script's own `probe_error` records are not SDK messages. */
export function readMessages(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
    .filter((message) => !(isObject(message) && 'probe_error' in message))
}

/** A capture folder: its messages and its manifest (null when it has none). */
export function readCapture(folder) {
  const files = readdirSync(folder)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
  const manifestFile = join(folder, 'manifest.json')
  return {
    messages: files.flatMap((name) => readMessages(join(folder, name))),
    manifest: existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null,
  }
}

const isComment = (line) => /^\s*(\/\*\*?|\*|\/\/)/.test(line)

/** How many brackets a line opens, less those it closes. */
const depthOf = (line) => {
  let depth = 0
  for (const char of line) {
    if ('({['.includes(char)) depth += 1
    else if (')}]'.includes(char)) depth -= 1
  }
  return depth
}

/**
 * The methods of the SDK's `Query` interface in sdk.d.ts, each with its whole declaration on one
 * line, comments left out: `{ name: 'name(…): …;' }`.
 */
export function queryMethodsOf(declarations) {
  const lines = declarations.split('\n')
  const start = lines.findIndex((line) => /^export declare interface Query\b/.test(line))
  if (start === -1) throw new Error('sdk.d.ts declares no interface Query')
  const methods = {}
  let current = null
  for (const line of lines.slice(start + 1)) {
    if (current === null) {
      if (line.startsWith('}')) break
      const method = /^ {4}([A-Za-z_$][\w$]*)\??\(/.exec(line)
      if (method) current = { name: method[1], parts: [], depth: 0 }
    }
    if (current === null || isComment(line)) continue
    current.parts.push(line.trim())
    current.depth += depthOf(line)
    if (current.depth === 0 && line.trimEnd().endsWith(';')) {
      methods[current.name] = current.parts.join(' ').replaceAll(/\s+/g, ' ').replaceAll(/([({[]) /g, '$1').replaceAll(/ ([)}\]])/g, '$1')
      current = null
    }
  }
  return Object.fromEntries(Object.entries(methods).sort(([a], [b]) => a.localeCompare(b)))
}

/** The folder of the SDK package this checkout resolves. */
export function installedSdk() {
  return dirname(createRequire(import.meta.url).resolve(SDK_PACKAGE))
}

/** manifest.json of an installed SDK package. */
export function manifestOf(sdkFolder) {
  const pkg = JSON.parse(readFileSync(join(sdkFolder, 'package.json'), 'utf8'))
  return {
    sdk: pkg.version,
    claudeCode: pkg.claudeCodeVersion,
    queryMethods: queryMethodsOf(readFileSync(join(sdkFolder, pkg.types ?? 'sdk.d.ts'), 'utf8')),
  }
}

const added = (a, b) => Object.keys(b).filter((key) => !Object.hasOwn(a, key)).sort()

/** How capture `b` differs from capture `a`. Every list is empty when they have the same shapes. */
export function compareCaptures(a, b) {
  const shapesA = shapesOf(a.messages)
  const shapesB = shapesOf(b.messages)
  const keys = {}
  for (const kind of Object.keys(shapesA).filter((kind) => Object.hasOwn(shapesB, kind)).sort()) {
    const pathsA = shapesA[kind]
    const pathsB = shapesB[kind]
    const retyped = Object.keys(pathsA)
      .filter((path) => Object.hasOwn(pathsB, path) && pathsA[path].join('|') !== pathsB[path].join('|'))
      .sort()
      .map((path) => ({ path, from: pathsA[path], to: pathsB[path] }))
    const entry = {
      added: added(pathsA, pathsB).map((path) => ({ path, types: pathsB[path] })),
      removed: added(pathsB, pathsA).map((path) => ({ path, types: pathsA[path] })),
      retyped,
    }
    if (entry.added.length + entry.removed.length + entry.retyped.length > 0) keys[kind] = entry
  }
  const methodsA = a.manifest?.queryMethods ?? {}
  const methodsB = b.manifest?.queryMethods ?? {}
  return {
    versions: {
      sdk: { from: a.manifest?.sdk ?? null, to: b.manifest?.sdk ?? null },
      claudeCode: { from: a.manifest?.claudeCode ?? null, to: b.manifest?.claudeCode ?? null },
    },
    kinds: { added: added(shapesA, shapesB), removed: added(shapesB, shapesA) },
    keys,
    methods: {
      added: added(methodsA, methodsB).map((name) => methodsB[name]),
      removed: added(methodsB, methodsA).map((name) => methodsA[name]),
      changed: Object.keys(methodsA)
        .filter((name) => Object.hasOwn(methodsB, name) && methodsA[name] !== methodsB[name])
        .sort()
        .map((name) => ({ name, from: methodsA[name], to: methodsB[name] })),
    },
  }
}

/** Whether a comparison found any difference of shape (versions alone are no difference). */
export function differs(comparison) {
  const { kinds, keys, methods } = comparison
  return kinds.added.length + kinds.removed.length + Object.keys(keys).length + methods.added.length + methods.removed.length + methods.changed.length > 0
}

const types = (list) => list.join('|')

/** The comparison as text, one difference per line. */
export function formatComparison(comparison) {
  const { versions, kinds, keys, methods } = comparison
  const version = ({ from, to }) => (from === to ? `${from ?? '?'}` : `${from ?? '?'} -> ${to ?? '?'}`)
  const lines = [`SDK ${version(versions.sdk)}, Claude Code ${version(versions.claudeCode)}`]
  if (!differs(comparison)) return [...lines, 'no difference in message shapes or Query methods'].join('\n')
  if (kinds.added.length + kinds.removed.length > 0) {
    lines.push('message kinds:')
    for (const kind of kinds.added) lines.push(`  + ${kind}`)
    for (const kind of kinds.removed) lines.push(`  - ${kind}`)
  }
  if (Object.keys(keys).length > 0) {
    lines.push('keys (kinds both captures have):')
    for (const [kind, entry] of Object.entries(keys)) {
      lines.push(`  ${kind}`)
      for (const { path, types: list } of entry.added) lines.push(`    + ${path}: ${types(list)}`)
      for (const { path, types: list } of entry.removed) lines.push(`    - ${path}: ${types(list)}`)
      for (const { path, from, to } of entry.retyped) lines.push(`    ~ ${path}: ${types(from)} -> ${types(to)}`)
    }
  }
  if (methods.added.length + methods.removed.length + methods.changed.length > 0) {
    lines.push('Query methods:')
    for (const method of methods.added) lines.push(`  + ${method}`)
    for (const method of methods.removed) lines.push(`  - ${method}`)
    for (const { from, to } of methods.changed) lines.push(`  ~ ${from}`, `    ${to}`)
  }
  return lines.join('\n')
}

/** The command line; returns the exit code. */
export function sdkCompat(args, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text)) {
  const [command, ...rest] = args
  if (command === '--help' || command === '-h') {
    out(`${HELP}\n`)
    return 0
  }
  try {
    if (command === 'diff' && rest.length === 2) {
      const comparison = compareCaptures(readCapture(rest[0]), readCapture(rest[1]))
      out(`${formatComparison(comparison)}\n`)
      return differs(comparison) ? 1 : 0
    }
    if (command === 'manifest' && rest.length <= 1) {
      out(`${JSON.stringify(manifestOf(rest[0] ?? installedSdk()), null, 2)}\n`)
      return 0
    }
  } catch (error) {
    err(`sdk-compat: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  err(`${HELP}\n`)
  return 2
}

function runAsScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) process.exitCode = sdkCompat(process.argv.slice(2))
