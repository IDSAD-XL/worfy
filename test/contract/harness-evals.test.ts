// The eval cases of the Harness (harness/evals/, ticket worfy-harness/27) are run by
// `claude plugin eval` through `pnpm eval:harness`: by hand, on a Mac, against the owner's model
// account. This test is their free part and never starts claude: every case has the files
// `claude plugin eval` needs, every scaffold script builds its fixture in a temporary folder with a
// temporary HOME, the fixture is a project the Harness scripts recognise (bin/profile exit 0,
// epic-status sees four tickets), and the build leaves harness/evals/ out of the app's copy.
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { constants, homedir, tmpdir, userInfo } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const EVALS = join(HARNESS, 'evals')

// The ticket's table of cases; the tag decides which `claude plugin eval` call runs a case.
const CASES: [name: string, tag: 'main' | 'gui'][] = [
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
const SCAFFOLD_TIMEOUT_MS = 60_000

/**
 * The YAML front matter of a case or grader file, as raw text ('' when there is none). Lines may end
 * in CRLF: git for Windows checks harness/evals/ out with core.autocrlf, and the test reads the file
 * as git gives it on the machine. `field` trims the `\r` off a value.
 */
const frontMatter = (file: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
const field = (yaml: string, key: string): string | undefined =>
  new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(yaml)?.[1]?.trim().replace(/^['"]|['"]$/g, '')

const graderFiles = (name: string): string[] => {
  const dir = join(EVALS, name, 'graders')
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.md')).map((file) => join(dir, file)) : []
}

const temps: string[] = []
afterAll(() => {
  for (const dir of temps) removeTestTree(dir)
})
const tempDir = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

/**
 * The environment of every child this file gives a home: `vars`, and HOME and USERPROFILE in the
 * temporary `home`. Node on Windows takes its home from USERPROFILE and, without it, asks Windows
 * for the account's profile folder — the real one, where the owner's ~/.claude/worfy-harness and
 * ~/.claude/gate live. So a child with HOME alone would read and write the real Harness state there.
 * HOME and USERPROFILE go last: no caller's variables replace them.
 */
const childEnv = (home: string, vars: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...vars, HOME: home, USERPROFILE: home })

/** The environment of a scaffold script: PATH and TMPDIR of this process, and `extra`. */
const scaffoldEnv = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  childEnv(home, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), TERM: 'dumb', ...extra })

/**
 * Runs a case's scaffold script the way `claude plugin eval --scaffold` does: in an empty
 * workspace, with its home (HOME and USERPROFILE) in a temporary folder and a short fixed environment —
 * PATH, TMPDIR and TERM here; claude 2.1.289 also sets TMP, TEMP, GIT_CONFIG_NOSYSTEM, USER_TYPE and
 * NODE_ENV, and passes no EVAL_* (git in an empty HOME has no identity, so the fixture must not need one).
 */
function scaffold(
  name: string,
  extra: NodeJS.ProcessEnv | ((work: string, home: string) => NodeJS.ProcessEnv) = {},
  prepare: (work: string, home: string) => void = () => {},
): { work: string; home: string; run: SpawnSyncReturns<string> } {
  const root = tempDir('worfy-eval-')
  const work = join(root, 'work')
  const home = join(root, 'home')
  mkdirSync(work)
  mkdirSync(home)
  prepare(work, home)
  const script = field(readFileSync(join(EVALS, name, 'case.yaml'), 'utf8'), 'scaffold_script') ?? ''
  const run = spawnSync('bash', [join(EVALS, name, script)], {
    cwd: work,
    env: scaffoldEnv(home, typeof extra === 'function' ? extra(work, home) : extra),
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })
  return { work, home, run }
}

/**
 * The environment of a Harness script: the fixture's home, PATH, TMPDIR and LANG, and `extra`;
 * ELECTRON_RUN_AS_NODE, because the script runs under this process's Node (see `harness`).
 */
const harnessEnv = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  childEnv(home, {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG ?? 'C.UTF-8',
    ELECTRON_RUN_AS_NODE: '1',
    ...extra,
  })

/**
 * Runs a Harness script against a scaffolded fixture with only the fixture's home (and `extra`).
 * The scripts are Node scripts (`#!/usr/bin/env node`), started as `<this Node> <script>`: Windows
 * starts no script by its path, only .exe and .com.
 */
const harness = (home: string, cwd: string, script: string, args: string[], extra: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> =>
  spawnSync(process.execPath, [join(HARNESS, 'bin', script), ...args], {
    cwd,
    env: harnessEnv(home, extra),
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })

describe('harness/evals: the cases', () => {
  it('holds exactly the ten cases', () => {
    const found = existsSync(EVALS)
      ? readdirSync(EVALS, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(EVALS, entry.name, 'prompt.md')))
          .map((entry) => entry.name)
          .sort()
      : []
    expect(found).toEqual(CASES.map(([name]) => name).sort())
  })

  describe.each(CASES)('%s', (name, tag) => {
    it('has prompt.md with its tag and case.yaml with a scaffold script', () => {
      expect(existsSync(join(EVALS, name, 'prompt.md'))).toBe(true)
      expect(field(frontMatter(join(EVALS, name, 'prompt.md')), 'tags')).toBe(`[${tag}]`)
      const yaml = readFileSync(join(EVALS, name, 'case.yaml'), 'utf8')
      expect(field(yaml, 'schema_version')).toBe('1.1')
      expect(field(yaml, 'name')).toBe(name)
      const script = field(yaml, 'scaffold_script')
      expect(script).toBeTruthy()
      expect(existsSync(join(EVALS, name, script ?? ''))).toBe(true)
    })

    it('has at least two graders, one of them tool_used', () => {
      const types = graderFiles(name).map((file) => field(frontMatter(file), 'type'))
      expect(types.length).toBeGreaterThanOrEqual(2)
      expect(types).toContain('tool_used')
      for (const type of types) expect(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm']).toContain(type)
    })

    it('builds its fixture with exit code 0 in a temporary HOME', () => {
      const { work, home, run } = scaffold(name)
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
      expect(existsSync(join(work, '.git'))).toBe(true)
      expect(existsSync(join(home, '.claude', 'worfy-harness', 'projects', 'demo', 'profile.json'))).toBe(true)
    })
  })

  // A grader of the steps matches the command the skill prescribes today: the gate is gate.mjs since
  // the Harness scripts moved to Node (ADR-0055), and a grader that still looked for gate.sh failed a
  // run that followed the skill (2026-10-18).
  it('ship-ticket-local-green: the gate-fast grader matches the gate command of skills/ship-ticket', () => {
    const skill = readFileSync(join(HARNESS, 'skills', 'ship-ticket', 'SKILL.md'), 'utf8')
    const command = /`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/gate\.mjs" fast[^`]*)`/.exec(skill)?.[1] ?? ''
    expect(command).not.toBe('')
    const grader = frontMatter(join(EVALS, 'ship-ticket-local-green', 'graders', 'gate-fast.md'))
    const pattern = new RegExp(field(grader, 'input_match') ?? '<none>')
    expect(command.replace('${CLAUDE_PLUGIN_ROOT}', '/tmp/plugin/harness')).toMatch(pattern)
    expect('node /tmp/plugin/harness/hooks/gate.mjs full </dev/null').not.toMatch(pattern)
  })
})

// On Windows these need the paths of the fixture's gate registry ("match", "pm") in node's spelling,
// C:/…/work, not /tmp/…/work of Git Bash: harness/evals/lib/demo-project.sh writes them from node's
// realpathSync.native (worfy-windows ticket 65, step 4).
describe('harness/evals: the fixture is a project the Harness recognises', () => {
  it.each(CASES.map(([name]) => name))('%s: bin/profile -C <fixture> exits 0 with profile demo', (name) => {
    const { work, home, run } = scaffold(name)
    expect(run.status, run.stderr).toBe(0)
    const profile = harness(home, work, 'profile', ['-C', work, '--name'])
    expect(profile.status, profile.stderr).toBe(0)
    expect(profile.stdout.trim()).toBe('demo')
  })

  // pnpm eval:harness gives every run EVAL_HARNESS_HOME=worfy-harness, but `claude plugin eval`
  // starts the scaffold with a short fixed environment and no EVAL_* (claude 2.1.289): the fixture
  // never sees EVAL_HARNESS_HOME, and the scripts of the run must still find its state in <fixture>/.git.
  it.each(CASES.map(([name]) => name))('%s: a scaffold without EVAL_* leaves state the scripts of an eval:harness run find', (name) => {
    const { work, home, run } = scaffold(name)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(existsSync(join(work, '.git', 'worfy-harness', 'gate', 'config.json'))).toBe(true)
    const profile = harness(home, work, 'profile', ['-C', work, '--name'], { EVAL_HARNESS_HOME: 'worfy-harness' })
    expect(profile.status, profile.stderr).toBe(0)
    expect(profile.stdout.trim()).toBe('demo')
  })

  // The sandbox lets a run write only into its working folder, so the fixture keeps the Harness
  // state in its .git (ticket 28); a scaffold that does get EVAL_HARNESS_HOME (a run by hand) uses
  // the folder it names and nothing else — no copy in $HOME.
  it.each(CASES.map(([name]) => name))('%s: with EVAL_HARNESS_HOME the state goes to <fixture>/.git/worfy-harness', (name) => {
    const evalHome = { EVAL_HARNESS_HOME: 'worfy-harness' }
    const { work, home, run } = scaffold(name, evalHome)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(existsSync(join(work, '.git', 'worfy-harness', 'gate', 'config.json'))).toBe(true)
    expect(existsSync(join(work, '.git', 'worfy-harness', 'projects', 'demo', 'profile.json'))).toBe(true)
    expect(existsSync(join(home, '.claude'))).toBe(false)
    const profile = harness(home, work, 'profile', ['-C', work, '--name'], evalHome)
    expect(profile.status, profile.stderr).toBe(0)
    expect(profile.stdout.trim()).toBe('demo')
    expect(existsSync(join(home, '.claude'))).toBe(false)
  })

  it('without EVAL_HARNESS_HOME the state goes to $HOME/.claude/worfy-harness and <fixture>/.git/worfy-harness', () => {
    const { work, home, run } = scaffold('status-block')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(existsSync(join(home, '.claude', 'worfy-harness', 'gate', 'config.json'))).toBe(true)
    expect(readFileSync(join(home, '.claude', 'worfy-harness', 'projects', 'demo', 'profile.json'), 'utf8')).toBe(
      readFileSync(join(work, '.git', 'worfy-harness', 'projects', 'demo', 'profile.json'), 'utf8'),
    )
  })

  // A run gets no HARNESS_HOME; one set to a folder outside the fixture means a real shell, whose
  // home folder is likely the real one: the scaffold writes nothing at all.
  it.each(CASES.map(([name]) => name))('%s: refuses a HARNESS_HOME outside the fixture and writes nothing', (name) => {
    const elsewhere = join(tempDir('worfy-eval-hh-'), 'hh')
    const { work, home, run } = scaffold(name, { HARNESS_HOME: elsewhere })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(1)
    expect(run.stderr).toMatch(/HARNESS_HOME .* is outside the fixture/)
    expect(readdirSync(work)).toEqual([])
    expect(readdirSync(home)).toEqual([])
    expect(existsSync(join(home, '.claude'))).toBe(false)
    expect(existsSync(elsewhere)).toBe(false)
  })

  it('with EVAL_HARNESS_HOME and a HARNESS_HOME inside the fixture the state still goes to <fixture>/.git/worfy-harness', () => {
    const { work, home, run } = scaffold('status-block', (work) => ({ HARNESS_HOME: join(work, 'hh'), EVAL_HARNESS_HOME: 'worfy-harness' }))
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(existsSync(join(work, '.git', 'worfy-harness', 'gate', 'config.json'))).toBe(true)
    expect(existsSync(join(work, 'hh'))).toBe(false)
    expect(existsSync(join(home, '.claude'))).toBe(false)
  })

  // The guard of the fixture on its own: a HOME that is the user's real home folder (from the user
  // database, whatever HOME says) is refused. Only the guard runs here, so nothing can be written.
  it('state-guard.cjs refuses the real home folder and a HARNESS_HOME outside the fixture, and passes a temporary HOME', () => {
    const guard = join(EVALS, 'lib', 'state-guard.cjs')
    const work = tempDir('worfy-eval-guard-')
    const fake = tempDir('worfy-eval-guard-home-')
    const env = childEnv(fake, { PATH: process.env.PATH })
    const check = (home: string, extra: NodeJS.ProcessEnv = {}) =>
      spawnSync(process.env.npm_node_execpath ?? 'node', [guard, home, work], { env: { ...env, ...extra }, encoding: 'utf8' })
    const real = check(userInfo().homedir)
    expect(real.status, real.stderr).toBe(1)
    expect(real.stderr).toMatch(/is the real home folder of this user/)
    expect(check(fake).status).toBe(0)
    expect(check(fake, { HARNESS_HOME: join(fake, 'hh') }).status).toBe(1)
    expect(check(fake, { HARNESS_HOME: join(work, 'hh') }).status).toBe(0)
    // A HARNESS_HOME that does not exist yet, spelled through another name of the fixture (a link
    // here; an 8.3 short name on Windows, /var for /private/var on macOS), is still inside it.
    const alias = join(tempDir('worfy-eval-guard-alias-'), 'work')
    symlinkSync(work, alias, 'junction')
    expect(check(fake, { HARNESS_HOME: join(alias, 'hh') }).status).toBe(0)
    expect(readdirSync(work)).toEqual([])
    expect(readdirSync(fake)).toEqual([])
  })

  // A stub loaded into every node the scaffold starts makes os.userInfo().homedir name a temporary
  // folder, so the real-home refusal can be tested end to end without the real home.
  const fakeRealHome = (): { stub: NodeJS.ProcessEnv; realHome: string } => {
    const dir = tempDir('worfy-eval-userinfo-')
    const stub = join(dir, 'userinfo-stub.cjs')
    writeFileSync(
      stub,
      "const os = require('node:os'); const original = os.userInfo; os.userInfo = (options) => ({ ...original(options), homedir: process.env.EVAL_TEST_REAL_HOME })\n",
    )
    const realHome = realpathSync(tempDir('worfy-eval-realhome-'))
    return { stub: { NODE_OPTIONS: `--require ${stub}`, EVAL_TEST_REAL_HOME: realHome }, realHome }
  }

  it('the scaffold refuses a HOME that is the real home folder and writes nothing there', () => {
    const { stub, realHome } = fakeRealHome()
    const work = tempDir('worfy-eval-realhome-work-')
    const run = spawnSync('bash', [join(EVALS, 'status-block', 'scaffold.sh')], {
      cwd: work,
      env: childEnv(realHome, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), TERM: 'dumb', ...stub }),
      encoding: 'utf8',
      timeout: SCAFFOLD_TIMEOUT_MS,
    })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(1)
    expect(run.stderr).toMatch(/is the real home folder of this user/)
    expect(existsSync(join(realHome, '.claude', 'worfy-harness', 'gate'))).toBe(false)
    expect(existsSync(join(realHome, '.claude', 'worfy-harness', 'projects'))).toBe(false)
    expect(readdirSync(realHome)).toEqual([])
    expect(readdirSync(work)).toEqual([])
  })

  it('state-guard.cjs refuses the real home folder through a link to it', () => {
    const { stub, realHome } = fakeRealHome()
    const link = join(tempDir('worfy-eval-link-'), 'home')
    symlinkSync(realHome, link)
    const run = spawnSync(process.env.npm_node_execpath ?? 'node', [join(EVALS, 'lib', 'state-guard.cjs'), link, tempDir('worfy-eval-guard-')], {
      env: { PATH: process.env.PATH, ...stub },
      encoding: 'utf8',
    })
    expect(run.status, run.stderr).toBe(1)
    expect(run.stderr).toMatch(/is the real home folder of this user/)
  })

  // macOS volumes are case-insensitive by default: /USERS/X is the folder /Users/x. Where the volume
  // is case-sensitive (Linux CI) the other spelling is another, missing folder, and nothing to test.
  const { realHome: caseHome } = fakeRealHome()
  it.skipIf(!existsSync(caseHome.toUpperCase()))('state-guard.cjs refuses the real home folder spelled in another case', () => {
    const { stub, realHome } = fakeRealHome()
    const run = spawnSync(process.env.npm_node_execpath ?? 'node', [join(EVALS, 'lib', 'state-guard.cjs'), realHome.toUpperCase(), tempDir('worfy-eval-guard-')], {
      env: { PATH: process.env.PATH, ...stub },
      encoding: 'utf8',
    })
    expect(run.status, run.stderr).toBe(1)
    expect(run.stderr).toMatch(/is the real home folder of this user/)
  })

  it.each([
    ['$HOME/.claude/worfy-harness', {}, (work: string, home: string) => join(home, '.claude', 'worfy-harness')],
    ['<fixture>/.git/worfy-harness', { EVAL_HARNESS_HOME: 'worfy-harness' }, (work: string) => join(work, '.git', 'worfy-harness')],
  ] as const)('refuses a state folder %s that already has a gate registry and leaves it as it was', (_, extra, state) => {
    const registry = '{"repos": [{"key": "owner", "match": "/somewhere/else"}]}\n'
    let config = ''
    const { run } = scaffold('status-block', extra, (work, home) => {
      config = join(state(work, home), 'gate', 'config.json')
      mkdirSync(dirname(config), { recursive: true })
      writeFileSync(config, registry)
    })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(1)
    expect(run.stderr).toMatch(/already has a gate registry/)
    expect(readFileSync(config, 'utf8')).toBe(registry)
    expect(existsSync(join(dirname(dirname(config)), 'projects'))).toBe(false)
  })

  // npm cannot run in an eval run on this Mac: node and npm come from nvm, and npm's own files lie
  // outside PATH in the home folder, which the sandbox does not let a run read. The gate of the
  // fixture starts a package manager of its own, kept inside the fixture.
  it('the gate of the fixture needs no npm: its package manager is a script inside the fixture, and gate fast is green', () => {
    const evalHome = { EVAL_HARNESS_HOME: 'worfy-harness' }
    const { work, home, run } = scaffold('status-block')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const registry = JSON.parse(readFileSync(join(work, '.git', 'worfy-harness', 'gate', 'config.json'), 'utf8')) as { repos: { pm: string }[] }
    const pm = registry.repos[0]?.pm ?? ''
    expect(existsSync(pm), pm).toBe(true)
    // Both sides in the long spelling: `work` keeps an 8.3 short name of TEMP (the runner's
    // C:\Users\RUNNER~1) that the fixture's `pm` does not. Across drives `relative` gives an
    // absolute path, not `..`, so that counts as outside too.
    const inside = relative(realpathSync.native(work), realpathSync.native(pm))
    expect(inside.startsWith('..') || isAbsolute(inside), pm).toBe(false)
    const gate = spawnSync(process.env.npm_node_execpath ?? 'node', [join(HARNESS, 'hooks', 'gate.mjs'), 'fast'], {
      cwd: work,
      env: childEnv(home, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'C.UTF-8', GATE_SCOPE: 'all', ...evalHome }),
      encoding: 'utf8',
      input: '',
      timeout: SCAFFOLD_TIMEOUT_MS,
    })
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0)
    expect(`${gate.stdout}${gate.stderr}`).toMatch(/\[gate\] зелено \(fast\)/)
  })

  // The same package manager reports failing tests: on the reviewer fixture, whose commit breaks
  // sum, gate fast is red.
  it('gate fast of the fixture is red (exit 2) when its tests fail', () => {
    const { work, home, run } = scaffold('reviewer-verdict')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const gate = spawnSync(process.env.npm_node_execpath ?? 'node', [join(HARNESS, 'hooks', 'gate.mjs'), 'fast'], {
      cwd: work,
      env: childEnv(home, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'C.UTF-8', GATE_SCOPE: 'all', EVAL_HARNESS_HOME: 'worfy-harness' }),
      encoding: 'utf8',
      input: '',
      timeout: SCAFFOLD_TIMEOUT_MS,
    })
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(2)
  })

  it('epic-status sees the four tickets of epic demo', () => {
    const { work, home } = scaffold('status-block')
    const status = harness(home, work, 'epic-status', ['--json'])
    expect(status.status, status.stderr).toBe(0)
    const tickets = (JSON.parse(status.stdout) as { tickets: { epic: string }[] }).tickets.filter((t) => t.epic === 'demo')
    expect(tickets).toHaveLength(4)
    const line = harness(home, work, 'epic-status', ['demo'])
    expect(line.status, line.stderr).toBe(0)
    expect(line.stdout).toMatch(/demo 0\/4/)
  })
})

// The fixture's own commands, with the fixture's home and no Electron variables.
const fixtureEnv = (home: string): NodeJS.ProcessEnv => childEnv(home, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir() })
const inFixture = (home: string, cwd: string, command: string, args: string[]): SpawnSyncReturns<string> =>
  spawnSync(command, args, {
    cwd,
    env: fixtureEnv(home),
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })

describe('harness/evals: reviewer-intended-breakage is the diff the case describes', () => {
  it('removes the check the ticket removes on purpose, and hides a rounding defect behind green tests', () => {
    const { work, home, run } = scaffold('reviewer-intended-breakage')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const git = (...args: string[]): string => inFixture(home, work, 'git', args).stdout

    // The reviewer is pointed at origin/main...HEAD on the ticket's branch.
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('demo/01')
    expect(git('status', '--porcelain')).toBe('')
    const diff = git('diff', 'origin/main...HEAD', '--', 'src/percent.mjs')
    expect(diff).toMatch(/^-\s+if \(total === 0\) throw new RangeError/m)
    expect(diff).toMatch(/^\+\s+return Math\.floor\(/m)
    expect(git('diff', '--name-only', 'origin/main...HEAD').trim().split('\n').sort()).toEqual([
      '.scratch/demo/issues/01-alpha.md',
      'src/percent.mjs',
      'test/percent.test.mjs',
    ])

    // The removal is intended only because the ticket says so, and says so on the base branch: the
    // branch adds nothing to the ticket but its status. The only caller handles zero itself.
    const ticket = git('show', 'origin/main:.scratch/demo/issues/01-alpha.md')
    expect(ticket).toContain('Проверку `total === 0` убираем намеренно')
    const ticketDiff = git('diff', 'origin/main...HEAD', '--', '.scratch/demo/issues/01-alpha.md')
    expect(ticketDiff.split('\n').filter((line) => /^[+-][^+-]/.test(line))).toEqual([
      '-Status: open',
      '+Status: claimed 2026-10-01T09:00Z',
    ])
    expect(ticket).toContain('`percent(2, 3)` —\n  `66.7`')
    expect(readFileSync(join(work, 'src', 'report.mjs'), 'utf8')).toContain("total === 0 ? '—'")

    // The real defect: the branch's tests are green, yet percent(2, 3) is 66.6, not the ticket's 66.7.
    const tests = inFixture(home, work, 'node', ['--test'])
    expect(tests.status, `${tests.stdout}\n${tests.stderr}`).toBe(0)
    const value = inFixture(home, work, 'node', [
      '--input-type=module',
      '-e',
      "import { percent } from './src/percent.mjs'; console.log(percent(2, 3), percent(1, 0))",
    ])
    expect(value.stdout.trim()).toBe('66.6 Infinity')
  })
})

describe('harness/evals: reviewer-simplification is the diff the case describes', () => {
  // Windows: 26.5 s in a full run on the PC (2026-10-19), sync, overran its 15 s limit; twice that.
  it('adds a thin wrapper over an existing helper, and two near-copies under a shortcut comment', () => {
    const { work, home, run } = scaffold('reviewer-simplification')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const git = (...args: string[]): string => inFixture(home, work, 'git', args).stdout

    // The reviewer is pointed at origin/main...HEAD on the ticket's branch, with the Profile's name of the lens.
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('demo/01')
    expect(git('status', '--porcelain')).toBe('')
    expect(git('diff', '--name-only', 'origin/main...HEAD').trim().split('\n').sort()).toEqual([
      '.scratch/demo/issues/01-alpha.md',
      'src/export.mjs',
      'test/export.test.mjs',
    ])
    expect(readFileSync(join(EVALS, 'reviewer-simplification', 'prompt.md'), 'utf8')).toContain('одной линзой «упрощение»')

    // The finding: durationText only passes its argument on to a helper the base branch already has.
    expect(git('show', 'origin/main:src/duration.mjs')).toContain('export function formatDuration(ms)')
    const source = readFileSync(join(work, 'src', 'export.mjs'), 'utf8')
    expect(source).toContain('function durationText(ms) {\n  return formatDuration(ms)\n}')
    // The ticket asks for neither the wrapper nor the two copies: both are the implementer's own choice.
    const ticket = git('show', 'origin/main:.scratch/demo/issues/01-alpha.md')
    expect(ticket).not.toMatch(/durationText|shortcut/)

    // Not a finding: the two copies stand under a comment of the form `shortcut: <limit>, <when to redo>`,
    // and its condition — a third format — is not met: the file exports two.
    const comments = source.split('\n').filter((line) => line.includes('shortcut:'))
    expect(comments).toEqual(['// shortcut: no more than two formats with a copy of the join each, redo when a third format appears'])
    expect([...source.matchAll(/^export function (\w+)/gm)].map((match) => match[1])).toEqual(['csvLine', 'tsvLine'])
    expect(source).toContain("durationText(task.ms)].join(',')")
    expect(source).toContain("durationText(task.ms)].join('\\t')")

    // The change itself works: a reviewer has nothing to report but its shape.
    const tests = inFixture(home, work, 'node', ['--test'])
    expect(tests.status, `${tests.stdout}\n${tests.stderr}`).toBe(0)
  }, process.platform === 'win32' ? 53_000 : undefined)
})

// A stand-in for claude: prints STUB_VERSION for --version; for every other call appends to
// STUB_LOG its arguments, what the target plugin folder holds (manifest, eval folder), PATH, the
// EVAL_* variables, the answers of "$EVAL_GIT" --version and --exec-path with PATH=/usr/bin:/bin,
// the exit code of "$EVAL_GIT" config --get worfy.probe with STUB_SYSTEM_CONFIG as the system
// gitconfig, and the files of the copy of git; it exits with the next code from STUB_CODES
// (comma-separated, one per call). STUB_LOCK: the first call makes the plugin copy read-only.
// STUB_HANG: the first call writes its pid there and waits a minute before it exits; with
// STUB_CATCH it exits 0 on a signal instead of being ended by it.
const STUB = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log(process.env.STUB_VERSION + ' (Claude Code)'); process.exit(0) }
const log = process.env.STUB_LOG
const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0
const manifest = JSON.parse(readFileSync(join(args[2], '.claude-plugin', 'plugin.json'), 'utf8'))
const evals = readdirSync(join(args[2], 'evals'))
const evalGit = process.env.EVAL_GIT || ''
// Windows starts no #!/bin/sh script by its path: there sh runs the wrapper, with the PATH of the run,
// through which the copied git.exe loads its DLLs; git prints its exec path with forward slashes.
const windows = process.platform === 'win32'
const runGit = (gitArgs, env = {}) => windows
  ? spawnSync('sh', [evalGit, ...gitArgs], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
  : spawnSync(evalGit, gitArgs, { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } })
const version = evalGit ? runGit(['--version']) : null
const execPathOut = evalGit ? runGit(['--exec-path']).stdout.trim() : ''
const execPath = windows && execPathOut ? resolve(execPathOut) : execPathOut
const systemConfig = evalGit && process.env.STUB_SYSTEM_CONFIG
  ? runGit(['config', '--get', 'worfy.probe'], { GIT_CONFIG_SYSTEM: process.env.STUB_SYSTEM_CONFIG, GIT_CONFIG_GLOBAL: '/dev/null' }).status
  : null
const core = evalGit ? join(dirname(evalGit), 'git-core') : ''
// On Windows the names of the commands, without .exe: git.exe is the command git.
const gitFiles = core && existsSync(core) ? readdirSync(core).map((file) => (windows ? file.replace(/\\.exe$/, '') : file)) : []
appendFileSync(log, JSON.stringify({
  args, manifest, evals, path: process.env.PATH, evalGit, evalHarnessHome: process.env.EVAL_HARNESS_HOME ?? null,
  gitVersion: version ? { status: version.status, stdout: version.stdout } : null, execPath, systemConfig, gitFiles,
}) + '\\n')
if (process.env.STUB_LOCK && calls === 0) chmodSync(args[2], 0o555)
const code = Number((process.env.STUB_CODES || '0').split(',')[calls] || 0)
if (process.env.STUB_HANG && calls === 0) {
  // STUB_CATCH: the stub catches the signal and exits 0, as a claude that ends cleanly on Ctrl-C.
  if (process.env.STUB_CATCH) for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0))
  writeFileSync(process.env.STUB_HANG, String(process.pid))
  setTimeout(() => process.exit(code), 60000)
} else process.exit(code)
`

interface StubCall {
  args: string[]
  manifest: Record<string, unknown>
  evals: string[]
  path: string
  evalGit: string
  evalHarnessHome: string | null
  gitVersion: { status: number | null; stdout: string } | null
  execPath: string
  systemConfig: number | null
  gitFiles: string[]
}

// eval-harness.mjs writes its copy of git into <evals>/results/ of the Harness it evaluates. The
// runs here evaluate a copy of harness/ in a temporary folder (HARNESS_DIR), so that nothing appears
// under harness/ while other tests copy that folder.
let harnessCopy = ''
const evaluated = (): string => {
  if (!harnessCopy) {
    harnessCopy = join(tempDir('worfy-eval-harness-'), 'harness')
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
function stubSetup(
  version: string,
  codes: string,
  path: (home: string) => string,
  extra: NodeJS.ProcessEnv,
): { dir: string; log: string; env: NodeJS.ProcessEnv } {
  const dir = tempDir('worfy-eval-stub-')
  // Windows starts no script by its path: there the stand-in is a `.mjs`, which eval-harness.mjs
  // starts with its own Node, the way worfy starts a `.mjs` WORFY_CLAUDE (src/main/program.ts). The
  // stub is CommonJS, so the `.mjs` only loads it. On macOS and Linux the stub is started by its
  // path, as the real claude is.
  const claude = join(dir, process.platform === 'win32' ? 'claude.mjs' : 'claude')
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'claude.cjs'), STUB)
    writeFileSync(claude, "import './claude.cjs'\n")
  } else {
    writeFileSync(claude, STUB)
    chmodSync(claude, 0o755)
  }
  const log = join(dir, 'calls.log')
  const env = childEnv(dir, {
    PATH: path(dir),
    ELECTRON_RUN_AS_NODE: '1',
    HARNESS_DIR: evaluated(),
    CLAUDE_BIN: claude,
    STUB_VERSION: version,
    STUB_CODES: codes,
    STUB_LOG: log,
    ...extra,
  })
  return { dir, log, env }
}

const loggedCalls = (log: string): StubCall[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StubCall)
    : []

const EVAL_HARNESS = join(REPO, 'scripts', 'eval-harness.mjs')

/** Runs scripts/eval-harness.mjs against the stub; returns the run and the logged eval calls. */
function evalHarness(
  version: string,
  codes: string,
  args: string[] = [],
  path: (home: string) => string = () => process.env.PATH ?? '',
  extra: NodeJS.ProcessEnv = {},
): { run: SpawnSyncReturns<string>; calls: StubCall[] } {
  const { log, env } = stubSetup(version, codes, path, extra)
  const run = spawnSync(process.execPath, [EVAL_HARNESS, ...args], { env, encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS })
  return { run, calls: loggedCalls(log) }
}

/** The copies of git eval-harness.mjs has left in the results folder of the Harness it evaluates. */
const gitCopies = (): string[] => {
  const results = join(evaluated(), 'evals', 'results')
  return existsSync(results) ? readdirSync(results).filter((dir) => dir.endsWith('-git')) : []
}

/**
 * A folder first on PATH whose `git` prints `core` for --exec-path and fails for anything else. On
 * Windows eval-harness.mjs finds it through `sh`; the PATH lookup of Windows itself takes git.exe.
 */
const fakeGitPath = (dir: string, core: string): string => {
  const bin = join(dir, 'fake-git')
  mkdirSync(bin)
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = --exec-path ]; then echo '${core}'; exit 0; fi\nexit 1\n`)
  chmodSync(join(bin, 'git'), 0o755)
  return [bin, process.env.PATH ?? ''].join(delimiter)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
// chmod has no say on Windows, and root reads and removes whatever it likes.
const permissionsHold = process.platform !== 'win32' && process.getuid?.() !== 0

const readManifestOf = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>

/** The values of a variadic option: everything after it up to the next option. */
const listAfter = (args: string[], option: string): string[] => {
  const from = args.indexOf(option) + 1
  const end = args.findIndex((arg, i) => i >= from && arg.startsWith('--'))
  return args.slice(from, end === -1 ? undefined : end)
}

// Every child of this file that runs a scaffold script, a Harness script, git in a fixture or
// eval-harness.mjs with the claude stub gets its home from childEnv. A child that saw the owner's
// real home would read the real Harness registry in ~/.claude/worfy-harness and ~/.claude/gate, and
// a Harness script that writes would write there (worfy-windows ticket 65). The tests' own git calls
// that read the repository (the control `git --exec-path` and `git check-ignore`) run the real git
// with this process's environment and write nothing.
describe('a child process sees the temporary home', () => {
  // The variables of a caller that names a home of its own: the real one. Built from names, so the
  // scan below (no HOME or USERPROFILE key outside childEnv) does not count them.
  const foreignHome = (): NodeJS.ProcessEnv => Object.fromEntries(['HOME', 'USERPROFILE'].map((name) => [name, homedir()]))
  // startsNode: the environment starts this process's executable, which under Electron needs
  // ELECTRON_RUN_AS_NODE to run as Node and not as an app window that never exits.
  const launchers: [name: string, env: (home: string) => NodeJS.ProcessEnv, startsNode: boolean][] = [
    ['scaffold', (home) => scaffoldEnv(home), false],
    ['scaffold, a caller with its own home', (home) => scaffoldEnv(home, foreignHome()), false],
    ['harness', (home) => harnessEnv(home), true],
    ['harness, a caller with its own home', (home) => harnessEnv(home, foreignHome()), true],
    ['inFixture', (home) => fixtureEnv(home), false],
    ['the claude stub', () => stubSetup('2.1.289', '0,0', () => process.env.PATH ?? '', {}).env, true],
    ['the claude stub, a caller with its own home', () => stubSetup('2.1.289', '0,0', () => process.env.PATH ?? '', foreignHome()).env, true],
  ]
  const insideTemp = (dir: string | undefined): boolean => {
    const inside = relative(realpathSync(tmpdir()), dir ?? '')
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
  }

  it.each(launchers)('%s: USERPROFILE is HOME, in a temporary folder', (_, envOf) => {
    const env = envOf(tempDir('worfy-eval-home-'))
    expect(insideTemp(env.HOME), String(env.HOME)).toBe(true)
    expect(env.USERPROFILE).toBe(env.HOME)
  })

  it.each(launchers.filter(([, , startsNode]) => startsNode))('%s: runs this process as Node (ELECTRON_RUN_AS_NODE=1)', (_, envOf) => {
    expect(envOf(tempDir('worfy-eval-home-')).ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it.each(launchers)('%s: a Node child takes the temporary home for os.homedir()', (_, envOf, startsNode) => {
    const env = envOf(tempDir('worfy-eval-home-'))
    // A launcher that starts this process's executable is used as it is: adding the variable here
    // would hide its loss.
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'], {
      env: startsNode ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: SCAFFOLD_TIMEOUT_MS,
    })
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toBe(env.HOME)
    expect(child.stdout).not.toBe(homedir())
  })

  // A new spawn that writes its own home past childEnv, or that names no environment and so passes
  // on the real home, makes this test red.
  it('every spawn and spawnSync of this file names its environment, and only childEnv names a home', () => {
    const source = readFileSync(__filename, 'utf8')
    const lineOf = (index: number): string => source.slice(source.lastIndexOf('\n', index) + 1, source.indexOf('\n', index))
    const helper = lineOf(source.indexOf('const childEnv = '))
    expect(helper).toMatch(/\bHOME: home\b/)
    expect(helper).toMatch(/\bUSERPROFILE: home\b/)
    // A key HOME or USERPROFILE anywhere but in childEnv.
    const keys = [...source.matchAll(/(?<![\w$])(?:HOME|USERPROFILE)\s*:/g)].map((match) => lineOf(match.index)).filter((line) => line !== helper)
    expect(keys).toEqual([])
    // A spawn or spawnSync call that names HOME or USERPROFILE itself.
    const calls: string[] = []
    // A call starts with a quote or a name, maybe on the next line: the pattern below is no call.
    for (const match of source.matchAll(/\bspawn(?:Sync)?\((?=\s*['"\w])/g)) {
      let depth = 0
      let end = match.index + match[0].length - 1
      for (; end < source.length; end++) {
        if (source[end] === '(') depth++
        else if (source[end] === ')' && --depth === 0) break
      }
      calls.push(source.slice(match.index, end + 1))
    }
    expect(calls.length).toBeGreaterThan(5)
    expect(calls.filter((call) => /(?<![\w$])(?:HOME|USERPROFILE)(?![\w$])/.test(call))).toEqual([])
    // A call that names no environment, or hands on this process's own, passes on the real home. The
    // exceptions are the tests' own read-only git calls in the repository; each must still exist.
    const readOnlyGit = [/^spawnSync\('git', \['--exec-path'\], \{ encoding: 'utf8' \}\)$/, /^spawnSync\('git', \['check-ignore', '-q', .*\], \{ cwd: REPO \}\)$/]
    for (const known of readOnlyGit) expect(calls.filter((call) => known.test(call)), String(known)).toHaveLength(1)
    const own = calls.filter((call) => !readOnlyGit.some((known) => known.test(call)))
    expect(own.filter((call) => !/[{,]\s*env\s*[:,}]/.test(call) || /\benv\s*:\s*process\.env\b|\.\.\.process\.env\b/.test(call))).toEqual([])
  })
})

describe('pnpm eval:harness (scripts/eval-harness.mjs, claude replaced by a stub)', () => {
  it('refuses with exit code 1 on claude older than 2.1.269 and runs nothing', () => {
    const { run, calls } = evalHarness('2.1.268', '0,0')
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/2\.1\.269/)
    expect(calls).toEqual([])
  })

  it('makes two calls with the flags of the ticket and a narrow Bash for the gui case', () => {
    const { run, calls: logged } = evalHarness('2.1.289', '0,0')
    expect(run.status, run.stderr).toBe(0)
    expect(logged).toHaveLength(2)
    const calls = logged.map((call) => call.args)
    for (const args of calls) {
      expect(args.slice(0, 2)).toEqual(['plugin', 'eval'])
      for (const flag of ['--scaffold', '--trust-plugin', '--no-publish']) expect(args).toContain(flag)
      expect(listAfter(args, '--ablation')).toEqual(['none'])
      expect(listAfter(args, '--threshold')).toEqual(['0.8'])
      expect(listAfter(args, '--max-cost-usd')).toEqual(['30'])
      expect(listAfter(args, '--model')).toHaveLength(1)
      expect(listAfter(args, '--judge-model')).toHaveLength(1)
    }
    const [main = [], gui = []] = calls
    expect(listAfter(main, '--tag')).toEqual(['main'])
    expect(listAfter(main, '--allow-tools')).toEqual(['Bash', 'Write', 'Edit'])
    expect(listAfter(gui, '--tag')).toEqual(['gui'])
    const guiGrants = listAfter(gui, '--allow-tools')
    expect(guiGrants).not.toContain('Bash')
    expect(guiGrants.filter((grant) => grant.startsWith('Bash(')).length).toBeGreaterThan(0)
    expect(guiGrants.filter((grant) => grant.includes(main[2] ?? '<no target>'))).not.toEqual([])
    // Claude Code checks each part of a compound command against the rules, and does not let
    // `echo "EXIT=$?"` or `set -o pipefail` through on its own (claude 2.1.289, dontAsk mode). The
    // Harness asks for both around every check, so without these two the gui case cannot run one.
    // The whole list: any wider rule (Bash(*), Bash(sh *), Bash(bash *)) would let a screen capture run.
    const target = main[2] ?? '<no target>'
    expect(guiGrants).toEqual([
      'Bash(git *)',
      'Bash(node *)',
      `Bash(${target}/bin/*)`,
      `Bash("${target}/bin/*)`,
      `Bash(${target}/hooks/*)`,
      `Bash("${target}/hooks/*)`,
      `Bash(bash ${target}/hooks/*)`,
      `Bash(bash "${target}/hooks/*)`,
      'Bash(echo *)',
      'Bash(set -o pipefail)',
      'Write',
      'Edit',
    ])
    expect(run.stdout).toContain(join('harness', 'evals', 'results'))
    expect(run.stdout).toMatch(/aggregate-result\.json/)
    expect(run.stdout).toMatch(/report\.html/)
  })

  it('evaluates a removed copy of harness/ whose manifest has no dependencies', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0')
    expect(run.status, run.stderr).toBe(0)
    const [first, second] = calls
    if (!first || !second) throw new Error(`expected two eval calls, got ${calls.length}`)
    const target = first.args[2] ?? ''
    expect(target).not.toBe(HARNESS)
    expect(second.args[2]).toBe(target)
    // Claude Code refuses a plugin whose dependency is not installed, and a run installs none.
    expect(readManifestOf(HARNESS)).toHaveProperty('dependencies')
    expect(first.manifest).not.toHaveProperty('dependencies')
    expect(first.manifest.name).toBe('worfy')
    expect(first.evals).toEqual(expect.arrayContaining(CASES.map(([name]) => name)))
    expect(first.evals).not.toContain('results')
    expect(existsSync(target)).toBe(false)
  })

  it('keeps other Harness copies off the PATH of the run', () => {
    const others = (home: string): string[] => [
      join(home, '.claude', 'bin'),
      join(home, '.claude', 'worfy-harness', 'plugin', 'bin'),
      '/Users/x/Applications/worfy-stable.app/Contents/Resources/harness/bin',
    ]
    let home = ''
    const { run, calls } = evalHarness('2.1.289', '0,0', [], (dir) => {
      home = dir
      return [...others(dir), process.env.PATH ?? ''].join(delimiter)
    })
    expect(run.status, run.stderr).toBe(0)
    const path = (calls[0]?.path ?? '').split(delimiter)
    for (const dir of others(home)) expect(path).not.toContain(dir)
    expect(path).toEqual(expect.arrayContaining((process.env.PATH ?? '').split(delimiter).filter((dir) => !/(harness|worfy-harness[\\/]plugin)[\\/]bin$/.test(dir))))
  })

  // The sandbox of a run refuses the git of Command Line Tools next to its git-credential-*, and reads
  // every folder of PATH (ticket 28).
  it('gives the runs a copy of git without credential helpers, first on PATH, and removes it after', () => {
    const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim()
    expect(readdirSync(exec).filter((file) => file.startsWith('git-credential'))).not.toEqual([])
    // An earlier result next to the copy: only the copy goes.
    const earlier = join(evaluated(), 'evals', 'results', '2026-01-01T00-00-00-000Z-main')
    mkdirSync(earlier, { recursive: true })
    writeFileSync(join(earlier, 'aggregate-result.json'), '{}\n')
    // A system gitconfig with a key: the git of the runs must not read it (the one of Command Line
    // Tools sets credential.helper osxkeychain). The real git reads it, so the check means something.
    const systemConfig = join(tempDir('worfy-eval-gitconfig-'), 'gitconfig')
    writeFileSync(systemConfig, '[worfy]\n\tprobe = system\n')
    const control = spawnSync('git', ['config', '--get', 'worfy.probe'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GIT_CONFIG_SYSTEM: systemConfig, GIT_CONFIG_GLOBAL: '/dev/null' },
    })
    expect(control.stdout.trim(), control.stderr).toBe('system')
    const { run, calls } = evalHarness('2.1.289', '0,0', [], undefined, { STUB_SYSTEM_CONFIG: systemConfig })
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(2)
    const [first, second] = calls
    if (!first || !second) throw new Error(`expected two eval calls, got ${calls.length}`)
    expect(first.evalGit).not.toBe('')
    expect(first.path.split(delimiter)[0]).toBe(dirname(first.evalGit))
    expect(first.evalGit.startsWith(join(evaluated(), 'evals', 'results') + sep)).toBe(true)
    expect(first.gitVersion?.status, JSON.stringify(first.gitVersion)).toBe(0)
    expect(first.gitVersion?.stdout).toMatch(/^git version /)
    expect(first.execPath).toBe(join(dirname(first.evalGit), 'git-core'))
    expect(first.systemConfig).toBe(1)
    expect(first.gitFiles).toContain('git')
    expect(first.gitFiles.filter((file) => file.startsWith('git-credential'))).toEqual([])
    expect(first.evalHarnessHome).toBe('worfy-harness')
    expect(second.evalGit).toBe(first.evalGit)
    expect(existsSync(dirname(first.evalGit))).toBe(false)
    expect(existsSync(join(earlier, 'aggregate-result.json'))).toBe(true)
  })

  it('exits 1 and calls no claude when `git --exec-path` gives no folder', () => {
    const before = gitCopies()
    const { run, calls } = evalHarness('2.1.289', '0,0', [], (dir) => {
      const gitStubDir = join(dir, 'failing-git')
      mkdirSync(gitStubDir)
      writeFileSync(join(gitStubDir, 'git'), '#!/bin/sh\nexit 1\n')
      chmodSync(join(gitStubDir, 'git'), 0o755)
      return [gitStubDir, process.env.PATH ?? ''].join(delimiter)
    })
    expect(run.status).toBe(1)
    // Exit 1 is the failing git's own answer; on Windows, a lookup that could not start it (no `sh`
    // on PATH) would stop at ENOENT and make this test pass for that wrong reason.
    expect(run.stderr).toMatch(/git --exec-path.*exit 1\)/)
    expect(calls).toEqual([])
    expect(gitCopies()).toEqual(before)
  })

  it('exits 1, calls no claude and removes the copy when the copy of git does not answer --version', () => {
    const before = gitCopies()
    const core = join(tempDir('worfy-eval-core-'), 'git-core')
    mkdirSync(core)
    writeFileSync(join(core, 'git'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(core, 'git'), 0o755)
    const { run, calls } = evalHarness('2.1.289', '0,0', [], (dir) => fakeGitPath(dir, core))
    expect(run.status).toBe(1)
    // Exit 1 is the copy's own answer; on Windows, a check that started the `#!/bin/sh` wrapper by
    // its path, not through sh, would stop at ENOENT and make this test pass for that wrong reason.
    expect(run.stderr).toMatch(/the copy of git does not run \(.* --version, exit 1\)/)
    expect(calls).toEqual([])
    expect(gitCopies()).toEqual(before)
  })

  it.skipIf(!permissionsHold)('exits 1, calls no claude and removes the copy when a file of git cannot be copied', () => {
    const before = gitCopies()
    const core = join(tempDir('worfy-eval-core-'), 'git-core')
    mkdirSync(core)
    writeFileSync(join(core, 'git'), '#!/bin/sh\necho git version 0\n')
    chmodSync(join(core, 'git'), 0o755)
    writeFileSync(join(core, 'git-unreadable'), 'x')
    chmodSync(join(core, 'git-unreadable'), 0o000)
    try {
      const { run, calls } = evalHarness('2.1.289', '0,0', [], (dir) => fakeGitPath(dir, core))
      expect(run.status).toBe(1)
      expect(run.stderr).toMatch(/cannot copy/)
      expect(calls).toEqual([])
      expect(gitCopies()).toEqual(before)
    } finally {
      chmodSync(join(core, 'git-unreadable'), 0o644)
    }
  })

  it.skipIf(!permissionsHold)('removes the copy of git when removing the copy of the plugin throws', () => {
    const before = gitCopies()
    const { run, calls } = evalHarness('2.1.289', '0,0', [], undefined, { STUB_LOCK: '1' })
    const target = calls[0]?.args[2] ?? ''
    try {
      expect(calls).toHaveLength(2)
      expect(run.status).toBe(1)
      expect(run.stderr).toMatch(/ENOTEMPTY|EACCES|EPERM/)
      expect(existsSync(target)).toBe(true)
      expect(existsSync(dirname(calls[0]?.evalGit ?? ''))).toBe(false)
      expect(gitCopies()).toEqual(before)
    } finally {
      if (target && existsSync(target)) {
        chmodSync(target, 0o755)
        removeTestTree(dirname(target))
      }
    }
  })

  // A signal reaches the whole process group: claude ends, or catches it and exits 0;
  // eval-harness.mjs stays to remove its copies, starts no gui call (it is paid, and after SIGHUP
  // nobody could stop it) and reports 128 + the number of the signal.
  // Skipped on Windows: it has no POSIX signals or process groups — process.kill with SIGINT, SIGTERM
  // or SIGHUP ends the process outright, so no handler of eval-harness.mjs runs. Not a gap a ticket
  // closes: `pnpm eval:harness` with the real claude runs only on a Mac (worfy-windows ticket 65).
  it.skipIf(process.platform === 'win32').each([
    ['SIGINT', 'ends on it'],
    ['SIGTERM', 'ends on it'],
    ['SIGHUP', 'ends on it'],
    ['SIGINT', 'exits 0'],
    ['SIGTERM', 'exits 0'],
    ['SIGHUP', 'exits 0'],
  ] as const)(
    'outlives %s (claude %s), skips the gui call, removes its copies of git and of the plugin, and reports 128 + the signal',
    async (signal, claudeDoes) => {
      const { dir, log, env } = stubSetup('2.1.289', '0,0', () => process.env.PATH ?? '', {})
      const hang = join(dir, 'hang.pid')
      const stubEnv = { ...env, STUB_HANG: hang, ...(claudeDoes === 'exits 0' ? { STUB_CATCH: '1' } : {}) }
      const child = spawn(process.execPath, [EVAL_HARNESS], { env: stubEnv, stdio: 'ignore' })
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        child.on('close', (code, ended) => resolve({ code, signal: ended })),
      )
      let stub = 0
      try {
        for (let waited = 0; !(existsSync(hang) && readFileSync(hang, 'utf8') !== ''); waited += 50) {
          if (waited > 30_000) throw new Error('the stub never started')
          await sleep(50)
        }
        stub = Number(readFileSync(hang, 'utf8'))
        const [first] = loggedCalls(log)
        if (!first) throw new Error('no call of the stub logged')
        if (child.pid === undefined) throw new Error('eval-harness.mjs has no pid')
        process.kill(child.pid, signal)
        await sleep(300)
        process.kill(stub, signal)
        const ended = await exited
        expect(ended).toEqual({ code: 128 + constants.signals[signal], signal: null })
        expect(loggedCalls(log).map((call) => listAfter(call.args, '--tag'))).toEqual([['main']])
        expect(existsSync(dirname(first.evalGit))).toBe(false)
        expect(existsSync(first.args[2] ?? '')).toBe(false)
      } finally {
        for (const pid of [stub, child.pid ?? 0]) {
          try {
            if (pid) process.kill(pid, 'SIGKILL')
          } catch {
            // already gone
          }
        }
      }
    },
    SCAFFOLD_TIMEOUT_MS,
  )

  it.each([
    ['1,0', 1],
    ['0,2', 2],
    ['2,1', 2],
    ['130,0', 130],
  ])('exits with the worst code of the calls (%s -> %i)', (codes, worst) => {
    const { run, calls } = evalHarness('2.1.289', codes)
    expect(run.status, run.stderr).toBe(worst)
    // The code comes from the calls: a run that stopped before claude, or whose clean-up threw after
    // them (exit 1 too), is not "1,0 -> 1". The result paths are written only after the clean-up.
    const [main, gui] = codes.split(',')
    expect(calls).toHaveLength(2)
    expect(run.stdout).toMatch(new RegExp(`main exited ${main}\\n[\\s\\S]*gui exited ${gui}\\n`))
    expect(run.stdout).toMatch(/aggregate-result\.json/)
  })

  it('passes the arguments after -- through and skips a call that selects no case', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0', ['--', '--case', 'status-block', '--runs', '1'])
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(1)
    const args = calls[0]?.args ?? []
    expect(listAfter(args, '--tag')).toEqual(['main'])
    expect(args.slice(-4)).toEqual(['--case', 'status-block', '--runs', '1'])
    expect(run.stdout).toMatch(/no gui case selected/)
  })

  // Only a `.mjs` CLAUDE_BIN on Windows starts through this process's executable. Here CLAUDE_BIN is
  // that executable itself: by its path it answers --version (v<major>.<minor>.<patch>, newer than
  // the minimum); as a script of itself it fails. A --case that matches nothing skips both calls.
  it.runIf(process.platform === 'win32')('on Windows starts a CLAUDE_BIN that is no .mjs by its path', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0', ['--', '--case', 'no-such-case'], undefined, { CLAUDE_BIN: process.execPath })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toMatch(/no main case selected/)
    expect(calls).toEqual([])
  })

  // Outside Windows a `.mjs` CLAUDE_BIN starts by its path, as any other. This one is a `#!/bin/sh`
  // script that runs the stub: the kernel runs it through its #! line, while Node would refuse it as
  // JavaScript.
  it.skipIf(process.platform === 'win32')('outside Windows starts a .mjs CLAUDE_BIN by its path', () => {
    const { dir, log, env } = stubSetup('2.1.289', '0,0', () => process.env.PATH ?? '', {})
    const claude = join(dir, 'claude-by-path.mjs')
    writeFileSync(claude, `#!/bin/sh\nexec '${join(dir, 'claude')}' "$@"\n`)
    chmodSync(claude, 0o755)
    const run = spawnSync(process.execPath, [EVAL_HARNESS], { env: { ...env, CLAUDE_BIN: claude }, encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS })
    expect(run.status, run.stderr).toBe(0)
    expect(loggedCalls(log)).toHaveLength(2)
  })
})

describe('harness/evals stays out of the app', () => {
  it('the build leaves evals/ out of its copy of harness/', async () => {
    // Loaded by path: electron.vite.config.ts belongs to tsconfig.node.json, not to the test project.
    const config = join(REPO, 'electron.vite.config.ts')
    const { HARNESS_NOT_BUNDLED } = (await import(config)) as { HARNESS_NOT_BUNDLED: string[] }
    expect(HARNESS_NOT_BUNDLED).toContain('evals')
  })

  it('the run results are ignored by git', () => {
    const ignored = spawnSync('git', ['check-ignore', '-q', `harness${sep}evals${sep}results${sep}x${sep}report.html`], { cwd: REPO })
    expect(ignored.status).toBe(0)
  })
})
