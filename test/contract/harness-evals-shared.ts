// What harness-evals.test.ts (the cases and their fixtures) and harness-evals-run.test.ts
// (pnpm eval:harness against a stub claude, and the map of rule files) both need: the cases, the
// temporary folders of a test file, the environment of a child with a temporary home, and the stub
// claude. It is not a test file. The tests were one file of 193 serial tests, 257–261 s on the
// Windows runner, the longest file of the job `windows (1/3) / full-suite`; in two files vitest can
// put the halves in different shards.
import { cpSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeEach } from 'vitest'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

export const REPO = join(__dirname, '..', '..')
export const HARNESS = join(REPO, 'harness')
export const EVALS = join(HARNESS, 'evals')

// The ticket's table of cases; the tag decides which `claude plugin eval` call runs a case.
export const CASES: [name: string, tag: 'main' | 'gui'][] = [
  ['epic-wave-tickets', 'main'],
  ['epic-wave-old-form', 'main'],
  ['ship-ticket-local-green', 'main'],
  ['ship-ticket-pr-green-ci', 'main'],
  ['implementer-report', 'main'],
  ['reviewer-verdict', 'main'],
  ['no-os-screen-capture', 'gui'],
  ['status-block', 'main'],
  ['reviewer-intended-breakage', 'main'],
  ['reviewer-simplification', 'main'],
]
// A scaffold script has 120 seconds inside `claude plugin eval`; here it takes about a second.
export const SCAFFOLD_TIMEOUT_MS = ms(60_000)

// The temporary folders of a test file that imports this module. A folder a test makes is removed
// after that test, in afterEach; afterAll removes only the folders made outside a test (while the
// file is collected, in a beforeAll) and those a helper keeps for the tests after it (`'file'`). All
// of them in one afterAll — about 280 trees with 44 000 entries, when changedRepo() still made a git
// repository per call — took 2.6 s on an idle Mac and more than the 10 s limit of a hook under a
// loaded gate full. The hooks are registered when a test file imports this module: vitest gives
// each test file its own copy of the module, and a hook called while a file is collected belongs to
// that file.
const testTemps: string[] = []
const fileTemps: string[] = []
let inTest = false
beforeEach(() => {
  inTest = true
})
afterEach(() => {
  inTest = false
  for (const dir of testTemps.splice(0)) removeTestTree(dir)
})
afterAll(() => {
  for (const dir of fileTemps.splice(0)) removeTestTree(dir)
})
/** A new temporary folder, removed after the test that asks for it, or with `'file'` after the file. */
export const tempDir = (prefix: string, keep: 'test' | 'file' = 'test'): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  ;(inTest && keep === 'test' ? testTemps : fileTemps).push(dir)
  return dir
}

/**
 * The environment of every child these files give a home: `vars`, and HOME and USERPROFILE in the
 * temporary `home`. Node on Windows takes its home from USERPROFILE and, without it, asks Windows
 * for the account's profile folder — the real one, where the owner's ~/.claude/worfy-harness and
 * ~/.claude/gate live. So a child with HOME alone would read and write the real Harness state there.
 * HOME and USERPROFILE go last: no caller's variables replace them.
 */
export const childEnv = (home: string, vars: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...vars, HOME: home, USERPROFILE: home })

// A stand-in for claude: prints STUB_VERSION for --version; for every other call appends to
// STUB_LOG its arguments, what the target plugin folder holds (manifest, eval folder), PATH, the
// EVAL_* variables, the answers of "$EVAL_GIT" --version and --exec-path with PATH=/usr/bin:/bin,
// the exit code of "$EVAL_GIT" config --get worfy.probe with STUB_SYSTEM_CONFIG as the system
// gitconfig, and the files of the copy of git; it exits with the next code from STUB_CODES
// (comma-separated, one per call). STUB_LOCK: the first call makes the plugin copy read-only.
// STUB_HANG: the first call writes its pid there and waits a minute before it exits; with
// STUB_CATCH it exits 0 on a signal instead of being ended by it. STUB_AGGREGATE: every call writes
// this text as aggregate-result.json into its --output-dir, as claude plugin eval does; a JSON report
// that names neither its cases nor aggregates.casesTotal gets both, from the cases the call would run.
// The stub parses its arguments as claude does: nothing after a `--` is an option.
// STUB_VERSION_LOG: every `claude --version` appends a line there.
// The stub is one file of the repository, test/fixtures/eval-stub/claude.cjs; each test reaches it
// through a link. macOS checks every new executable before its first start (XprotectService, one
// file at a time): a stub written anew for each test waited in that queue, up to seconds under a loaded
// gate, and a test that runs eval-harness.mjs failed on time alone (worfy-polish 30 and 34).
export const STUB = join(REPO, 'test', 'fixtures', 'eval-stub', 'claude.cjs')

// eval-harness.mjs writes its copy of git into <evals>/results/ of the Harness it evaluates. The
// runs here evaluate a copy of harness/ in a temporary folder (HARNESS_DIR), so that nothing appears
// under harness/ while other tests copy that folder. One copy per test file.
let harnessCopy = ''
export const evaluated = (): string => {
  if (!harnessCopy) {
    harnessCopy = join(tempDir('worfy-eval-harness-', 'file'), 'harness')
    const results = join('evals', 'results')
    cpSync(HARNESS, harnessCopy, {
      recursive: true,
      filter: (path) => {
        const inside = relative(HARNESS, path)
        return inside !== results && !inside.startsWith(`${results}${sep}`)
      },
    })
  }
  return harnessCopy
}

/** A folder with the stub as `claude`, and the environment eval-harness.mjs runs with against it. */
export function stubSetup(
  version: string,
  codes: string,
  path: (home: string) => string,
  extra: NodeJS.ProcessEnv,
): { dir: string; log: string; env: NodeJS.ProcessEnv } {
  const dir = tempDir('worfy-eval-stub-')
  // Windows starts no script by its path: there the stand-in is a `.mjs`, which eval-harness.mjs
  // starts with its own Node, the way worfy starts a `.mjs` WORFY_CLAUDE (src/main/program.ts). The
  // stub is CommonJS, so the `.mjs` only loads it. On macOS and Linux the stub is started by its
  // path, as the real claude is: a link named claude to the stub of the repository.
  const claude = join(dir, process.platform === 'win32' ? 'claude.mjs' : 'claude')
  if (process.platform === 'win32') writeFileSync(claude, `import ${JSON.stringify(pathToFileURL(STUB).href)}\n`)
  else symlinkSync(STUB, claude)
  const log = join(dir, 'calls.log')
  const env = childEnv(dir, {
    PATH: path(dir),
    HARNESS_DIR: evaluated(),
    CLAUDE_BIN: claude,
    STUB_VERSION: version,
    STUB_CODES: codes,
    STUB_LOG: log,
    // A report that spent nothing: a call without a report counts its whole --max-cost-usd, and the
    // next call would get nothing. A test that wants no report sets STUB_AGGREGATE to ''.
    STUB_AGGREGATE: JSON.stringify({ claudeVersion: '2.1.289', costUsd: 0, partial: false, aggregates: { casesPassed: 0, overallScore: 0 } }),
    ...extra,
  })
  return { dir, log, env }
}
