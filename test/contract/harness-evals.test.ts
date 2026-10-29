// The eval cases of the Harness (harness/evals/, ticket worfy-harness/27) are run by
// `claude plugin eval` through `pnpm eval:harness`: by hand, on a Mac, against the owner's model
// account. This test is their free part and never starts claude: every case has the files
// `claude plugin eval` needs, every scaffold script builds its fixture in a temporary folder with a
// temporary HOME, and the fixture is a project the Harness scripts recognise (bin/profile exit 0,
// epic-status sees four tickets). pnpm eval:harness itself, against a stub claude, and the map of
// rule files are checked in harness-evals-run.test.ts; the helpers both files need are in
// harness-evals-shared.ts.
import { createHash } from 'node:crypto'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { findStatusBlock } from '../../src/shared/agent/status-block'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { CASES, childEnv, EVALS, HARNESS, SCAFFOLD_TIMEOUT_MS, stubSetup, tempDir } from './harness-evals-shared'

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

describe('the temporary folders of this file', () => {
  let made = ''
  let kept = ''
  let before = ''
  beforeAll(() => {
    before = tempDir('worfy-eval-before-')
  })
  it('a test makes one of its own and one for the file', () => {
    made = tempDir('worfy-eval-own-')
    kept = tempDir('worfy-eval-kept-', 'file')
    expect(existsSync(made)).toBe(true)
  })
  it('is removed after the test that made it, not at the end of the file', () => {
    expect(made).not.toBe('')
    expect(existsSync(made)).toBe(false)
  })
  it('stays until the end of the file when kept for the file or made in a beforeAll', () => {
    expect(existsSync(kept)).toBe(true)
    expect(existsSync(before)).toBe(true)
  })
})

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
  keep: 'test' | 'file' = 'test',
): { work: string; home: string; run: SpawnSyncReturns<string> } {
  const root = tempDir('worfy-eval-', keep)
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
 * The environment of a Harness script: the fixture's home, PATH, TMPDIR and LANG, and `extra`.
 */
const harnessEnv = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  childEnv(home, {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG ?? 'C.UTF-8',
    ...extra,
  })

/**
 * Runs a Harness script against a scaffolded fixture with only the fixture's home (and `extra`).
 * The scripts are Node scripts (`#!/usr/bin/env node`), started as `<this Node> <script>`: Windows
 * starts no script by its path, only .exe and .com.
 */
const harness = (home: string, cwd: string, script: string, args: string[], extra: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> =>
  spawnSync(scriptNode(), [join(HARNESS, 'bin', script), ...args], {
    cwd,
    env: harnessEnv(home, extra),
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })

/** What a folder holds: the path, the kind and the content of every entry, as one hash. */
const contentOf = (dir: string): string => {
  const hash = createHash('sha1')
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true }).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)))) {
    const path = join(entry.parentPath, entry.name)
    hash.update(`${relative(dir, path)}\0`)
    if (entry.isFile()) hash.update(readFileSync(path))
    else hash.update(entry.isDirectory() ? 'dir' : 'other')
    hash.update('\0')
  }
  return hash.digest('hex')
}

interface CaseFixture {
  work: string
  home: string
  /** The scaffold run that built the fixture. */
  run: SpawnSyncReturns<string>
  /** A copy of work and home as the scaffold left them, next to them. */
  built: string
  content: string
}

/**
 * The fixture of each case as its scaffold builds it without EVAL_*: one build per case for the file,
 * not one per test that reads it. A build is bash, node and about ten git calls, some 5 s on the
 * Windows runner, and eight tests built a fixture the per-case test had already built with the same
 * arguments. The fixture writes its own path into its gate registry ("match", "pm"), so it is right
 * only at the path it was built at: a test that writes into it (caseFixtureToChange) works in it at
 * that path, and after the test it is put back from the copy of the build. A test that only reads it
 * (caseFixture) shares it; afterEach fails a test that changed a shared fixture, and puts the
 * fixture back for the tests after it. A build that failed is built again for the next test.
 */
const caseFixtures = new Map<string, CaseFixture>()
const sharedNow = new Set<string>()
const changedNow = new Set<string>()

const contentOfFixture = (fixture: CaseFixture): string => `${contentOf(fixture.work)}:${contentOf(fixture.home)}`

function builtFixture(name: string): CaseFixture {
  const known = caseFixtures.get(name)
  if (known !== undefined && known.run.status === 0) return known
  const { work, home, run } = scaffold(name, {}, undefined, 'file')
  const built = join(dirname(work), 'built')
  cpSync(work, join(built, 'work'), { recursive: true })
  cpSync(home, join(built, 'home'), { recursive: true })
  const fixture: CaseFixture = { work, home, run, built, content: '' }
  fixture.content = contentOfFixture(fixture)
  caseFixtures.set(name, fixture)
  return fixture
}

/** Puts the fixture back as its scaffold built it. */
function putBack(fixture: CaseFixture): void {
  for (const [dir, part] of [
    [fixture.work, 'work'],
    [fixture.home, 'home'],
  ] as const) {
    removeTestTree(dir)
    cpSync(join(fixture.built, part), dir, { recursive: true })
  }
}

/** The fixture of case `name`, shared with the other tests of the file: the test only reads it. */
const caseFixture = (name: string): CaseFixture => {
  sharedNow.add(name)
  return builtFixture(name)
}

/** The fixture of case `name` for a test that writes into it: its own until the test ends. */
const caseFixtureToChange = (name: string): CaseFixture => {
  changedNow.add(name)
  return builtFixture(name)
}

afterEach(() => {
  const changed: string[] = []
  for (const name of new Set([...sharedNow, ...changedNow])) {
    const fixture = caseFixtures.get(name)
    if (fixture === undefined || fixture.run.status !== 0) continue
    if (changedNow.has(name)) putBack(fixture)
    else if (contentOfFixture(fixture) !== fixture.content) {
      changed.push(name)
      putBack(fixture)
    }
  }
  sharedNow.clear()
  changedNow.clear()
  if (changed.length > 0) throw new Error(`the test changed the shared fixture of ${changed.join(', ')}: a test that writes into a fixture takes caseFixtureToChange`)
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

    // One scaffold without EVAL_* serves the three checks of that fixture: building it is the cost of
    // the test (about 1.5 s on macOS, 5 s on Windows), and the profile runs only read it. The same
    // build serves the later tests of this file that read the fixture of a case (caseFixture).
    // On Windows the profile runs need the paths of the fixture's gate registry ("match", "pm") in
    // node's spelling, C:/…/work, not /tmp/…/work of Git Bash: harness/evals/lib/demo-project.sh
    // writes them from node's realpathSync.native (worfy-windows ticket 65, step 4).
    it('builds its fixture with exit code 0 in a temporary HOME, and bin/profile -C <fixture> finds profile demo with and without EVAL_HARNESS_HOME', () => {
      const { work, home, run } = caseFixture(name)
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
      expect(existsSync(join(work, '.git'))).toBe(true)
      expect(existsSync(join(home, '.claude', 'worfy-harness', 'projects', 'demo', 'profile.json'))).toBe(true)
      const profile = harness(home, work, 'profile', ['-C', work, '--name'])
      expect(profile.status, profile.stderr).toBe(0)
      expect(profile.stdout.trim()).toBe('demo')

      // pnpm eval:harness gives every run EVAL_HARNESS_HOME=worfy-harness, but `claude plugin eval`
      // starts the scaffold with a short fixed environment and no EVAL_* (claude 2.1.289): the fixture
      // never sees EVAL_HARNESS_HOME, and the scripts of the run must still find its state in <fixture>/.git.
      expect(existsSync(join(work, '.git', 'worfy-harness', 'gate', 'config.json'))).toBe(true)
      const evalProfile = harness(home, work, 'profile', ['-C', work, '--name'], { EVAL_HARNESS_HOME: 'worfy-harness' })
      expect(evalProfile.status, evalProfile.stderr).toBe(0)
      expect(evalProfile.stdout.trim()).toBe('demo')
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
// realpathSync.native (worfy-windows ticket 65, step 4). A scaffold without EVAL_* is checked with
// bin/profile in the test "builds its fixture" of each case above.
describe('harness/evals: the fixture is a project the Harness recognises', () => {
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
    const { work, home, run } = caseFixture('status-block')
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
      spawnSync(scriptNode(), [guard, home, work], { env: { ...env, ...extra }, encoding: 'utf8' })
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
    const run = spawnSync(scriptNode(), [join(EVALS, 'lib', 'state-guard.cjs'), link, tempDir('worfy-eval-guard-')], {
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
    const run = spawnSync(scriptNode(), [join(EVALS, 'lib', 'state-guard.cjs'), realHome.toUpperCase(), tempDir('worfy-eval-guard-')], {
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
      spawnSync(scriptNode(), [join(EVALS, 'lib', 'state-guard.cjs'), home, tempDir('worfy-eval-guard-')], {
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
      spawnSync(scriptNode(), [join(EVALS, 'lib', 'state-guard.cjs'), home, tempDir('worfy-eval-guard-')], {
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
      const run = spawnSync(scriptNode(), [join(EVALS, 'lib', 'state-guard.cjs'), home, caseWork], {
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
    const { work, home, run } = caseFixtureToChange('status-block')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const registry = JSON.parse(readFileSync(join(work, '.git', 'worfy-harness', 'gate', 'config.json'), 'utf8')) as { repos: { pm: string }[] }
    const pm = registry.repos[0]?.pm ?? ''
    expect(existsSync(pm), pm).toBe(true)
    // Both sides in the long spelling: `work` keeps an 8.3 short name of TEMP (the runner's
    // C:\Users\RUNNER~1) that the fixture's `pm` does not. Across drives `relative` gives an
    // absolute path, not `..`, so that counts as outside too.
    const inside = relative(realpathSync.native(work), realpathSync.native(pm))
    expect(inside.startsWith('..') || isAbsolute(inside), pm).toBe(false)
    const gate = spawnSync(scriptNode(), [join(HARNESS, 'hooks', 'gate.mjs'), 'fast'], {
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
    const { work, run } = caseFixture('status-block')
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
    const { work, home, run } = caseFixtureToChange('reviewer-verdict')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const gate = spawnSync(scriptNode(), [join(HARNESS, 'hooks', 'gate.mjs'), 'fast'], {
      cwd: work,
      env: childEnv(home, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'C.UTF-8', GATE_SCOPE: 'all', EVAL_HARNESS_HOME: 'worfy-harness' }),
      encoding: 'utf8',
      input: '',
      timeout: SCAFFOLD_TIMEOUT_MS,
    })
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(2)
  })

  it('epic-status sees the four tickets of epic demo', () => {
    const { work, home } = caseFixture('status-block')
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
    const { work, home, run } = caseFixture('reviewer-intended-breakage')
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
    const { work, home, run } = caseFixture('reviewer-simplification')
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

// Every child of this file and of harness-evals-run.test.ts that runs a scaffold script, a Harness
// script, git in a fixture or eval-harness.mjs with the claude stub gets its home from childEnv
// (harness-evals-shared.ts). A child that saw the owner's
// real home would read the real Harness registry in ~/.claude/worfy-harness and ~/.claude/gate, and
// a Harness script that writes would write there (worfy-windows ticket 65). The tests' own git calls
// that read the repository (the control `git --exec-path` and `git check-ignore`) run the real git
// with this process's environment and write nothing.
describe('a child process sees the temporary home', () => {
  // The variables of a caller that names a home of its own: the real one. Built from names, so the
  // scan below (no HOME or USERPROFILE key outside childEnv) does not count them.
  const foreignHome = (): NodeJS.ProcessEnv => Object.fromEntries(['HOME', 'USERPROFILE'].map((name) => [name, homedir()]))
  const launchers: [name: string, env: (home: string) => NodeJS.ProcessEnv][] = [
    ['scaffold', (home) => scaffoldEnv(home)],
    ['scaffold, a caller with its own home', (home) => scaffoldEnv(home, foreignHome())],
    ['harness', (home) => harnessEnv(home)],
    ['harness, a caller with its own home', (home) => harnessEnv(home, foreignHome())],
    ['inFixture', (home) => fixtureEnv(home)],
    ['the claude stub', () => stubSetup('2.1.289', '0,0', () => process.env.PATH ?? '', {}).env],
    ['the claude stub, a caller with its own home', () => stubSetup('2.1.289', '0,0', () => process.env.PATH ?? '', foreignHome()).env],
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

  it.each(launchers)('%s: a Node child takes the temporary home for os.homedir()', (_, envOf) => {
    const env = envOf(tempDir('worfy-eval-home-'))
    const child = spawnSync(scriptNode(), ['-e', 'process.stdout.write(require("node:os").homedir())'], {
      env,
      encoding: 'utf8',
      timeout: SCAFFOLD_TIMEOUT_MS,
    })
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toBe(env.HOME)
    expect(child.stdout).not.toBe(homedir())
  })

  // A new spawn that writes its own home past childEnv, or that names no environment and so passes
  // on the real home, makes this test red.
  // The scan reads this file, harness-evals-run.test.ts and the module both import.
  it('every spawn and spawnSync of the harness-evals files names its environment, and only childEnv names a home', () => {
    const files = ['harness-evals.test.ts', 'harness-evals-run.test.ts', 'harness-evals-shared.ts'].map((name) => join(__dirname, name))
    expect(files).toContain(__filename)
    const sources = files.map((file) => readFileSync(file, 'utf8'))
    const lineIn = (source: string, index: number): string => source.slice(source.lastIndexOf('\n', index) + 1, source.indexOf('\n', index))
    // The definition starts its line; the text of this test names it only inside a line.
    const helpers = sources.flatMap((source) => [...source.matchAll(/^(?:export )?const childEnv = /gm)].map((match) => lineIn(source, match.index)))
    expect(helpers).toHaveLength(1)
    const helper = helpers[0] ?? ''
    expect(helper).toMatch(/\bHOME: home\b/)
    expect(helper).toMatch(/\bUSERPROFILE: home\b/)
    // A key HOME or USERPROFILE anywhere but in childEnv.
    const keys = sources.flatMap((source) =>
      [...source.matchAll(/(?<![\w$])(?:HOME|USERPROFILE)\s*:/g)].map((match) => lineIn(source, match.index)).filter((line) => line !== helper),
    )
    expect(keys).toEqual([])
    // A spawn or spawnSync call that names HOME or USERPROFILE itself.
    const calls: string[] = []
    // A call starts with a quote or a name, maybe on the next line: the pattern below is no call.
    for (const source of sources) {
      for (const match of source.matchAll(/\bspawn(?:Sync)?\((?=\s*['"\w])/g)) {
        let depth = 0
        let end = match.index + match[0].length - 1
        for (; end < source.length; end++) {
          if (source[end] === '(') depth++
          else if (source[end] === ')' && --depth === 0) break
        }
        calls.push(source.slice(match.index, end + 1))
      }
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
