// The eval cases of the Harness (harness/evals/, ticket worfy-harness/27) are run by
// `claude plugin eval` through `pnpm eval:harness`: by hand, on a Mac, against the owner's model
// account. This test is their free part and never starts claude: every case has the files
// `claude plugin eval` needs, every scaffold script builds its fixture in a temporary folder with a
// temporary HOME, the fixture is a project the Harness scripts recognise (bin/profile exit 0,
// epic-status sees four tickets), and the build leaves harness/evals/ out of the app's copy.
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { constants, homedir, tmpdir, userInfo } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { findStatusBlock } from '../../src/shared/agent/status-block'
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

  // The epic-wave cases grade which tickets the wave takes by the dispatch, not by a Status line.
  // The demo profile runs a wave one ticket at a time, so ticket 04 starts only after 02 is merged,
  // and a ticket's Status changes only when its implementer reaches the claim: graders on those lines
  // failed runs that took exactly the named tickets (2026-10-22 and 2026-10-23, both cases).
  // The synthetic briefs are built from the brief template of the skill, the neighbours line included:
  // the brief of 04 names 02's files there, and a scout brief for 02 may name 02's ticket file.
  it.each([
    ['epic-wave-old-form', 'alpha|charlie', ['02', '04']],
    ['epic-wave-tickets', 'alpha|charlie|delta', ['02']],
  ])('%s: the dispatch grader matches the implementer brief of skills/epic-wave for ticket 02 only', (name, unnamed, wave) => {
    const skill = readFileSync(join(HARNESS, 'skills', 'epic-wave', 'SKILL.md'), 'utf8')
    const line = (start: string): string => {
      const found = skill.split('\n').find((text) => text.startsWith(start)) ?? ''
      expect(found, start).not.toBe('')
      return found
    }
    const ticketLine = line('Ticket: <F tickets.path for NN>')
    const filesLine = line('Files: <exact list>')
    const neighboursLine = line("Wave neighbours' files (do not touch): <NN>: <files>")
    const slugs: Record<string, string> = { '01': 'alpha', '02': 'bravo', '03': 'charlie', '04': 'delta' }
    const path = (nn: string): string => `.scratch/demo/issues/${nn}-${slugs[nn]}.md`
    const files = (nn: string): string => `src/${slugs[nn]}.mjs, test/${slugs[nn]}.test.mjs`
    const brief = (nn: string, neighbours: string[]): string =>
      [
        ticketLine.replace('<F tickets.path for NN>', path(nn)).replace('<F tickets.spec>', '.scratch/demo/spec.md'),
        filesLine.replace('<exact list>', files(nn)),
        neighbours.length === 0
          ? null
          : `${neighboursLine.slice(0, neighboursLine.indexOf('<NN>'))}${neighbours.map((n) => `${n}: ${files(n)}`).join('; ')}`,
      ]
        .filter((text) => text !== null)
        .join('\n')
    const call = (agent: string, prompt: string, agentFirst = true): string =>
      agentFirst
        ? JSON.stringify({ description: 'dispatch', subagent_type: agent, run_in_background: true, prompt })
        : JSON.stringify({ description: 'dispatch', prompt, run_in_background: true, subagent_type: agent })

    const dispatched = frontMatter(join(EVALS, name, 'graders', '02-dispatched.md'))
    expect(field(dispatched, 'type')).toBe('tool_used')
    expect(field(dispatched, 'tool')).toBe('Agent')
    expect(field(dispatched, 'min')).toBe('1')
    const pattern = new RegExp(field(dispatched, 'input_match') ?? '<none>')
    const own = brief('02', wave.filter((nn) => nn !== '02'))
    expect(call('worfy:implementer', own)).toMatch(pattern)
    expect(call('worfy:implementer', own, false)).toMatch(pattern)
    for (const nn of ['01', '03', '04']) {
      const others = brief(nn, ['01', '02', '03', '04'].filter((n) => n !== nn))
      expect(others).toContain('src/bravo.mjs')
      expect(call('worfy:implementer', others)).not.toMatch(pattern)
      expect(call('worfy:implementer', `${others}\nTicket 02 (${path('02')}) goes first.`)).not.toMatch(pattern)
    }
    expect(call('worfy:scout', `Repository: /tmp/demo\n${own}\nMap the ticket with file:line.`)).not.toMatch(pattern)

    const guard = frontMatter(join(EVALS, name, 'graders', 'no-agent-for-unnamed.md'))
    expect(field(guard, 'input_match')).toBe(unnamed)
    expect(call('worfy:implementer', own)).not.toMatch(new RegExp(unnamed))
    for (const file of graderFiles(name)) {
      const grader = frontMatter(file)
      if (field(grader, 'match') === 'not_contains') expect(field(grader, 'pattern'), file).not.toContain('Status')
    }
  })

  it('epic-wave-old-form: ticket 04 is graded on the reply by the llm judge', () => {
    const grader = join(EVALS, 'epic-wave-old-form', 'graders', '04-in-the-wave.md')
    expect(existsSync(grader)).toBe(true)
    expect(field(frontMatter(grader), 'type')).toBe('llm')
  })

  // The status-block grader and the app read the same four lines: a reply whose closing block
  // worfy shows must pass the grader, indented as in the example of hooks/rules/orchestrator.md or
  // not, and a reply that closes with the old Russian labels must fail it.
  it('status-block: the ends-with-status-block grader accepts the block findStatusBlock reads and rejects the old labels', () => {
    const grader = frontMatter(join(EVALS, 'status-block', 'graders', 'ends-with-status-block.md'))
    const pattern = new RegExp(field(grader, 'pattern') ?? '<none>')
    const block = ['— Stage: demo 04, ревью круг 1', '— Now: опечатка исправлена', '— Next: PR', '— Waiting: ничего']
    const replies = [
      `Готово.\n\n${block.join('\n')}`,
      `Готово.\n\n${block.map((line) => `    ${line}`).join('\n')}\n`,
      `Готово.\r\n\r\n${block.join('\r\n')}\r\n`,
    ]
    for (const reply of replies) {
      expect(findStatusBlock(reply)?.waiting).toBe('ничего')
      expect(reply).toMatch(pattern)
    }
    const russian = `Готово.\n\n${['— Этап: demo 04', '— Сейчас: опечатка исправлена', '— Дальше: PR', '— Жду: ничего'].join('\n')}`
    expect(findStatusBlock(russian)).not.toBeNull()
    expect(russian).not.toMatch(pattern)
    expect(`${block.join('\n')}\n\nИ ещё одно замечание.`).not.toMatch(pattern)
    const prose = `Итог ${block.join('\n')}`
    expect(findStatusBlock(prose)).toBeNull()
    expect(prose).not.toMatch(pattern)
    expect(block.join('\n')).toMatch(pattern)
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
    // A folder of the fixture whose name starts with two dots is inside it, not above it.
    expect(check(fake, { HARNESS_HOME: join(work, '..hh') }).status).toBe(0)
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

  // A home folder in the user database that is not on disk (a deleted account folder, an unmounted
  // volume) has no inode to compare: HOME spelled the same is still the real one, and any other
  // missing HOME is not.
  it('state-guard.cjs refuses a HOME that names the real home folder when that folder is not on disk', () => {
    const { stub } = fakeRealHome()
    const missing = join(tempDir('worfy-eval-missing-home-'), 'home')
    const guard = (home: string) =>
      spawnSync(process.env.npm_node_execpath ?? 'node', [join(EVALS, 'lib', 'state-guard.cjs'), home, tempDir('worfy-eval-guard-')], {
        env: { PATH: process.env.PATH, ...stub, EVAL_TEST_REAL_HOME: missing },
        encoding: 'utf8',
      })
    const same = guard(missing)
    expect(same.status, same.stderr).toBe(1)
    expect(same.stderr).toMatch(/is the real home folder of this user/)
    const other = guard(join(tempDir('worfy-eval-other-home-'), 'home'))
    expect(other.status, other.stderr).toBe(0)
    expect(existsSync(missing)).toBe(false)
  })

  // The same missing home folder spelled through a link to its parent: a link made here, and on macOS
  // /var for /private/var. The parent is on disk, so both spellings resolve to one path.
  it('state-guard.cjs refuses a missing real home folder spelled through a link to its parent', () => {
    const { stub } = fakeRealHome()
    const parent = tempDir('worfy-eval-missing-parent-')
    const missing = join(parent, 'home')
    const link = join(tempDir('worfy-eval-parent-link-'), 'parent')
    symlinkSync(parent, link, 'junction')
    const guard = (home: string) =>
      spawnSync(process.env.npm_node_execpath ?? 'node', [join(EVALS, 'lib', 'state-guard.cjs'), home, tempDir('worfy-eval-guard-')], {
        env: { PATH: process.env.PATH, ...stub, EVAL_TEST_REAL_HOME: missing },
        encoding: 'utf8',
      })
    const spellings = [join(link, 'home'), ...(parent.startsWith('/private/var/') ? [missing.slice('/private'.length)] : [])]
    for (const home of spellings) {
      const run = guard(home)
      expect(run.status, `${home}: ${run.stderr}`).toBe(1)
      expect(run.stderr).toMatch(/is the real home folder of this user/)
    }
    // Another missing folder behind the same link is not the real home.
    expect(guard(join(link, 'other')).status).toBe(0)
    expect(existsSync(missing)).toBe(false)
  })

  // A HARNESS_HOME under the fixture spelled in another letter case is the same folder on a
  // case-insensitive volume (macOS, Windows): only the native realpath gives the spelling on disk,
  // the plain one keeps the case it was given. On a case-sensitive volume (Linux CI) the other
  // spelling is another folder, and the test is skipped for that reason.
  const caseWork = tempDir('worfy-eval-guard-case-')
  const caseInsensitive = existsSync(caseWork.toUpperCase())
  it.skipIf(!caseInsensitive)(
    `state-guard.cjs takes a HARNESS_HOME under the fixture spelled in another case for one inside it${caseInsensitive ? '' : ' (skipped: the file system is case-sensitive)'}`,
    () => {
      const home = tempDir('worfy-eval-guard-home-')
      const run = spawnSync(process.env.npm_node_execpath ?? 'node', [join(EVALS, 'lib', 'state-guard.cjs'), home, caseWork], {
        env: childEnv(home, { PATH: process.env.PATH, HARNESS_HOME: join(caseWork.toUpperCase(), 'hh') }),
        encoding: 'utf8',
      })
      expect(run.status, run.stderr).toBe(0)
      expect(readdirSync(caseWork)).toEqual([])
    },
  )

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
    expect(`${gate.stdout}${gate.stderr}`).toMatch(/\[gate\] green \(fast\)/)
  })

  // The Windows branch of demo-project.sh must leave the fixture of macOS and Linux as it was: there
  // `match` is the folder `pwd -P` gives (the realpath) and no demo-pm.cmd is written. On Windows the
  // registry has node's long spelling with `/`, and demo-pm.cmd sits next to demo-pm.
  it('the registry and package manager of the fixture: one spelling per system, demo-pm.cmd only on Windows', () => {
    const { work, run } = scaffold('status-block')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const registry = JSON.parse(readFileSync(join(work, '.git', 'worfy-harness', 'gate', 'config.json'), 'utf8')) as { repos: { match: string; pm: string }[] }
    const windows = process.platform === 'win32'
    const match = windows ? realpathSync.native(work).replaceAll('\\', '/') : realpathSync(work)
    expect(registry.repos[0]).toMatchObject({ match, pm: `${match}/.git/demo-pm` })
    expect(existsSync(join(work, '.git', 'demo-pm'))).toBe(true)
    expect(existsSync(join(work, '.git', 'demo-pm.cmd'))).toBe(windows)
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
    expect(readFileSync(join(EVALS, 'reviewer-simplification', 'prompt.md'), 'utf8')).toContain('одной линзой «simplification»')

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
// STUB_CATCH it exits 0 on a signal instead of being ended by it. STUB_AGGREGATE: every call writes
// this text as aggregate-result.json into its --output-dir, as claude plugin eval does; a JSON report
// that names neither its cases nor aggregates.casesTotal gets both, from the cases the call would run.
// The stub parses its arguments as claude does: nothing after a `--` is an option.
// STUB_VERSION_LOG: every `claude --version` appends a line there.
// The stub is one file of the repository, test/fixtures/eval-stub/claude.cjs; each test reaches it
// through a link. macOS checks every new executable before its first start (XprotectService, one
// file at a time): a stub written anew for each test waited in that queue, up to seconds under a loaded
// gate, and a test that runs eval-harness.mjs failed on time alone (worfy-polish 30 and 34).
const STUB = join(REPO, 'test', 'fixtures', 'eval-stub', 'claude.cjs')

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
  // path, as the real claude is: a link named claude to the stub of the repository.
  const claude = join(dir, process.platform === 'win32' ? 'claude.mjs' : 'claude')
  if (process.platform === 'win32') writeFileSync(claude, `import ${JSON.stringify(pathToFileURL(STUB).href)}\n`)
  else symlinkSync(STUB, claude)
  const log = join(dir, 'calls.log')
  const env = childEnv(dir, {
    PATH: path(dir),
    ELECTRON_RUN_AS_NODE: '1',
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

const loggedCalls = (log: string): StubCall[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StubCall)
    : []

const EVAL_HARNESS = join(REPO, 'scripts', 'eval-harness.mjs')
/** The run environment eval-harness.mjs shares with eval-outcome.mjs: the pinned models among it. */
const runEnvModule = async (): Promise<{ MODEL: string; JUDGE_MODEL: string; MIN_VERSION: number[] }> =>
  (await import(pathToFileURL(join(REPO, 'scripts', 'eval-run-env.mjs')).href)) as { MODEL: string; JUDGE_MODEL: string; MIN_VERSION: number[] }

/** Runs scripts/eval-harness.mjs against the stub; returns the run and the logged eval calls. */
function evalHarness(
  version: string,
  codes: string,
  args: string[] = [],
  path: (home: string) => string = () => process.env.PATH ?? '',
  extra: NodeJS.ProcessEnv = {},
): { run: SpawnSyncReturns<string>; calls: StubCall[]; home: string } {
  const { dir, log, env } = stubSetup(version, codes, path, extra)
  const run = spawnSync(process.execPath, [EVAL_HARNESS, ...args], { env, encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS })
  return { run, calls: loggedCalls(log), home: dir }
}

/**
 * Where eval-harness.mjs puts its copy of git: on macOS under the home folder of the run (HOME is the
 * stub folder), whatever folder the checkout is in; elsewhere in the results folder of the Harness it
 * evaluates. The sandbox of a run on macOS re-opened the PATH folders under the home folder for
 * reading and not one under /private/tmp.
 */
const gitParent = (home: string): string =>
  process.platform === 'darwin' ? join(home, 'Library', 'Caches', 'worfy-eval') : join(evaluated(), 'evals', 'results')

/** The copies of git eval-harness.mjs has left, in the results folder and under the home folder `home`. */
const gitCopies = (home = ''): string[] =>
  [join(evaluated(), 'evals', 'results'), ...(home ? [join(home, 'Library', 'Caches', 'worfy-eval')] : [])].flatMap((parent) =>
    existsSync(parent) ? readdirSync(parent).filter((dir) => dir.endsWith('-git')).map((dir) => join(parent, dir)) : [],
  )

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

/**
 * The values of a variadic option: everything after it up to the next option; none when it is absent.
 * As claude parses its arguments, nothing after a `--` is an option.
 */
const listAfter = (args: string[], option: string): string[] => {
  const dash = args.indexOf('--')
  const options = dash === -1 ? args : args.slice(0, dash)
  const at = options.indexOf(option)
  if (at === -1) return []
  const end = options.findIndex((arg, i) => i > at && arg.startsWith('--'))
  return options.slice(at + 1, end === -1 ? undefined : end)
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
  it('refuses with exit code 1 on claude older than 2.1.269 and runs nothing', async () => {
    expect((await runEnvModule()).MIN_VERSION).toEqual([2, 1, 269])
    const { run, calls } = evalHarness('2.1.268', '0,0')
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/2\.1\.269/)
    expect(calls).toEqual([])
  })

  it('runs on claude 2.1.269 itself, the first version with `plugin eval`', () => {
    const { run, calls } = evalHarness('2.1.269', '0,0')
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(2)
  })

  it('makes two calls with the flags of the ticket and a narrow Bash for the gui case', async () => {
    const { MODEL, JUDGE_MODEL } = await runEnvModule()
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
      expect(listAfter(args, '--model')).toEqual([MODEL])
      expect(listAfter(args, '--judge-model')).toEqual([JUDGE_MODEL])
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
    const { run, calls, home } = evalHarness('2.1.289', '0,0', [], undefined, { STUB_SYSTEM_CONFIG: systemConfig })
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(2)
    const [first, second] = calls
    if (!first || !second) throw new Error(`expected two eval calls, got ${calls.length}`)
    expect(first.evalGit).not.toBe('')
    expect(first.path.split(delimiter)[0]).toBe(dirname(first.evalGit))
    expect(dirname(dirname(first.evalGit))).toBe(gitParent(home))
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

  // On macOS the copies of every checkout share ~/Library/Caches/worfy-eval, and a run ended by SIGKILL,
  // out of memory or a reboot leaves its copy there (about 54 MB).
  it.skipIf(process.platform !== 'darwin')('removes copies of git older than a day that killed runs left under the home folder, and keeps a younger one', () => {
    const stampOf = (ms: number): string => new Date(ms).toISOString().replace(/[:.]/g, '-')
    const day = 24 * 60 * 60 * 1000
    let old = ''
    let young = ''
    const { run, calls } = evalHarness('2.1.289', '0,0', [], (dir) => {
      const parent = join(dir, 'Library', 'Caches', 'worfy-eval')
      old = join(parent, `${stampOf(Date.now() - 2 * day)}-git`)
      young = join(parent, `${stampOf(Date.now() - 60 * 60 * 1000)}-git`)
      for (const copy of [old, young]) {
        mkdirSync(join(copy, 'git-core'), { recursive: true })
        writeFileSync(join(copy, 'git'), '#!/bin/sh\n')
      }
      const twoDaysAgo = new Date(Date.now() - 2 * day)
      utimesSync(old, twoDaysAgo, twoDaysAgo)
      return process.env.PATH ?? ''
    })
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(2)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(join(young, 'git'))).toBe(true)
  })

  it('exits 1 and calls no claude when `git --exec-path` gives no folder', () => {
    const before = gitCopies()
    const { run, calls, home } = evalHarness('2.1.289', '0,0', [], (dir) => {
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
    expect(gitCopies(home)).toEqual(before)
  })

  it('exits 1, calls no claude and removes the copy when the copy of git does not answer --version', () => {
    const before = gitCopies()
    const core = join(tempDir('worfy-eval-core-'), 'git-core')
    mkdirSync(core)
    writeFileSync(join(core, 'git'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(core, 'git'), 0o755)
    const { run, calls, home } = evalHarness('2.1.289', '0,0', [], (dir) => fakeGitPath(dir, core))
    expect(run.status).toBe(1)
    // Exit 1 is the copy's own answer; on Windows, a check that started the `#!/bin/sh` wrapper by
    // its path, not through sh, would stop at ENOENT and make this test pass for that wrong reason.
    expect(run.stderr).toMatch(/the copy of git does not run \(.* --version, exit 1\)/)
    expect(calls).toEqual([])
    expect(gitCopies(home)).toEqual(before)
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
      const { run, calls, home } = evalHarness('2.1.289', '0,0', [], (dir) => fakeGitPath(dir, core))
      expect(run.status).toBe(1)
      expect(run.stderr).toMatch(/cannot copy/)
      expect(calls).toEqual([])
      expect(gitCopies(home)).toEqual(before)
    } finally {
      chmodSync(join(core, 'git-unreadable'), 0o644)
    }
  })

  it.skipIf(!permissionsHold)('removes the copy of git when removing the copy of the plugin throws', () => {
    const before = gitCopies()
    const { run, calls, home } = evalHarness('2.1.289', '0,0', [], undefined, { STUB_LOCK: '1' })
    const target = calls[0]?.args[2] ?? ''
    try {
      expect(calls).toHaveLength(2)
      expect(run.status).toBe(1)
      expect(run.stderr).toMatch(/ENOTEMPTY|EACCES|EPERM/)
      expect(existsSync(target)).toBe(true)
      expect(existsSync(dirname(calls[0]?.evalGit ?? ''))).toBe(false)
      expect(gitCopies(home)).toEqual(before)
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
    // The --case of the user chooses the case; the call names it once, as its own option.
    expect(listAfter(args, '--case')).toEqual(['status-block'])
    expect(args.filter((arg) => arg === '--case')).toHaveLength(1)
    expect(args.slice(-2)).toEqual(['--runs', '1'])
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

// The map "eval case -> Harness rule files" (harness/evals/lib/coverage.json) and the pure functions
// over it (scripts/eval-harness-coverage.mjs), ticket worfy-harness/29. Paths in the map are relative
// to harness/; the changed paths casesFor takes are relative to the repository root, as git gives them.
const COVERAGE_MODULE = join(REPO, 'scripts', 'eval-harness-coverage.mjs')
interface Coverage {
  cases: Record<string, string[]>
  uncovered: Record<string, string>
}
interface Selection {
  cases: string[]
  files: { path: string; cases: string[] }[]
  uncovered: { path: string; reason: string }[]
}
interface CoverageModule {
  ruleFiles: (harnessDir: string) => string[]
  readCoverage: (harnessDir: string) => Coverage
  coverageProblems: (harnessDir: string) => string[]
  casesFor: (changedPaths: string[], coverage: Coverage, caseNames: string[]) => Selection
}
const coverageModule = async (): Promise<CoverageModule> => (await import(COVERAGE_MODULE)) as CoverageModule
const CASE_NAMES = CASES.map(([name]) => name)

/** A copy filter that leaves <source>/evals/results/ out: run results are no part of the Harness. */
const withoutResults =
  (source: string) =>
  (path: string): boolean => {
    const inside = relative(source, path)
    const results = join('evals', 'results')
    return inside !== results && !inside.startsWith(`${results}${sep}`)
  }

/** A copy of harness/ in a temporary folder, changed by `edit`. */
const harnessCopyWith = (edit: (dir: string) => void): string => {
  const dir = join(tempDir('worfy-eval-coverage-'), 'harness')
  cpSync(HARNESS, dir, { recursive: true, filter: withoutResults(HARNESS) })
  edit(dir)
  return dir
}
const writeFileIn = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
const editCoverage = (dir: string, change: (coverage: Coverage) => void): void => {
  const file = join(dir, 'evals', 'lib', 'coverage.json')
  const coverage = JSON.parse(readFileSync(file, 'utf8')) as Coverage
  change(coverage)
  writeFileSync(file, `${JSON.stringify(coverage, null, 2)}\n`)
}

describe('harness/evals/lib/coverage.json: which case checks which rule file', () => {
  it('maps every rule file of harness/ either to a case or to a reason, and holds every case', async () => {
    const { coverageProblems, readCoverage, ruleFiles } = await coverageModule()
    expect(coverageProblems(HARNESS)).toEqual([])
    const coverage = readCoverage(HARNESS)
    expect(Object.keys(coverage.cases).sort()).toEqual([...CASE_NAMES].sort())
    const mapped = new Set(Object.values(coverage.cases).flat())
    const files = ruleFiles(HARNESS)
    for (const file of files) {
      const reason = coverage.uncovered[file]
      expect(mapped.has(file) !== (reason !== undefined), file).toBe(true)
      if (reason !== undefined) expect(reason.trim(), file).not.toBe('')
    }
    // Rule files are the skills, the agents, the injected rules and the two files that inject them.
    expect(files).toEqual(
      expect.arrayContaining(['skills/epic-wave/SKILL.md', 'agents/implementer.md', 'hooks/rules/orchestrator.md', 'hooks/hooks.json', 'hooks/inject-rules.mjs']),
    )
    expect(files.filter((file) => !/^(skills\/.+|agents\/[^/]+\.md|hooks\/rules\/[^/]+\.md|hooks\/hooks\.json|hooks\/inject-rules\.mjs)$/.test(file))).toEqual([])
  })

  const breaks: [name: string, edit: (dir: string) => void, problem: string][] = [
    ['a new skill with neither a case nor a reason', (dir) => writeFileIn(join(dir, 'skills', 'new', 'SKILL.md'), '# new\n'), 'not mapped: skills/new/SKILL.md'],
    [
      'a file both under a case and in uncovered',
      (dir) => editCoverage(dir, (coverage) => (coverage.uncovered['skills/epic-wave/SKILL.md'] = 'some reason')),
      'both under a case and in uncovered: skills/epic-wave/SKILL.md',
    ],
    ['a file of a case removed from disk', (dir) => unlinkSync(join(dir, 'agents', 'implementer.md')), 'missing on disk: agents/implementer.md'],
    ['an uncovered file removed from disk', (dir) => unlinkSync(join(dir, 'skills', 'qmd', 'SKILL.md')), 'missing on disk: skills/qmd/SKILL.md'],
    ['a case folder with no entry in the map', (dir) => writeFileIn(join(dir, 'evals', 'new-case', 'prompt.md'), '---\ntags: [main]\n---\n'), 'case folder not in the map: new-case'],
    ['a case of the map with no folder', (dir) => removeTestTree(join(dir, 'evals', 'status-block')), 'case without a folder: status-block'],
    ['an empty reason', (dir) => editCoverage(dir, (coverage) => (coverage.uncovered['skills/qmd/SKILL.md'] = ' ')), 'empty reason: skills/qmd/SKILL.md'],
    ['a case that names no rule file', (dir) => editCoverage(dir, (coverage) => (coverage.cases['status-block'] = [])), 'case names no rule file: status-block'],
    ['a case list that is not a list', (dir) => editCoverage(dir, (coverage) => ((coverage.cases as Record<string, unknown>)['status-block'] = 'hooks/hooks.json')), 'case lists no paths: status-block'],
    ['a mapped path that is no rule file', (dir) => editCoverage(dir, (coverage) => coverage.cases['status-block']?.push('bin/profile')), 'not a rule file: bin/profile'],
  ]
  it.each(breaks)('coverageProblems names %s', async (_, edit, problem) => {
    const { coverageProblems } = await coverageModule()
    expect(coverageProblems(harnessCopyWith(edit))).toContain(problem)
  })

  it('coverageProblems names a map whose cases are not an object', async () => {
    const { coverageProblems } = await coverageModule()
    const dir = harnessCopyWith((copy) => editCoverage(copy, (coverage) => ((coverage as unknown as Record<string, unknown>).cases = [])))
    expect(coverageProblems(dir)).toEqual(['evals/lib/coverage.json must hold the objects "cases" and "uncovered"'])
  })

  it('coverageProblems names a map that cannot be read', async () => {
    const { coverageProblems } = await coverageModule()
    const problems = coverageProblems(harnessCopyWith((dir) => writeFileSync(join(dir, 'evals', 'lib', 'coverage.json'), '{ not json')))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^cannot read evals\/lib\/coverage\.json: /)
  })

  it('casesFor picks the cases of changed rule files, of changed case folders, and all of them for evals/lib/', async () => {
    const { casesFor, readCoverage } = await coverageModule()
    const coverage = readCoverage(HARNESS)
    const pick = (path: string): Selection => casesFor([path], coverage, CASE_NAMES)
    expect(pick('harness/skills/epic-wave/SKILL.md').cases).toEqual(['epic-wave-old-form', 'epic-wave-tickets', 'reviewer-verdict'])
    expect(pick('harness/hooks/rules/orchestrator.md').cases).toEqual(['status-block'])
    expect(pick('harness/hooks/inject-rules.mjs').cases).toEqual(['status-block'])
    expect(pick('harness/agents/reviewer.md').cases).toEqual(['reviewer-intended-breakage', 'reviewer-simplification', 'reviewer-verdict'])
    expect(pick('harness/evals/status-block/graders/x.md').cases).toEqual(['status-block'])
    expect(pick('harness/evals/lib/demo-project.sh').cases).toEqual([...CASE_NAMES].sort())
    expect(pick('harness/evals/lib/coverage.json').cases).toEqual([...CASE_NAMES].sort())
    const qmd = pick('harness/skills/qmd/SKILL.md')
    expect(qmd.cases).toEqual([])
    expect(qmd.uncovered).toEqual([{ path: 'harness/skills/qmd/SKILL.md', reason: coverage.uncovered['skills/qmd/SKILL.md'] }])
    expect(qmd.uncovered[0]?.reason).toMatch(/\S/)
    expect(pick('src/main/index.ts')).toEqual({ cases: [], files: [], uncovered: [] })
    expect(pick('harness/bin/profile')).toEqual({ cases: [], files: [], uncovered: [] })
    expect(pick('harness/evals/results/2026-01-01T00-00-00-000Z-main/aggregate-result.json').cases).toEqual([])
    // Several paths: each case once, and what each path chose.
    const many = casesFor(['harness/agents/implementer.md', 'README.md', 'harness/hooks/hooks.json', 'harness/hooks/rules/orchestrator.md'], coverage, CASE_NAMES)
    expect(many.cases).toEqual(['implementer-report', 'status-block'])
    expect(many.files).toEqual([
      { path: 'harness/agents/implementer.md', cases: ['implementer-report'] },
      { path: 'harness/hooks/hooks.json', cases: ['status-block'] },
      { path: 'harness/hooks/rules/orchestrator.md', cases: ['status-block'] },
    ])
  })
})

/**
 * A temporary git repository with copies of scripts/eval-harness.mjs, its three modules and harness/,
 * the base commit on `main`; `git` runs git in it with a temporary home.
 */
function changedRepo(): { repo: string; git: (...args: string[]) => SpawnSyncReturns<string> } {
  const root = tempDir('worfy-eval-changed-')
  const repo = join(root, 'repo')
  const home = join(root, 'home')
  mkdirSync(home)
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  for (const file of ['eval-harness.mjs', 'eval-harness-coverage.mjs', 'eval-run-env.mjs', 'remove-tree.mjs']) copyFileSync(join(REPO, 'scripts', file), join(repo, 'scripts', file))
  cpSync(HARNESS, join(repo, 'harness'), { recursive: true, filter: withoutResults(HARNESS) })
  writeFileSync(join(repo, '.gitignore'), 'harness/evals/results/\n')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  const env = childEnv(home, {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  })
  const git = (...args: string[]): SpawnSyncReturns<string> => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS })
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']]) {
    const step = git(...args)
    if (step.status !== 0) throw new Error(`git ${args.join(' ')}: ${step.stderr}`)
  }
  return { repo, git }
}

/** Runs the copy of eval-harness.mjs in `repo` against the claude stub, without HARNESS_DIR. */
// The stub answers --version with 2.1.300, and the reports it writes say 2.1.289: the summary line
// must take the version of the report.
function evalIn(
  repo: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
  codes = '0,0,0,0,0',
): { run: SpawnSyncReturns<string>; calls: StubCall[]; versionCalls: number } {
  const { dir, log, env } = stubSetup('2.1.300', codes, () => process.env.PATH ?? '', {})
  const versionLog = join(dir, 'version.log')
  delete env.HARNESS_DIR
  Object.assign(env, { STUB_VERSION_LOG: versionLog }, extra)
  const run = spawnSync(process.execPath, [join(repo, 'scripts', 'eval-harness.mjs'), ...args], { env, encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS })
  const versionCalls = existsSync(versionLog) ? readFileSync(versionLog, 'utf8').split('\n').filter(Boolean).length : 0
  return { run, calls: loggedCalls(log), versionCalls }
}
const caseArgs = (calls: StubCall[]): string[][] => calls.map((call) => listAfter(call.args, '--case'))

const aggregate = (fields: Record<string, unknown> = {}): string =>
  JSON.stringify({ claudeVersion: '2.1.289', costUsd: 0.3, partial: false, aggregates: { casesTotal: 1, casesPassed: 1, overallScore: 1 }, ...fields })
const lines = (text: string): string[] => text.split('\n')

describe('pnpm eval:harness -- --changed <base> (claude replaced by a stub, a temporary git repository)', () => {
  it('runs only the case of an uncommitted change to a rule file, in the main call, and keeps --changed from claude', () => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nOne more rule.\n')
    const { run, calls } = evalIn(repo, ['--', '--changed', 'HEAD'])
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(1)
    const args = calls[0]?.args ?? []
    expect(listAfter(args, '--case')).toEqual(['implementer-report'])
    expect(listAfter(args, '--tag')).toEqual(['main'])
    expect(args.join(' ')).not.toMatch(/--changed/)
    expect(run.stdout).toContain('harness/agents/implementer.md -> implementer-report')
  })

  it('takes the commits of the branch since its merge-base with the base, and a file in a new untracked folder', () => {
    const { repo, git } = changedRepo()
    expect(git('checkout', '-q', '-b', 'topic').status).toBe(0)
    appendFileSync(join(repo, 'harness', 'skills', 'epic-wave', 'SKILL.md'), '\nOne more rule.\n')
    expect(git('commit', '-q', '-am', 'change epic-wave').status).toBe(0)
    // main moves on after topic branched off: its change is not the branch's (`...`, not `..`).
    expect(git('checkout', '-q', 'main').status).toBe(0)
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nA rule on main.\n')
    expect(git('commit', '-q', '-am', 'change implementer on main').status).toBe(0)
    expect(git('checkout', '-q', 'topic').status).toBe(0)
    writeFileIn(join(repo, 'harness', 'evals', 'status-block', 'extra', 'note.md'), 'note\n')
    const { run, calls } = evalIn(repo, ['--changed', 'main'])
    expect(run.status, run.stderr).toBe(0)
    // `claude plugin eval --case` takes one name glob, so each chosen case of a tag is a call of its own.
    expect(calls.map((call) => listAfter(call.args, '--case'))).toEqual([['epic-wave-old-form'], ['epic-wave-tickets'], ['reviewer-verdict'], ['status-block']])
    for (const call of calls) expect(listAfter(call.args, '--tag')).toEqual(['main'])
    expect(new Set(calls.map((call) => listAfter(call.args, '--output-dir')[0])).size).toBe(4)
  })

  it('takes the --changed=<base> form, and keeps it from claude', () => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nOne more rule.\n')
    const { run, calls } = evalIn(repo, ['--', '--changed=HEAD', '--runs', '1'])
    expect(run.status, run.stderr).toBe(0)
    expect(caseArgs(calls)).toEqual([['implementer-report']])
    expect(calls[0]?.args.join(' ')).not.toMatch(/--changed/)
    expect(listAfter(calls[0]?.args ?? [], '--runs')).toEqual(['1'])
  })

  // A rename reaches git as a deletion of the old path and an addition of the new one: a file moved
  // from one case folder to another changes both cases.
  it('picks both cases of a file moved between case folders, staged', () => {
    const { repo, git } = changedRepo()
    const from = 'harness/evals/status-block/graders/epic-status-ran.md'
    expect(git('mv', from, 'harness/evals/implementer-report/graders/epic-status-ran.md').status).toBe(0)
    const { run, calls } = evalIn(repo, ['--changed', 'HEAD'])
    expect(run.status, run.stderr).toBe(0)
    expect(caseArgs(calls)).toEqual([['implementer-report'], ['status-block']])
  })

  it('picks both cases of a file moved between case folders, committed on the branch', () => {
    const { repo, git } = changedRepo()
    expect(git('checkout', '-q', '-b', 'topic').status).toBe(0)
    expect(git('mv', 'harness/evals/status-block/graders/epic-status-ran.md', 'harness/evals/implementer-report/graders/epic-status-ran.md').status).toBe(0)
    expect(git('commit', '-q', '-m', 'move a grader').status).toBe(0)
    const { run, calls } = evalIn(repo, ['--changed', 'main'])
    expect(run.status, run.stderr).toBe(0)
    expect(caseArgs(calls)).toEqual([['implementer-report'], ['status-block']])
  })

  it('picks the case of a file removed from its folder, staged and committed', () => {
    const staged = changedRepo()
    expect(staged.git('rm', '-q', 'harness/evals/status-block/graders/epic-status-ran.md').status).toBe(0)
    const first = evalIn(staged.repo, ['--changed', 'HEAD'])
    expect(first.run.status, first.run.stderr).toBe(0)
    expect(caseArgs(first.calls)).toEqual([['status-block']])
    const committed = changedRepo()
    expect(committed.git('checkout', '-q', '-b', 'topic').status).toBe(0)
    expect(committed.git('rm', '-q', 'harness/evals/status-block/graders/epic-status-ran.md').status).toBe(0)
    expect(committed.git('commit', '-q', '-m', 'remove a grader').status).toBe(0)
    const second = evalIn(committed.repo, ['--changed', 'main'])
    expect(second.run.status, second.run.stderr).toBe(0)
    expect(caseArgs(second.calls)).toEqual([['status-block']])
  })

  // git quotes a path with a double quote (and escapes it inside); the script reads git's output
  // NUL-separated, where no path is quoted. Windows allows no `"` in a file name.
  it('reads a rule file whose name has a space and a double quote', (context) => {
    context.skip(process.platform === 'win32', 'Windows allows no double quote in a file name')
    const { repo, git } = changedRepo()
    const name = 'notes "on" waves.md'
    writeFileIn(join(repo, 'harness', 'skills', 'epic-wave', name), '# notes\n')
    editCoverage(join(repo, 'harness'), (coverage) => coverage.cases['status-block']?.push(`skills/epic-wave/${name}`))
    expect(git('add', '-A').status).toBe(0)
    expect(git('commit', '-q', '-m', 'add notes').status).toBe(0)
    appendFileSync(join(repo, 'harness', 'skills', 'epic-wave', name), 'more\n')
    const { run, calls } = evalIn(repo, ['--changed', 'HEAD'])
    expect(run.status, run.stderr).toBe(0)
    expect(caseArgs(calls)).toEqual([['status-block']])
    expect(run.stdout).toContain(`harness/skills/epic-wave/${name} -> status-block`)
  })

  // --max-cost-usd is per call; the 30 USD of the script hold across all of its calls.
  it('gives each call what is left of the 30 USD, and starts no call once it is spent', () => {
    const { repo, git } = changedRepo()
    expect(git('checkout', '-q', '-b', 'topic').status).toBe(0)
    appendFileSync(join(repo, 'harness', 'skills', 'epic-wave', 'SKILL.md'), '\nOne more rule.\n')
    expect(git('commit', '-q', '-am', 'change epic-wave').status).toBe(0)
    const { run, calls } = evalIn(repo, ['--changed', 'main'], { STUB_AGGREGATE: aggregate({ costUsd: 12.5 }) })
    expect(calls.map((call) => listAfter(call.args, '--max-cost-usd'))).toEqual([['30'], ['17.5'], ['5']])
    expect(run.status, run.stderr).toBe(0)
    const spent = evalIn(repo, ['--changed', 'main'], { STUB_AGGREGATE: aggregate({ costUsd: 20 }) })
    expect(caseArgs(spent.calls)).toEqual([['epic-wave-old-form'], ['epic-wave-tickets']])
    expect(spent.calls.map((call) => listAfter(call.args, '--max-cost-usd'))).toEqual([['30'], ['10']])
    // Exit 2, as a call that hit the ceiling: the run is partial.
    expect(spent.run.status).toBe(2)
    expect(spent.run.stdout).toMatch(/30 USD .*spent.*main-reviewer-verdict call and any after it are skipped/)
  })

  /** A branch whose change to the epic-wave skill chooses three cases of the main tag, three calls. */
  const threeCalls = (): string => {
    const { repo, git } = changedRepo()
    expect(git('checkout', '-q', '-b', 'topic').status).toBe(0)
    appendFileSync(join(repo, 'harness', 'skills', 'epic-wave', 'SKILL.md'), '\nOne more rule.\n')
    expect(git('commit', '-q', '-am', 'change epic-wave').status).toBe(0)
    return repo
  }
  const limits = (calls: StubCall[]): string[][] => calls.map((call) => listAfter(call.args, '--max-cost-usd'))

  it('counts the whole limit of a call that wrote no report: the next call does not start', () => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'harness', 'evals', 'lib', 'demo-project.sh'), '\n# a comment\n')
    const { run, calls } = evalIn(repo, ['--changed', 'HEAD'], { STUB_AGGREGATE: '' })
    expect(calls.map((call) => listAfter(call.args, '--tag'))).toEqual([['main']])
    expect(limits(calls)).toEqual([['30']])
    expect(run.status).toBe(2)
    expect(run.stdout).toMatch(/30 USD .*spent \(30 USD\).*gui call and any after it are skipped/)
  })

  it('counts the cost of a partial run', () => {
    const { run, calls } = evalIn(threeCalls(), ['--changed', 'main'], { STUB_AGGREGATE: aggregate({ partial: true, costUsd: 20 }) })
    expect(limits(calls)).toEqual([['30'], ['10']])
    expect(run.status).toBe(2)
  })

  it('stops with exit 2 when exactly nothing is left', () => {
    const { run, calls } = evalIn(threeCalls(), ['--changed', 'main'], { STUB_AGGREGATE: aggregate({ costUsd: 15 }) })
    expect(limits(calls)).toEqual([['30'], ['15']])
    expect(run.status).toBe(2)
    expect(run.stdout).toMatch(/spent \(30 USD\).*main-reviewer-verdict call and any after it are skipped/)
  })

  it('makes the usual call of a tag, without --case, when a change chooses every case of it', () => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'harness', 'evals', 'lib', 'demo-project.sh'), '\n# a comment\n')
    const { run, calls } = evalIn(repo, ['--changed', 'HEAD'])
    expect(run.status, run.stderr).toBe(0)
    expect(calls.map((call) => listAfter(call.args, '--tag'))).toEqual([['main'], ['gui']])
    for (const call of calls) expect(call.args).not.toContain('--case')
  })

  it('calls no claude and exits 0 when no rule file changed', () => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'README.md'), 'more\n')
    const { run, calls, versionCalls } = evalIn(repo, ['--changed', 'HEAD'])
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toEqual([])
    expect(versionCalls).toBe(0)
    expect(run.stdout).toMatch(/no case selected/)
  })

  it('names a changed rule file that has no case, with its reason, and calls no claude', () => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'harness', 'skills', 'qmd', 'SKILL.md'), '\nOne more rule.\n')
    const { run, calls } = evalIn(repo, ['--changed', 'HEAD'])
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toEqual([])
    expect(run.stdout).toMatch(/no case: harness\/skills\/qmd\/SKILL\.md — \S/)
  })

  const none = (): NodeJS.ProcessEnv => ({})
  const refusals: [name: string, args: string[], extra: (repo: string) => NodeJS.ProcessEnv, stderr: RegExp][] = [
    ['a base git does not know', ['--changed', 'no-such-branch'], none, /no-such-branch/],
    ['--changed with --case', ['--changed', 'HEAD', '--case', 'status-block'], none, /--case/],
    ['--changed with --tag', ['--changed', 'HEAD', '--tag', 'main'], none, /--tag/],
    ['--changed with HARNESS_DIR', ['--changed', 'HEAD'], (repo) => ({ HARNESS_DIR: join(repo, 'harness') }), /HARNESS_DIR/],
    ['--changed with no base', ['--changed'], none, /--changed/],
    ['--changed twice', ['--changed', 'HEAD', '--changed', 'main'], none, /--changed/],
    ['--changed= twice', ['--changed=HEAD', '--changed=main'], none, /--changed/],
  ]
  it.each(refusals)('exits 1 and calls no claude on %s', (_, args, extra, stderr) => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nOne more rule.\n')
    const { run, calls } = evalIn(repo, args, extra(repo))
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(stderr)
    expect(calls).toEqual([])
  })

  it('exits 1 and calls no claude while the map has a problem', () => {
    const { repo } = changedRepo()
    writeFileIn(join(repo, 'harness', 'skills', 'new', 'SKILL.md'), '# new\n')
    const { run, calls } = evalIn(repo, ['--changed', 'HEAD'])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('not mapped: skills/new/SKILL.md')
    expect(calls).toEqual([])
  })
})

describe('pnpm eval:harness: one line per call for the PR description, from aggregate-result.json', () => {
  const implementerChange = (): string => {
    const { repo } = changedRepo()
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nOne more rule.\n')
    return repo
  }

  it('prints the numbers of the report the call wrote', () => {
    const { run } = evalIn(implementerChange(), ['--changed', 'HEAD'], { STUB_AGGREGATE: aggregate() })
    expect(run.status, run.stderr).toBe(0)
    expect(lines(run.stdout)).toContain('eval:harness main: casesPassed 1 of 1, overallScore 1, costUsd 0.3, claudeVersion 2.1.289, cases implementer-report')
  })

  it('ends the line with ", partial" for a partial run', () => {
    const { run } = evalIn(implementerChange(), ['--changed', 'HEAD'], { STUB_AGGREGATE: aggregate({ partial: true }) }, '2')
    expect(run.status).toBe(2)
    expect(lines(run.stdout)).toContain('eval:harness main: casesPassed 1 of 1, overallScore 1, costUsd 0.3, claudeVersion 2.1.289, cases implementer-report, partial')
  })

  it('says so when the call wrote no report, and keeps the exit code of the call', () => {
    const { run } = evalIn(implementerChange(), ['--changed', 'HEAD'], { STUB_AGGREGATE: '' }, '1')
    expect(run.status).toBe(1)
    expect(lines(run.stdout)).toContain('eval:harness main: no aggregate-result.json')
  })

  it('says so when the report is not JSON', () => {
    const { run } = evalIn(implementerChange(), ['--changed', 'HEAD'], { STUB_AGGREGATE: '{ not json' })
    expect(run.status, run.stderr).toBe(0)
    expect(lines(run.stdout)).toContain('eval:harness main: no aggregate-result.json')
  })

  it('prints the lines without --changed too, counting the cases each call selects', () => {
    const report = aggregate({ costUsd: 1.4120472000000002, aggregates: { casesPassed: 8, overallScore: 0.8888888888888888 } })
    const { run, calls } = evalHarness('2.1.289', '0,0', [], undefined, { STUB_AGGREGATE: report })
    expect(run.status, run.stderr).toBe(0)
    expect(calls).toHaveLength(2)
    const main = CASES.filter(([, tag]) => tag === 'main').map(([name]) => name).sort()
    expect(lines(run.stdout)).toContain(`eval:harness main: casesPassed 8 of ${main.length}, overallScore 0.89, costUsd 1.41, claudeVersion 2.1.289, cases ${main.join(',')}`)
    expect(lines(run.stdout)).toContain('eval:harness gui: casesPassed 8 of 1, overallScore 0.89, costUsd 1.41, claudeVersion 2.1.289, cases no-os-screen-capture')
  })
})

// pnpm passes the `--` of `pnpm eval:harness -- …` on to the script as it is, after any argument
// before it; claude takes whatever follows a `--` for positional arguments (worfy-harness ticket 70).
describe('pnpm eval:harness: a `--` anywhere, the cost limit of the user, --dry-run (claude replaced by a stub)', () => {
  /** A branch whose change to the epic-wave skill chooses three cases of the main tag, three calls. */
  const threeCalls = (): string => {
    const { repo, git } = changedRepo()
    expect(git('checkout', '-q', '-b', 'topic').status).toBe(0)
    appendFileSync(join(repo, 'harness', 'skills', 'epic-wave', 'SKILL.md'), '\nOne more rule.\n')
    expect(git('commit', '-q', '-am', 'change epic-wave').status).toBe(0)
    return repo
  }
  const limits = (calls: StubCall[]): string[][] => calls.map((call) => listAfter(call.args, '--max-cost-usd'))
  const count = (args: string[], option: string): number => args.filter((arg) => arg === option || arg.startsWith(`${option}=`)).length
  const THREE = [['epic-wave-old-form'], ['epic-wave-tickets'], ['reviewer-verdict']]

  it('gives each call only its chosen case when `--` follows --changed, and no call a `--`', () => {
    const { run, calls } = evalIn(threeCalls(), ['--changed', 'main', '--', '--runs', '1'])
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(caseArgs(calls)).toEqual(THREE)
    for (const call of calls) {
      expect(call.args).not.toContain('--')
      expect(count(call.args, '--case')).toBe(1)
      expect(listAfter(call.args, '--runs')).toEqual(['1'])
    }
    expect(run.stdout).not.toMatch(/cases mismatch/)
  })

  it('drops a `--` that stands between the options of the script and those for claude', () => {
    const { run, calls } = evalIn(threeCalls(), ['--runs', '1', '--', '--changed', 'main'])
    expect(run.status, run.stderr).toBe(0)
    expect(caseArgs(calls)).toEqual(THREE)
    for (const call of calls) expect(call.args).not.toContain('--')
  })

  it('ends the line of a call whose report has more cases than the script chose with "cases mismatch", exit not 0', () => {
    const repo = changedRepo().repo
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nOne more rule.\n')
    const { run } = evalIn(repo, ['--changed', 'HEAD'], { STUB_AGGREGATE: aggregate({ aggregates: { casesTotal: 3, casesPassed: 3, overallScore: 1 } }) })
    expect(run.status).not.toBe(0)
    expect(lines(run.stdout)).toContain(
      'eval:harness main: casesPassed 3 of 1, overallScore 1, costUsd 0.3, claudeVersion 2.1.289, cases implementer-report, cases mismatch: report 3, chosen 1',
    )
  })

  it('says "cases mismatch" for a report that ran another case than the chosen one', () => {
    const repo = changedRepo().repo
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nOne more rule.\n')
    const { run } = evalIn(repo, ['--changed', 'HEAD'], { STUB_AGGREGATE: aggregate({ cases: [{ name: 'status-block' }] }) })
    expect(run.status).not.toBe(0)
    expect(run.stdout).toMatch(/cases implementer-report, cases mismatch: report 1, chosen 1\n/)
  })

  it('lowers the budget of the run to the --max-cost-usd after `--`: 3, then what is left, then no call (exit 2)', () => {
    const { run, calls } = evalIn(threeCalls(), ['--changed', 'main', '--', '--max-cost-usd', '3'], { STUB_AGGREGATE: aggregate({ costUsd: 1.5 }) })
    expect(caseArgs(calls)).toEqual(THREE.slice(0, 2))
    expect(limits(calls)).toEqual([['3'], ['1.5']])
    for (const call of calls) expect(count(call.args, '--max-cost-usd')).toBe(1)
    expect(run.status).toBe(2)
    expect(lines(run.stdout)).toContain('eval:harness: budget 3 USD (--max-cost-usd 3)')
    expect(run.stdout).toMatch(/the 3 USD of this run are spent .*main-reviewer-verdict call and any after it are skipped/)
  })

  const forms: [name: string, args: string[]][] = [
    ['--max-cost-usd=3 after `--`', ['--', '--max-cost-usd=3']],
    ['--max-cost-usd 3 without `--`', ['--max-cost-usd', '3']],
    ['--max-cost-usd=3 without `--`', ['--max-cost-usd=3']],
    ['--max-cost-usd 3 before `--`', ['--max-cost-usd', '3', '--', '--runs', '1']],
  ]
  it.each(forms)('takes %s without --changed: one --max-cost-usd per call, the budget is 3', (_, args) => {
    const { run, calls } = evalHarness('2.1.289', '0,0', args, undefined, { STUB_AGGREGATE: aggregate({ costUsd: 1.5, aggregates: { casesPassed: 1, overallScore: 1 } }) })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(limits(calls)).toEqual([['3'], ['1.5']])
    for (const call of calls) {
      expect(count(call.args, '--max-cost-usd')).toBe(1)
      expect(call.args).not.toContain('--')
    }
    expect(lines(run.stdout)).toContain('eval:harness: budget 3 USD (--max-cost-usd 3)')
  })

  it('keeps the ceiling of 30 USD under a larger --max-cost-usd, and says so', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0', ['--', '--max-cost-usd', '50'])
    expect(run.status, run.stderr).toBe(0)
    expect(limits(calls)).toEqual([['30'], ['30']])
    expect(run.stdout).toMatch(/--max-cost-usd 50 is above the ceiling of this script: the budget stays 30 USD/)
    expect(lines(run.stdout)).toContain('eval:harness: budget 30 USD (BUDGET_USD)')
  })

  it('names BUDGET_USD as the budget without a --max-cost-usd', () => {
    const { run } = evalHarness('2.1.289', '0,0')
    expect(run.status, run.stderr).toBe(0)
    expect(lines(run.stdout)).toContain('eval:harness: budget 30 USD (BUDGET_USD)')
  })

  const badLimits: [name: string, args: string[]][] = [
    ['0', ['--', '--max-cost-usd', '0']],
    ['a negative number', ['--max-cost-usd', '-1']],
    ['abc', ['--', '--max-cost-usd', 'abc']],
    ['no value at the end', ['--', '--max-cost-usd']],
    ['no value before another option', ['--max-cost-usd', '--runs', '1']],
    ['an empty --max-cost-usd=', ['--max-cost-usd=']],
    ['two of them', ['--max-cost-usd', '3', '--', '--max-cost-usd=2']],
  ]
  it.each(badLimits)('exits 1 and calls no claude on --max-cost-usd %s', (_, args) => {
    const repo = changedRepo().repo
    const { run, calls, versionCalls } = evalIn(repo, args)
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(/--max-cost-usd/)
    expect(calls).toEqual([])
    expect(versionCalls).toBe(0)
  })

  it('exits 1 and calls no claude on an --output-dir of the user: each call writes its own', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0', ['--', '--output-dir', tempDir('worfy-eval-out-')])
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(/--output-dir/)
    expect(calls).toEqual([])
  })

  // claude adds up every --tag it gets and keeps the last --case: an option of the user next to the
  // call's own would widen the call or replace its case.
  it('gives each call only its own --tag when the user names tags: no call runs the cases of the other tag', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0', ['--', '--tag', 'main', 'gui', '--runs', '1'])
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(calls.map((call) => listAfter(call.args, '--tag'))).toEqual([['main'], ['gui']])
    for (const call of calls) {
      expect(count(call.args, '--tag')).toBe(1)
      expect(count(call.args, '--case')).toBe(0)
      expect(listAfter(call.args, '--runs')).toEqual(['1'])
    }
    expect(run.stdout).not.toMatch(/cases mismatch/)
  })

  it('turns the --case globs of the user into one call per chosen case, each with its one --case', () => {
    const { run, calls } = evalHarness('2.1.289', '0,0', ['--', '--case', 'epic-wave-*', '--case', 'status-block', '--tag', 'main'])
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(calls.map((call) => listAfter(call.args, '--case'))).toEqual([['epic-wave-old-form'], ['epic-wave-tickets'], ['status-block']])
    for (const call of calls) {
      expect(count(call.args, '--case')).toBe(1)
      expect(count(call.args, '--tag')).toBe(1)
    }
    expect(run.stdout).not.toMatch(/cases mismatch/)
  })

  it('says "cases mismatch" when a chosen case is missing from the report, but not for a partial run', () => {
    const repo = changedRepo().repo
    appendFileSync(join(repo, 'harness', 'agents', 'implementer.md'), '\nOne more rule.\n')
    const missing = evalIn(repo, ['--changed', 'HEAD'], { STUB_AGGREGATE: aggregate({ cases: [] }) })
    expect(missing.run.status).not.toBe(0)
    expect(missing.run.stdout).toMatch(/cases implementer-report, cases mismatch: report 0, chosen 1\n/)
    const partial = evalIn(repo, ['--changed', 'HEAD'], { STUB_AGGREGATE: aggregate({ cases: [], partial: true }) })
    expect(partial.run.status, partial.run.stderr).toBe(0)
    expect(partial.run.stdout).toMatch(/cases implementer-report, partial\n/)
  })

  it('rounds what is left of the budget down to the cent, never up', () => {
    const { run, calls } = evalIn(threeCalls(), ['--changed', 'main'], { STUB_AGGREGATE: aggregate({ costUsd: 0.004 }) })
    expect(run.status, run.stderr).toBe(0)
    // 30 - 0.004 is 29.996: toFixed(2) would give the second call 30, more than is left.
    expect(limits(calls)).toEqual([['30'], ['29.99'], ['29.99']])
    // 3 - 0.7 is 2.3, whose hundredfold is 229.99999999999997 in floating point: still 2.3, not 2.29.
    const tenths = evalIn(threeCalls(), ['--changed', 'main', '--', '--max-cost-usd', '3'], { STUB_AGGREGATE: aggregate({ costUsd: 0.7 }) })
    expect(limits(tenths.calls)).toEqual([['3'], ['2.3'], ['1.6']])
  })

  const dryValues: [name: string, args: string[]][] = [
    ['--dry-run=1', ['--dry-run=1']],
    ['an empty --dry-run=', ['--dry-run=']],
    ['--dry-run=true after `--`', ['--', '--dry-run=true']],
  ]
  it.each(dryValues)('exits 1 and calls no claude on %s: a dry run takes no value', (_, args) => {
    const repo = changedRepo().repo
    const { run, calls, versionCalls } = evalIn(repo, args)
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(/--dry-run takes no value/)
    expect(calls).toEqual([])
    expect(versionCalls).toBe(0)
  })

  /** The command lines --dry-run prints, and those a real run gave the stub, with the copy and the time made alike. */
  const PLUGIN = '<plugin-copy>'
  const stamp = (text: string): string => text.replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g, '<time>')
  const printed = (stdout: string): string[] =>
    lines(stdout)
      .map((line) => /^eval:harness: \S+ — claude (.*)$/.exec(line)?.[1])
      .filter((line): line is string => line !== undefined)
      .map(stamp)
  const given = (calls: StubCall[]): string[] => calls.map((call) => stamp(call.args.join(' ').split(call.args[2] ?? '').join(PLUGIN)))

  it.each([
    ['with --changed', ['--changed', 'main', '--', '--max-cost-usd', '3'], 3],
    ['without --changed', ['--', '--max-cost-usd', '3', '--runs', '1'], 2],
  ])('--dry-run %s starts nothing and prints the command line of each call that a real run gives claude', (_, args, n) => {
    const repo = threeCalls()
    const dry = evalIn(repo, ['--dry-run', ...args])
    expect(dry.run.status, `${dry.run.stdout}\n${dry.run.stderr}`).toBe(0)
    expect(dry.calls).toEqual([])
    expect(dry.versionCalls).toBe(0)
    expect(existsSync(join(repo, 'harness', 'evals', 'results'))).toBe(false)
    expect(lines(dry.run.stdout)).toContain('eval:harness: budget 3 USD (--max-cost-usd 3)')
    const real = evalIn(repo, args)
    expect(real.run.status, real.run.stderr).toBe(0)
    expect(real.calls).toHaveLength(n)
    expect(printed(dry.run.stdout)).toEqual(given(real.calls))
    for (const line of printed(dry.run.stdout)) expect(line.split(' ')).not.toContain('--')
  })

  it('--dry-run prints the limit the first real call gets, rounded down to the cent', () => {
    const repo = threeCalls()
    const dry = evalIn(repo, ['--dry-run', '--', '--max-cost-usd', '2.999'])
    expect(dry.run.status, dry.run.stderr).toBe(0)
    expect(dry.calls).toEqual([])
    const real = evalIn(repo, ['--', '--max-cost-usd', '2.999'])
    expect(limits(real.calls)[0]).toEqual(['2.99'])
    expect(printed(dry.run.stdout)).toEqual(given(real.calls))
  })

  it('--dry-run keeps the refusals of --changed: an unknown base exits 1', () => {
    const repo = changedRepo().repo
    const { run, calls, versionCalls } = evalIn(repo, ['--dry-run', '--changed', 'no-such-branch'])
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(/no-such-branch/)
    expect(calls).toEqual([])
    expect(versionCalls).toBe(0)
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
