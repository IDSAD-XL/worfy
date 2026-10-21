// The sandbox of the first-run checks in e2e (first-run.spec.ts, settings-health.spec.ts): the
// stand-in tools of test/fixtures/first-run-tools/ first on the PATH the checks see, with the
// stand-ins' settings next to them, and nothing of the machine running the tests.
//
// On macOS and Linux the checks run with the environment of the login shell, so a temporary HOME's
// .profile sets it, and the tools are links to the shell stand-ins. Windows has no login shell:
// worfy reads the persistent environment from the registry (src/main/agent/env.ts). There the
// sandbox writes a registry stand-in, a JSON file named by WORFY_REGISTRY_STAND_IN (worfy-windows
// ticket 81), and the tools are `<tool>.cmd` files that run the Node ports `<tool>.mjs` with the
// node running this test, as test/contract/first-run-checks.test.ts does.
import { copyFileSync, existsSync, linkSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERSISTENT_ENV_KEYS, REGISTRY_STAND_IN_VAR } from '../../src/main/agent/env'
import { repoRoot } from './helpers'

const WINDOWS = process.platform === 'win32'
export const TOOLS = join(repoRoot, 'test', 'fixtures', 'first-run-tools')
export const ALL_TOOLS = ['claude', 'gh', 'node', 'jq', 'git', 'npm', 'qmd']

/**
 * The rows of the first-run checks, in screen order (CHECKS of src/main/first-run/checks.ts): on
 * Windows five more, about the machine itself — its version, architecture, PowerShell, Git Bash and
 * the limits bridge of Claude Code.
 */
export const CHECK_IDS = [
  'claude-login', 'claude-version',
  ...(WINDOWS ? ['limits', 'windows', 'arch', 'powershell'] : []),
  'git', 'git-identity',
  ...(WINDOWS ? ['git-bash'] : []),
  'gh', 'node', 'jq', 'gh-auth', 'harness', 'harness-dependencies', 'harness-scripts', 'legacy-harness', 'qmd', 'qmd-models', 'qmd-collections',
]

/**
 * Whether worfy misses the stand-in qmd: on Windows src/main/harness/qmd.ts does not find a qmd.cmd on
 * the Path (worfy-windows ticket 15), so the qmd rows never reach OK and qmd is never called.
 */
export const NO_QMD = WINDOWS

/** The sandbox's tool `name` in `bin`: `<name>` on macOS and Linux, `<name>.cmd` on Windows. */
export const toolFile = (bin: string, name: string): string => join(bin, WINDOWS ? `${name}.cmd` : name)

/** The stand-in claude that worfy starts itself (WORFY_CLAUDE): on Windows its Node port, which worfy runs with its own Node. */
export const CLAUDE_STAND_IN = join(TOOLS, WINDOWS ? 'claude.mjs' : 'claude')

export interface SandboxOptions {
  /** The sandbox's own folder; the registry stand-in and the folder of node.exe go there. */
  scratch: string
  /** The temporary HOME of the app under test, where .profile goes. */
  home: string
  /** The folder of the stand-in tools, first on the PATH. */
  bin: string
  /** The stand-ins to put in `bin`; every one by default. */
  tools?: string[]
  /** The stand-ins' settings, set next to the PATH. */
  variables: Record<string, string>
}

/**
 * Puts the stand-ins in `bin` and makes `variables` and a PATH starting with `bin` the environment
 * the checks see. Returns what the app needs in its own environment for that: nothing on macOS and
 * Linux, the registry stand-in on Windows. A second call writes the environment again.
 *
 * On Windows the Harness scripts run with node.exe from the Path, never a `.cmd` (nodeOnPath of
 * src/main/workflow/profile.ts), so with `node` among the tools a link to the real node.exe goes in
 * a folder after `bin`; `node --version` still finds bin\node.cmd first.
 */
export function writeSandbox(options: SandboxOptions): Record<string, string> {
  const tools = options.tools ?? ALL_TOOLS
  if (!WINDOWS) {
    for (const name of tools) symlinkSync(join(TOOLS, name), join(options.bin, name))
    const variables = { PATH: `${options.bin}:/usr/bin:/bin`, ...options.variables }
    writeFileSync(join(options.home, '.profile'), Object.entries(variables).map(([key, value]) => `${key}='${value}'; export ${key}\n`).join(''))
    return {}
  }
  for (const name of tools) writeFileSync(toolFile(options.bin, name), `@"${process.execPath}" "${join(TOOLS, `${name}.mjs`)}" %*\r\n`)
  const path = [options.bin]
  if (tools.includes('node')) {
    const nodeDir = join(options.scratch, 'node-bin')
    mkdirSync(nodeDir, { recursive: true })
    const node = join(nodeDir, 'node.exe')
    // Kept when an earlier call made it: a copy over a hard link would write into the running node.exe.
    if (!existsSync(node)) {
      try {
        linkSync(process.execPath, node)
      } catch {
        // Another volume: a copy does the same.
        copyFileSync(process.execPath, node)
      }
    }
    path.push(nodeDir)
  }
  // The system folders a sign-in has: cmd.exe and Windows PowerShell, for the Terminal Nodes.
  path.push('%SystemRoot%\\System32', '%SystemRoot%', '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0')
  const user = [
    { name: 'Path', type: 'REG_EXPAND_SZ', value: path.join(';') },
    ...Object.entries(options.variables).map(([name, value]) => ({ name, type: 'REG_SZ', value })),
  ]
  const file = join(options.scratch, 'registry.json')
  writeFileSync(file, JSON.stringify({ [PERSISTENT_ENV_KEYS[0]]: user, [PERSISTENT_ENV_KEYS[1]]: [] }))
  return { [REGISTRY_STAND_IN_VAR]: file }
}
