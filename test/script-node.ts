// The node binary that tests start the repository's scripts with: scripts/*.mjs, harness/bin/*,
// harness/hooks/*, and the `node -e` processes a test needs.
//
// Not process.execPath. `pnpm test` runs vitest under Electron's Node (scripts/vitest-electron.mjs), so
// there process.execPath is Electron's binary, a Node only with ELECTRON_RUN_AS_NODE, and under load it
// starts far slower than node itself. On the GitHub Windows runner, in shard 3/3 of the unit and contract
// suite, one launch of `-e 0` took 1.6 s at the median, 6.7 s at the 90th percentile and up to 26 s for
// Electron as Node, while node.exe stayed under 0.4 s (draft PR #923, run 40752443457; throughput ticket
// 23). A test that started a script several times ran into the 15 s limit of test/unit there.
//
// Which node: npm_node_execpath, the node pnpm runs under (`pnpm test`), else `node` from PATH (a run of
// `node scripts/vitest-electron.mjs` without pnpm, as the Harness gate starts it). It is asked once, on
// the first call — never while the module loads — and the answer is the absolute path it reports, so a
// test that hands its script a PATH without node still starts it. If that node does not start, or is
// Electron, every call throws: there is no quiet fallback to process.execPath.
//
// A few tests stay on process.execPath on purpose, each for the reason
// test/contract/script-node.test.ts gives: there the program is the app's own choice, not a script the
// test starts. That test also fails on a new read of process.execPath anywhere else in the test code.
import { spawnSync } from 'node:child_process'
import process from 'node:process'

/**
 * The node `env` names, checked by starting it once: its absolute path. Throws when it does not start or
 * is Electron. `env` is process.env except in tests of this function.
 */
export function findScriptNode(env: Readonly<Record<string, string | undefined>>): string {
  const fromPnpm = env.npm_node_execpath
  const candidate = fromPnpm === undefined || fromPnpm === '' ? 'node' : fromPnpm
  const source = candidate === 'node' ? 'node from PATH' : `npm_node_execpath (${candidate})`
  // ELECTRON_RUN_AS_NODE keeps an Electron named by mistake a Node, which then says it is Electron,
  // instead of opening an app window.
  const run = spawnSync(candidate, ['-p', 'JSON.stringify([process.execPath, process.versions.electron ?? null])'], {
    encoding: 'utf8',
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 30_000,
    windowsHide: true,
  })
  const fail = (why: string): never => {
    throw new Error(
      `the node for the tests' scripts is not usable: ${source} ${why}. The tests take node from npm_node_execpath (set by pnpm) or else from PATH, and never fall back to process.execPath (Electron under pnpm test).`,
    )
  }
  if (run.error !== undefined) {
    const timedOut = (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    return fail(timedOut ? 'started but did not answer within 30 s' : `did not start (${run.error.message})`)
  }
  if (run.status !== 0) return fail(`exited with ${run.status ?? run.signal}: ${run.stderr.trim()}`)
  let answer: unknown
  try {
    answer = JSON.parse(run.stdout)
  } catch {
    return fail(`printed no answer: ${JSON.stringify(run.stdout)}`)
  }
  const [path, electron] = Array.isArray(answer) ? answer : []
  if (typeof path !== 'string' || path === '') return fail(`printed no path: ${JSON.stringify(run.stdout)}`)
  if (electron !== null) return fail(`is Electron ${String(electron)} (${path}), not node`)
  return path
}

let found: { path: string } | { error: unknown } | undefined

/** The real node for a test's scripts, found once (findScriptNode over process.env). */
export function scriptNode(): string {
  if (found === undefined) {
    try {
      found = { path: findScriptNode(process.env) }
    } catch (error) {
      found = { error }
    }
  }
  if ('error' in found) throw found.error
  return found.path
}
