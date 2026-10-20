// The node that runs the tests' stand-ins of the Harness scripts, and the text of the simplest ones.
//
// worfy starts `epic-status`, `profile` and `ticket` as `node <script>`, with the node on the PATH of
// the environment it hands them (src/main/workflow/profile.ts, harnessScriptCommand; ADR-0055 item 2).
// So a stand-in is a Node script, never a `#!/bin/sh` one, and an environment a test hands a reader
// has that node's folder on its PATH. The tests themselves run under Electron's Node
// (scripts/vitest-electron.mjs), whose process.execPath is Electron, not node: the node here is the
// one on this process's PATH.
import { spawnSync } from 'node:child_process'
import { statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import process from 'node:process'

/** The PATH of `env`, whatever the case of the key (Windows has `Path`). */
function pathOf(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH' && env[name] !== undefined)
  return key === undefined ? '' : (env[key] ?? '')
}

function findNode(): string {
  const name = process.platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of pathOf(process.env).split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not in this folder.
    }
  }
  throw new Error(`no ${name} on the PATH of the tests: the Harness script stand-ins need it`)
}

/** The node on this process's PATH. */
export const NODE = findNode()

/** The folder of NODE, for the PATH of a scripts' environment. */
export const NODE_DIR = dirname(NODE)

let shStarts: boolean | undefined

/**
 * Whether `sh` starts from this process's PATH: always on macOS and Linux, on Windows when Git Bash's
 * folder is on it. The stand-ins of an older Harness are `#!/bin/sh` scripts; a test that runs one
 * through `sh` runs wherever this is true. Asked on the first call, not when this module loads: the
 * e2e specs load it too, and a spec starts no process while Playwright loads it
 * (test/unit/e2e-no-spawn-on-load.test.ts).
 */
export function hasSh(): boolean {
  shStarts ??= spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0
  return shStarts
}

/**
 * Gives the temporary home folder `home` a `.profile` that puts NODE_DIR first on PATH. A test that
 * starts the app with `SHELL=/bin/sh` and that HOME gets its scripts' environment from `/bin/sh -ilc`
 * (src/main/agent/env.ts, captureLoginShellEnv), which reads /etc/profile and then `$HOME/.profile`
 * (bash run as sh on macOS, dash on Linux): without this the login shell's PATH has no node, and the
 * stand-ins are not run.
 */
export function loginProfileWithNode(home: string): void {
  const quoted = `'${NODE_DIR.replaceAll("'", `'\\''`)}'`
  writeFileSync(join(home, '.profile'), `PATH=${quoted}:"$PATH"\nexport PATH\n`)
}

/**
 * `env` with its PATH replaced by `dirs`, every spelling of the key dropped first: on Windows `Path`
 * and `PATH` name the same variable, and a leftover `Path` would keep the old folders.
 */
export function withPath(env: Readonly<Record<string, string | undefined>>, dirs: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() !== 'PATH') out[key] = value
  out.PATH = dirs.join(delimiter)
  return out
}

/**
 * A small environment for a Harness script, like the login shell's: PATH of `dirs` and `extra`. On
 * Windows SystemRoot is kept too, which node needs to start there.
 */
export function scriptsEnv(dirs: readonly string[], extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const systemRoot = process.platform === 'win32' ? process.env.SystemRoot : undefined
  return { ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }), PATH: dirs.join(delimiter), ...extra }
}

/**
 * A Node script that prints the file at `path`. It runs whether node takes it for CommonJS or for an
 * ES module (a temporary folder has no package.json; the repository says `"type": "module"`): the
 * import is the dynamic one, which both have.
 */
export const catScript = (path: string): string => `import('node:fs').then((fs) => process.stdout.write(fs.readFileSync(${JSON.stringify(path)}, 'utf8')))\n`

/**
 * A Node script whose `body` runs with `fs` (node:fs) in scope; like catScript, it runs as either
 * kind of module.
 */
export const nodeScript = (body: string): string => `#!/usr/bin/env node\nimport('node:fs').then((fs) => {\n${body}\n})\n`

/** A Node script that prints `text`; like catScript, it runs as either kind of module. */
export const printScript = (text: string): string => `process.stdout.write(${JSON.stringify(text)})\n`

/**
 * A Node stand-in of `profile` that knows every folder: `--json` prints `json` and a line end; any
 * other call (`--field …`) exits with 4, a field the Profile does not have.
 */
export const profileJsonScript = (json: string): string =>
  `if (process.argv.slice(2).some((arg) => arg.includes('--json'))) process.stdout.write(${JSON.stringify(`${json}\n`)})\nelse process.exitCode = 4\n`

// What node itself prints on stderr when it dies, for the tests of what a failed Harness script's
// stderr gives the window (scriptFailureDetail in src/main/workflow/profile.ts). Taken from node
// v24 on macOS, the frames shortened; the process ends with SIGABRT in both cases.

/** `process.abort()`: the native stack, then the JavaScript one; no line of its own. */
export const ABORTED = [
  '----- Native stack trace -----',
  '',
  ' 1: 0x104d379f4 node::Abort(v8::FunctionCallbackInfo<v8::Value> const&) [/usr/local/bin/node]',
  ' 2: 0x105b8a818 Builtins_CallApiCallbackGeneric [/usr/local/bin/node]',
  '10: 0x104c79e80 node::contextify::ContextifyScript::RunInContext(v8::FunctionCallbackInfo<v8::Value> const&) [/usr/local/bin/node]',
  '',
  '----- JavaScript stack trace -----',
  '',
  '1: abort (node:internal/process/per_thread:1:1)',
  '2: [eval]-wrapper:6:24',
  '3: node:internal/main/eval_string:71:3',
  '',
  '',
].join('\n')

/** The heap of the script ran out: the GC block, the FATAL ERROR line, then the native stack. */
export const OUT_OF_MEMORY = [
  '',
  '<--- Last few GCs --->',
  '',
  '[94207:0x79740c000]        9 ms: Mark-Compact 6.5 (11.3) -> 6.5 (11.1) MB, pooled: 0 MB, 0.79 / 0.00 ms  (average mu = 0.775, current mu = 0.620) allocation failure; scavenge might not succeed',
  '[94207:0x79740c000]       10 ms: Mark-Compact 8.0 (12.6) -> 8.0 (16.6) MB, pooled: 0 MB, 1.12 / 0.00 ms  (average mu = 0.604, current mu = 0.129) allocation failure; scavenge might not succeed',
  '',
  '',
  '<--- JS stacktrace --->',
  '',
  'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
  '----- Native stack trace -----',
  '',
  ' 1: 0x1028999f4 node::OOMErrorHandler(char const*, v8::OOMDetails const&) [/usr/local/bin/node]',
  ' 2: 0x102b14000 v8::internal::V8::FatalProcessOutOfMemory(v8::internal::Isolate*, char const*, v8::OOMDetails const&) [/usr/local/bin/node]',
  '13: 0x10382e234 Builtins_CEntry_Return1_ArgvOnStack_NoBuiltinExit [/usr/local/bin/node]',
  '',
].join('\n')
