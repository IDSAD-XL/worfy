// The node that runs the tests' stand-ins of the Harness scripts, and the text of the simplest ones.
//
// worfy starts `epic-status`, `profile` and `ticket` as `node <script>`, with the node on the PATH of
// the environment it hands them (src/main/workflow/profile.ts, harnessScriptNode; ADR-0055 item 2).
// So a stand-in is a Node script, never a `#!/bin/sh` one, and an environment a test hands a reader
// has that node's folder on its PATH. The tests themselves run under Electron's Node
// (scripts/vitest-electron.mjs), whose process.execPath is Electron, not node: the node here is the
// one on this process's PATH.
import { statSync } from 'node:fs'
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
 * A Node script that prints the file at `path`. It runs whether node takes it for CommonJS or for an
 * ES module (a temporary folder has no package.json; the repository says `"type": "module"`): the
 * import is the dynamic one, which both have.
 */
export const catScript = (path: string): string => `import('node:fs').then((fs) => process.stdout.write(fs.readFileSync(${JSON.stringify(path)}, 'utf8')))\n`

/** A Node script that prints `text`; like catScript, it runs as either kind of module. */
export const printScript = (text: string): string => `process.stdout.write(${JSON.stringify(text)})\n`
