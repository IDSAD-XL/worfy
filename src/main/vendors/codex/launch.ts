// How a Codex app-server process starts (worfy-multi-vendor ticket 18): the binary this build pins
// (binary.ts, ticket 17) with `app-server`, or, under WORFY_CODEX=fake, the fake app-server
// test/fixtures/codex-app-server/fake-app-server.mjs under worfy's own executable — so tests and e2e
// runs never start the real Codex and never sign in. The fake's variables pass through the environment:
// WORFY_CODEX_SCRIPT (the script, "turn" by default), WORFY_CODEX_SCRIPTS (their folder; the fixtures
// folder by default), WORFY_CODEX_LOG (where the fake writes worfy's messages) and WORFY_CODEX_HOME (the
// fake's threads). CODEX_HOME is the one of `env`: the user's in the app, a temporary folder in tests
// (test/setup-contract.ts, test/e2e/launch-env.ts).
//
// The process starts without a shell, on every system: the program is a full path, and the fake is a
// script under worfy's executable in run-as-Node mode (as programStart does for a `.mjs` stand-in,
// src/main/program.ts), since Windows cannot start a script as a program.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { join } from 'node:path'
import { codexExecutablePath, type CodexPackageResolver, type CodexRuntime } from './binary'

/** The fake app-server, from the app's root folder (app.getAppPath()). */
export const FAKE_APP_SERVER = join('test', 'fixtures', 'codex-app-server', 'fake-app-server.mjs')
/** The scripts of the fake, from the app's root folder. */
export const FAKE_SCRIPTS = join('test', 'fixtures', 'codex-scripts')

/** What to start: a program, its arguments and the whole environment of the child. */
export interface CodexLaunch {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export interface CodexLaunchOptions {
  runtime: CodexRuntime
  /** app.getAppPath(): the repository in `pnpm dev` and in tests, where the fake and its scripts are. */
  appPath: string
  /** The environment of the child; process.env by default. */
  env?: NodeJS.ProcessEnv
  /** Finds the platform package of @openai/codex; binary.ts's own by default (tests pass a stand-in). */
  resolvePackage?: CodexPackageResolver
}

/**
 * The start of a Codex app-server. Under WORFY_CODEX=fake: process.execPath with the fake and
 * ELECTRON_RUN_AS_NODE=1. Otherwise the pinned binary with `app-server`; under vitest that throws, so no
 * test reaches the real Codex even when a test file sets no WORFY_CODEX. Throws as well when this
 * platform has no Codex package installed.
 */
export function codexLaunch(options: CodexLaunchOptions): CodexLaunch {
  const env = options.env ?? process.env
  if (env.WORFY_CODEX === 'fake') {
    return {
      file: process.execPath,
      args: [join(options.appPath, FAKE_APP_SERVER)],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', WORFY_CODEX_SCRIPTS: env.WORFY_CODEX_SCRIPTS || join(options.appPath, FAKE_SCRIPTS) },
    }
  }
  if (env.VITEST) throw new Error('the real Codex is not started under vitest: set WORFY_CODEX=fake')
  const file = codexExecutablePath(options.runtime, options.resolvePackage)
  if (file === undefined) throw new Error(`no Codex for ${options.runtime.platform}-${options.runtime.arch}: the package @openai/codex-${options.runtime.platform}-${options.runtime.arch} is not installed`)
  return { file, args: ['app-server'], env }
}

/** child_process.spawn, or a test's stand-in of it. */
export type SpawnProcess = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/** Starts a Codex app-server (codexLaunch) in `cwd`, with pipes for stdin, stdout and stderr and no shell. */
export function startCodexAppServer(options: CodexLaunchOptions & { cwd: string }, spawnProcess: SpawnProcess = spawn): ChildProcess {
  const launch = codexLaunch(options)
  return spawnProcess(launch.file, launch.args, { cwd: options.cwd, env: launch.env, stdio: 'pipe', windowsHide: true })
}
