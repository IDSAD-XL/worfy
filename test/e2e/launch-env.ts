// The environment launchApp (helpers.ts) starts the app with: the test process's own, the isolation
// variables, and a login shell of the tests' own (SHELL), then whatever the spec passes.
//
// At start worfy captures the environment of the user's login shell, `$SHELL -ilc`
// (src/main/agent/env.ts). With the test process's SHELL that is the developer's own shell and rc
// files: a slow one slowed every start and failed tests with short waits (worfy-harness ticket 45).
// So SHELL defaults to test/fixtures/e2e-shell/sh, which reads no rc file and hands the app the
// test process's PATH. HOME stays the developer's: no rc file is read whatever HOME is, and the
// app's other paths under HOME (git's identity among them) stay what the tests had before.
//
// A spec that is about the login shell sets SHELL (and its own HOME) through `env`, and its value
// wins over the default, as every variable of `env` does.
//
// On Windows the user's profile folders move to a temporary folder of the launch (windowsProfileEnv,
// terminal-shell.ts): worfy hands USERPROFILE, APPDATA and LOCALAPPDATA of its own process to the
// shell of a Terminal, and with the test process's values that shell read the owner's $PROFILE and
// rc files and appended every command a spec typed to the owner's PSReadLine history (worfy-windows
// ticket 84). test/contract/terminal-profile-isolation.test.ts pins it.
import { symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { windowsProfileEnv } from './terminal-shell'

const fixtures = join(import.meta.dirname, '..', 'fixtures')

/**
 * The gh stand-in as WORFY_GH names it: the `gh` wrapper, a shell script; on Windows, which cannot
 * start one, the Node script itself, which worfy runs under its own Node (src/main/program.ts).
 */
export const GH_STUB = join(fixtures, 'gh', process.platform === 'win32' ? 'gh-stub.mjs' : 'gh')

/** The login shell of a spec that sets no SHELL; started through a link per launch (launchEnv). */
export const E2E_SHELL = join(fixtures, 'e2e-shell', 'sh')

export interface LaunchEnvOptions {
  /** WORFY_DATA_DIR: the app's own state for this run. */
  dataDir: string
  /** WORFY_CLAUDE_HOME: stands in for ~/.claude. */
  claudeHome: string
  /** A temporary folder of this launch: the default shell's link and its PATH file go there. */
  shellDir: string
  /** The test process's environment; process.env by default. */
  source?: NodeJS.ProcessEnv
  /** The spec's own variables: each wins over the default of the same name, SHELL among them. */
  env?: Record<string, string> | undefined
  /** The system the environment is for; process.platform by default. */
  platform?: NodeJS.Platform
}

/**
 * Links E2E_SHELL into `shellDir` and writes the PATH it hands the app next to the link
 * (`<link>.path`, read by the shell). Returns the link, the value for SHELL.
 */
async function defaultShell(shellDir: string, path: string): Promise<string> {
  const link = join(shellDir, 'sh')
  await symlink(E2E_SHELL, link)
  await writeFile(`${link}.path`, path)
  return link
}

/** The test process's environment without ELECTRON_RUN_AS_NODE, which would start Electron as Node. */
function inherited(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return env
}

/**
 * What every start of the app in a test gets, whether Playwright starts it or the spec does. On
 * Windows that includes the user's profile folders in `profileDir` (windowsProfileEnv).
 */
function isolation(dataDir: string, claudeHome: string, profileDir: string, platform: NodeJS.Platform): Record<string, string> {
  return {
    ...windowsProfileEnv(profileDir, platform),
    WORFY_DATA_DIR: dataDir,
    WORFY_CLAUDE_HOME: claudeHome,
    WORFY_AGENT: 'fake',
    // A gh that never reaches GitHub (test/fixtures/gh/gh-stub.mjs): no PRs unless GH_STUB_DIR says
    // otherwise. Every gh worfy runs goes through it, the first-run checks included (worfy-windows
    // ticket 80): without it they would run the machine's own gh.
    WORFY_GH: GH_STUB,
    // The first-run screen (worfy-harness ticket 19) does not open by itself: it would cover the
    // window of every test, and its checks would run. test/e2e/first-run.spec.ts turns it back on
    // with WORFY_FIRST_RUN_AUTO=1.
    WORFY_FIRST_RUN_AUTO: '0',
    // The link server (worfy-link) listens on loopback only, so the macOS firewall never asks about
    // incoming connections, and Bonjour is off, so macOS never asks for the Local Network
    // permission: either prompt would stop a run. Linked worfy in a test reach each other at
    // 127.0.0.1:<port> (launchLinkedPair in helpers.ts).
    WORFY_LINK_HOST: '127.0.0.1',
    WORFY_LINK_BONJOUR: '0',
  }
}

/** The environment of the app process of one launch. */
export async function launchEnv(options: LaunchEnvOptions): Promise<Record<string, string>> {
  const source = options.source ?? process.env
  const platform = options.platform ?? process.platform
  // Off Windows only: there the environment comes from the registry, not from a login shell (ADR-0057).
  const shell: Record<string, string> = platform === 'win32' || options.env?.SHELL !== undefined ? {} : { SHELL: await defaultShell(options.shellDir, source.PATH ?? '') }
  return { ...inherited(source), ...isolation(options.dataDir, options.claudeHome, join(options.shellDir, 'profile'), platform), ...shell, ...options.env }
}

export interface DirectStartEnvOptions {
  dataDir: string
  claudeHome: string
  /** The test process's environment; process.env by default. */
  source?: NodeJS.ProcessEnv
  /** The spec's own variables: each wins over the default of the same name. */
  env?: Record<string, string>
  /** The system the environment is for; process.platform by default. */
  platform?: NodeJS.Platform
}

/**
 * The profile folder of the starts without Playwright on Windows: one folder for all of them, not
 * one per start, since nothing removes it after the start. Its history would mix across specs and
 * grow from run to run, but no such start opens a Terminal.
 * shortcut: shared by every direct start and never removed, redo when a direct start types into a Terminal.
 */
export const DIRECT_START_PROFILE = join(tmpdir(), 'worfy-e2e-direct-start-profile')

/**
 * The environment of an app process a spec starts itself, without Playwright (a start that must
 * fail, a second start, a hook given with `-r`): the same isolation as launchEnv, with the test
 * process's own login shell. test/unit/e2e-gh-stub.test.ts checks that every such start uses it.
 */
export function directStartEnv(options: DirectStartEnvOptions): Record<string, string> {
  return { ...inherited(options.source ?? process.env), ...isolation(options.dataDir, options.claudeHome, DIRECT_START_PROFILE, options.platform ?? process.platform), ...options.env }
}
