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
import { MIND_MAP_NODE_KINDS } from '../../src/shared/product/mind-map'
import { productCriticFolder, productFolder } from '../../src/shared/product/paths'
import { MIND_MAP_TOOL_NAMES, mindMapToolShapes } from '../../src/shared/product/tools'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { CASES, childEnv, EVALS, HARNESS, SCAFFOLD_TIMEOUT_MS, stubSetup, tempDir } from './harness-evals-shared'
import { ms } from '../time-scale'

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
  it('holds exactly the sixteen cases', () => {
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

    // One scaffold without EVAL_* serves the three checks of that fixture, and the later tests of this
    // file that read the fixture of a case (caseFixture). It is built here, in a hook, not in the first
    // test that asks for it: the build is about 1.5 s on macOS and 5 s on Windows alone, and under the
    // load of a full run on Windows it took the test past its own limit, a failure that named the
    // test's checks rather than the build (worfy-polish 41). The 45 s budget is split between the build
    // hook and the checks; the total is unchanged: the test had the contract tests' 15 s times the run's
    // multiplier, 3 by default (vitest.config.ts); now the hook has 10 s and the test 5 s of it,
    // each times the same multiplier. A build past its part fails this hook, under its own name; a build that exits
    // non-zero fails no hook: the test below reports its exit code with its output.
    let built: CaseFixture | undefined
    beforeAll(() => {
      const started = performance.now()
      built = builtFixture(name)
      // The build time in the run's log, so a full run shows how much of its part the build takes. Written to stdout
      // itself: the agent reporter of a run started by an agent (AI_AGENT, CLAUDECODE) hides console output.
      process.stdout.write(`[harness-evals] ${name}: fixture built in ${Math.round(performance.now() - started)} ms, the hook's limit ${ms(10_000)} ms\n`)
    }, ms(10_000))

    // On Windows the profile runs need the paths of the fixture's gate registry ("match", "pm") in
    // node's spelling, C:/…/work, not /tmp/…/work of Git Bash: harness/evals/lib/demo-project.sh
    // writes them from node's realpathSync.native (worfy-windows ticket 65, step 4).
    it('builds its fixture with exit code 0 in a temporary HOME, and bin/profile -C <fixture> finds profile demo with and without EVAL_HARNESS_HOME', () => {
      if (built === undefined) throw new Error(`the beforeAll of ${name} built no fixture`)
      // The build the hook recorded, not caseFixture(name): that would build a failed fixture again, here.
      sharedNow.add(name)
      const { work, home, run } = built
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
    }, ms(5_000))
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

  // The reviewer's lens "implementer's report" (agents/reviewer.md) starts the answer with
  // `REJECTED: <the unconfirmed claims>`, and one verdict only: VERIFIED never shares that line. The
  // grader reads the saved answer the way `claude plugin eval` runs a regex grader: new RegExp(pattern,
  // flags) on the text as it is, no trim, so with no `m` flag `^` is the start of the answer.
  it('reviewer-verdict: the rejected-first grader takes one REJECTED: verdict and refuses a missing colon or a second verdict', () => {
    const grader = frontMatter(join(EVALS, 'reviewer-verdict', 'graders', 'rejected-first.md'))
    const pattern = new RegExp(field(grader, 'pattern') ?? '<none>', field(grader, 'flags') ?? '')
    const grade = (answer: string): boolean => pattern.test(answer)
    const claim = '`node --test` exits 0 — it exits 1 (reported 0, mine 1)'
    expect(grade(`REJECTED: ${claim}`)).toBe(true)
    expect(grade(`REJECTED: ${claim}\nRan: node --test, exit code 1.\nThe other claims: VERIFIED by re-reading.`)).toBe(true)
    expect(grade(`REJECTED: ${claim}\r\nRan: node --test, exit code 1.\r\n`)).toBe(true)
    expect(grade(`Ran: node --test.\nREJECTED: ${claim}`)).toBe(false)
    expect(grade(`REJECTED — ${claim}`)).toBe(false)
    expect(grade(`REJECTED ${claim}`)).toBe(false)
    expect(grade(`REJECTED: ${claim}; VERIFIED: the rest`)).toBe(false)
    expect(grade('VERIFIED')).toBe(false)
    expect(grade(`Verdict: REJECTED: ${claim}`)).toBe(false)
    expect(grade(`**REJECTED:** ${claim}`)).toBe(false)
  })
})

// worfy-product-session ticket 12: the skill product-ideas (skills/product-ideas/SKILL.md) answers
// 3-5 ideas in one format, each with four fields, at least one against the roadmap, and puts each
// idea on the Mind map with mind_map_add. The regex graders of the case read that format; they run
// the way `claude plugin eval` runs a regex grader: new RegExp(pattern, flags) on the reply as it is.
describe('harness/evals: product-ideas', () => {
  const CASE = join(EVALS, 'product-ideas')
  const SKILL = join(HARNESS, 'skills', 'product-ideas', 'SKILL.md')
  const FIELDS = ['For whom:', 'Why now:', 'Cost:', 'How we will know it worked:']
  const AGAINST = 'Against the roadmap:'
  const grader = (name: string): string => frontMatter(join(CASE, 'graders', name))
  const pattern = (name: string): RegExp => new RegExp(field(grader(name), 'pattern') ?? '<none>', field(grader(name), 'flags') ?? '')
  /** Whether the reply passes a regex grader, `match: not_contains` included. */
  const passes = (name: string, reply: string): boolean => (field(grader(name), 'match') === 'not_contains') !== pattern(name).test(reply)
  const idea = (n: number, fields: string[] = FIELDS, bold = false): string =>
    `### Idea ${n}: A title\n\n${fields.map((label) => `- ${bold ? `**${label}**` : label} some text.`).join('\n')}\n\n`
  const reply = (ideas: string): string => `Here are the ideas.\n\n${ideas}## What I do not know\n\nThere are no product analytics.\n`
  const REPLY_GRADERS = ['three-ideas.md', 'at-most-five.md', 'four-fields.md', 'against-roadmap.md']

  // Red before the skill exists: the case asks for ideas, and without skills/product-ideas/SKILL.md
  // no run can call worfy:product-ideas, so the skill-called grader fails every run.
  it('is a skill of the plugin the model may call: name product-ideas, a description, no disable-model-invocation', () => {
    expect(existsSync(SKILL)).toBe(true)
    const yaml = frontMatter(SKILL)
    expect(field(yaml, 'name')).toBe('product-ideas')
    expect(field(yaml, 'description')?.length ?? 0).toBeGreaterThan(40)
    expect(field(yaml, 'disable-model-invocation')).toBeUndefined()
    expect(field(grader('skill-called.md'), 'input_match')).toContain('worfy:product-ideas')
  })

  it('writes each idea under the heading and with the labels the graders read', () => {
    const text = readFileSync(SKILL, 'utf8')
    expect(text).toContain('### Idea <N>: ')
    for (const label of [...FIELDS, AGAINST]) expect(text).toContain(`- ${label}`)
  })

  it('names only tools of the worfy-mind-map server, and an idea node as mind_map_add takes it', () => {
    const text = readFileSync(SKILL, 'utf8')
    const named = [...new Set([...text.matchAll(/\b(?:mind_map_[a-z_]+|product_[a-z_]+)\b/g)].map((match) => match[0]))]
    expect(named).toContain('mind_map_add')
    for (const name of named) expect(MIND_MAP_TOOL_NAMES as string[]).toContain(name)
    expect(MIND_MAP_NODE_KINDS as readonly string[]).toContain('idea')
    for (const key of ['topic', 'kind', 'text', 'from', 'advice']) {
      expect(Object.keys(mindMapToolShapes.mind_map_add)).toContain(key)
      // `topic`, or `advice: true` with its value.
      expect(text).toMatch(new RegExp(`\`${key}(?:\`|: )`))
    }
    expect(text).toContain('`advice: true`')
    // The kind the skill passes, as the server takes it.
    expect(text).toContain('- `kind` — `idea`;')
  })

  // In Silent mode the tickets root and the product folder lie in the Workflow folder: a relative
  // tickets.root or docs/product/ read from the repository root finds nothing there.
  it('reads the tickets root from bin/ticket root and the drafts from the product folder chosen by mode', () => {
    const text = readFileSync(SKILL, 'utf8')
    expect(text).toContain('`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" root` prints its absolute path')
    expect(text).not.toContain('--field tickets.root')
    expect(text).toContain('`"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field _resolved.mode`')
    expect(text).toContain('in Silent mode `<Workflow folder>/product/`')
    expect(text).toContain('`"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field _resolved.workflow_folder`')
    for (const path of ['`<tickets root>/*/spec.md`', '`<tickets root>/*/issues/*.md`', '`<product folder>/*/drafts/`', '`<product folder>/<topic>/`']) expect(text).toContain(path)
    expect(text).not.toMatch(/docs\/product\/\*|docs\/product\/<topic>/)
  })

  it('the reply graders take three to five ideas with the four fields and one against the roadmap, bold labels too', () => {
    for (const ideas of [
      idea(1) + idea(2) + idea(3, [...FIELDS, AGAINST]),
      idea(1, FIELDS, true) + idea(2, FIELDS, true) + idea(3, FIELDS, true) + idea(4, [...FIELDS, AGAINST], true) + idea(5, FIELDS, true),
      reply(idea(1) + idea(2) + idea(3) + idea(4, [...FIELDS, AGAINST])).replaceAll('\n', '\r\n'),
    ]) {
      const text = ideas.startsWith('Here') ? ideas : reply(ideas)
      for (const name of REPLY_GRADERS) expect(passes(name, text), `${name}\n${text}`).toBe(true)
    }
  })

  it.each([
    ['two ideas', reply(idea(1) + idea(2, [...FIELDS, AGAINST])), 'three-ideas.md'],
    ['six ideas', reply(idea(1) + idea(2) + idea(3) + idea(4) + idea(5) + idea(6, [...FIELDS, AGAINST])), 'at-most-five.md'],
    ['a field missing from two ideas', reply(idea(1, FIELDS.slice(1)) + idea(2, FIELDS.slice(0, 3)) + idea(3, [...FIELDS, AGAINST])), 'four-fields.md'],
    ['no idea against the roadmap', reply(idea(1) + idea(2) + idea(3)), 'against-roadmap.md'],
    ['against the roadmap only inside a sentence', reply(idea(1) + idea(2) + idea(3).replace('\n\n', '\n\nThis goes - Against the roadmap: no.\n\n')), 'against-roadmap.md'],
  ])('the reply graders refuse %s', (_, text, name) => {
    expect(passes(name, text)).toBe(false)
  })
})

// worfy-product-session ticket 11: the critic (agents/critic.md) writes one review per plan; the
// graders read its format, and example.md is a review of the case's export plan in that format. The
// graders run the way `claude plugin eval` runs a regex grader: new RegExp(pattern, flags) on the
// file as it is.
// Ticket 18 of the same epic: the critic takes no verdict of the plan's author, each objection keeps
// the checkable `Fact:` apart from the critic's `Judgement:`, and three more plans join the two of
// ticket 11 — a duplicate of an existing feature, a plan with a cheaper alternative, and a plan whose
// earlier deferral no longer holds.
describe('harness/evals: critic-verdict', () => {
  const CASE = join(EVALS, 'critic-verdict')
  const grader = (name: string): string => frontMatter(join(CASE, 'graders', name))
  const pattern = (name: string): RegExp => new RegExp(field(grader(name), 'pattern') ?? '<none>', field(grader(name), 'flags') ?? '')
  /** Whether a regex grader passes on the text, by its `match`. */
  const passes = (name: string, text: string): boolean => (field(grader(name), 'match') === 'not_contains') !== pattern(name).test(text)
  /** example.md as the graders read it; a checkout with CRLF reads the same. */
  const example = (): string => readFileSync(join(CASE, 'example.md'), 'utf8').replaceAll('\r\n', '\n')
  const objection = (n: number, fact = 'Fact: `src/a.mjs:1`\n\n', owner = 'Owner decision:\n\n', judgement = 'Judgement: It costs a wave.\n\n'): string =>
    `### ${n}. A title\n\n${fact}${judgement}${owner}`
  const review = (objections: string, verdict = 'Reorder', alternative = 'One.'): string =>
    `# Critic: e — 2026-11-08\n\nPlan: \`.scratch/e/spec.md\`\nVerdict: ${verdict} — one sentence.\n\n## Objections\n\n${objections}## Alternative\n\n${alternative}\n\n## What the critic cannot know\n\nUsage.\n`
  /** The five plans of the fixture: two of ticket 11, three of ticket 18. */
  const EPICS = ['export', 'greet', 'limit', 'sum-guard', 'sum-output']

  // Red before the agent exists: the case starts `worfy:critic`, and without harness/agents/critic.md
  // no run can start it, so the critics grader fails every run.
  it('starts worfy:critic, an agent of the plugin on opus that writes its review into the critic folder', () => {
    const file = join(HARNESS, 'agents', 'critic.md')
    expect(existsSync(file)).toBe(true)
    const yaml = frontMatter(file)
    expect(field(yaml, 'name')).toBe('critic')
    expect(field(yaml, 'model')).toBe('opus')
    expect(field(yaml, 'effort')).toBe('high')
    expect(field(yaml, 'tools')?.split(/,\s*/).sort()).toEqual(['Bash', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write'])
    expect(field(grader('critics.md'), 'input_match')).toContain('worfy:critic')
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('`<critic folder>/<epic>-<YYYY-MM-DD>.md`')
    // The four verdicts and the labels the graders read, as the agent writes them.
    for (const word of ['Keep', 'Reorder', 'Split', 'Defer']) expect(text).toContain(`\`${word}\``)
    for (const label of ['Verdict:', 'Fact:', 'Judgement:', 'Owner decision:', '## Objections', '## Alternative', '## What the critic cannot know']) expect(text).toContain(label)
  })

  // Anchoring (research note 2026-11-08, section 2): a critic told "the plan is ready" leans on it. The
  // input is the path of the plan; a verdict or self-assessment of its author, in the brief or in the
  // plan, is a claim the critic checks, never a fact it cites; the caller of "Before a spec is
  // accepted" passes none.
  it('takes the path of the plan and nothing of its author: a verdict or self-assessment is checked, not cited', () => {
    const text = readFileSync(join(HARNESS, 'agents', 'critic.md'), 'utf8')
    const flat = text.replaceAll(/\s+/g, ' ')
    expect(flat).toContain('## The input')
    const input = flat.slice(flat.indexOf('## The input'), flat.indexOf('## First: the project'))
    for (const words of ['the path of a spec or a plan', 'verdict of its author', 'self-assessment', 'in the brief or in the text of the plan', 'is a claim, not a fact', 'check what it claims yourself', 'never cite it']) {
      expect(input).toContain(words)
    }
    const before = flat.slice(flat.indexOf('## Before a spec is accepted'))
    expect(before).toContain('No verdict of the author and no self-assessment')
  })

  it('separates the fact from the judgement: each objection has a `Fact:` line and a `Judgement:` line, and the owner decision line stays', () => {
    const text = readFileSync(join(HARNESS, 'agents', 'critic.md'), 'utf8')
    const block = /```markdown\n([\s\S]*?)```/.exec(text)?.[1] ?? ''
    // The template of one objection: the one-line heading, then Fact, Judgement and the empty owner decision, in that order.
    expect(block).toMatch(/^### 1\. .+\n\nFact: .+\n\nJudgement: .+\n\nOwner decision:\n/m)
    const flat = text.replaceAll(/\s+/g, ' ')
    expect(flat).toContain('Every objection has its `Fact:` line and its `Judgement:` line')
  })

  // ADR-0101: the Product Session folder is docs/product in Full mode and <Workflow folder>/product in
  // Silent mode, critic/ inside it (src/shared/product/paths.ts). The agent names both folders by the
  // same function, and takes the mode and the folders from bin/profile fields that exist in both modes.
  it('writes into the critic folder of src/shared/product/paths.ts: docs/product/critic in Full mode, <Workflow folder>/product/critic in Silent mode', () => {
    const text = readFileSync(join(HARNESS, 'agents', 'critic.md'), 'utf8')
    const layout = { root: '<Project root>', workflowFolder: '<Workflow folder>' }
    const full = productCriticFolder(productFolder({ mode: 'full', ...layout }))
    const silent = productCriticFolder(productFolder({ mode: 'silent', ...layout }))
    expect([full, silent]).toEqual(['<Project root>/docs/product/critic', '<Workflow folder>/product/critic'])
    expect(text).toContain(`\n- Full mode: \`${full}/\``)
    expect(text).toContain(`\n- Silent mode: \`${silent}/\``)
    for (const name of ['_resolved.mode', '_resolved.workflow_folder', '_resolved.checkout']) expect(text).toContain(`\`--field ${name}\``)
    // The words of an owner's decision that ticket 14 counts; an empty line is pending.
    expect(text).toContain('`Owner decision: accepted — <reason>`')
    expect(text).toContain('`Owner decision: rejected — <reason>`')

    const { work, home } = caseFixtureToChange('critic-verdict')
    const field = (name: string): string => {
      const run = harness(home, work, 'profile', ['-C', work, '--field', name])
      expect(run.status, run.stderr).toBe(0)
      return run.stdout.trim()
    }
    // Full mode: the Project root is the working tree. The native spelling on both sides: on Windows
    // realpathSync keeps a short 8.3 name of the temporary folder (RUNNER~1), bin/profile prints the long one.
    const tree = realpathSync.native(work)
    expect(field('_resolved.mode')).toBe('full')
    expect(realpathSync.native(field('_resolved.checkout'))).toBe(tree)
    // Silent mode: the Workflow folder lies outside the repository.
    const profilePath = join(home, '.claude', 'worfy-harness', 'projects', 'demo', 'profile.json')
    writeFileSync(profilePath, JSON.stringify({ ...(JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, unknown>), mode: 'silent' }))
    expect(field('_resolved.mode')).toBe('silent')
    const workflowFolder = field('_resolved.workflow_folder')
    expect(isAbsolute(workflowFolder)).toBe(true)
    expect(relative(tree, workflowFolder).startsWith('..')).toBe(true)
  })

  it('example.md passes the format check: one verdict of the four words, at most three objections, each with a fact, a judgement and an owner decision line', () => {
    const text = example()
    expect(text.match(/^Verdict: (?:Keep|Reorder|Split|Defer) — \S/gm)).toHaveLength(1)
    expect(text).toMatch(pattern('export-not-keep.md'))
    expect(text).not.toMatch(pattern('export-at-most-three.md'))
    expect(text).not.toMatch(pattern('export-objection-facts.md'))
    // The fact and the judgement apart: no text of the objection outside its labelled lines.
    expect(text).toMatch(/^### 1\. .+\n\nFact: .+\n\nJudgement: .+\n\nOwner decision:\n/m)
    expect(text).toContain('\n## Alternative\n')
    expect(text).toContain('\n## What the critic cannot know\n')
  })

  it('the format graders catch a fourth objection, an objection without a fact, a judgement or an owner decision line, and the wrong verdict', () => {
    const facts = pattern('export-objection-facts.md')
    // Every plan is checked with the same pattern.
    for (const epic of EPICS) expect(field(grader(`${epic}-objection-facts.md`), 'pattern'), epic).toBe(field(grader('export-objection-facts.md'), 'pattern'))
    const three = [1, 2, 3].map((n) => objection(n)).join('')
    expect(review(three)).not.toMatch(pattern('export-at-most-three.md'))
    expect(review(three + objection(4))).toMatch(pattern('export-at-most-three.md'))
    expect(review(three)).not.toMatch(facts)
    expect(review('None.\n\n')).not.toMatch(facts)
    expect(review(objection(1) + objection(2, ''))).toMatch(facts)
    expect(review(objection(1, 'Fact:\n\n'))).toMatch(facts)
    expect(review(objection(1) + objection(2, undefined, ''))).toMatch(facts)
    // A judgement missing, empty, or folded into the text of the fact.
    expect(review(objection(1) + objection(2, undefined, undefined, ''))).toMatch(facts)
    expect(review(objection(1, undefined, undefined, 'Judgement:\n\n'))).toMatch(facts)
    expect(review(objection(1, 'Fact: `src/a.mjs:1`, so the plan breaks; Judgement: it costs a wave.\n\n', undefined, ''))).toMatch(facts)
    // The last objection at the end of the file, with no heading after it.
    expect(`Verdict: Split — why.\n\n### 1. A title\n\nFact: x\n`).toMatch(facts)
    expect(`Verdict: Split — why.\n\n### 1. A title\n\nFact: x\n\nOwner decision:\n`).toMatch(facts)
    expect(`Verdict: Split — why.\n\n### 1. A title\n\nFact: x\n\nJudgement: y\n\nOwner decision:\n`).not.toMatch(facts)
    expect(review(three, 'Keep')).not.toMatch(pattern('export-not-keep.md'))
    expect(review(three, 'Split')).toMatch(pattern('export-not-keep.md'))
    expect(review('None.\n\n', 'Keep')).toMatch(pattern('greet-keep.md'))
    expect(review('None.\n\n', 'Defer')).not.toMatch(pattern('greet-keep.md'))
    expect(review('None.\n\n', '**Keep**')).not.toMatch(pattern('greet-keep.md'))
  })

  it('the prompt starts one critic per plan with only the path of its spec, and each plan has its review, format and behaviour graders', () => {
    const prompt = readFileSync(join(CASE, 'prompt.md'), 'utf8').replace(/^---[\s\S]*?\n---\r?\n/, '')
    for (const epic of EPICS) {
      expect(prompt, epic).toContain(`\`.scratch/${epic}/spec.md\``)
      expect(existsSync(join(CASE, 'graders', `${epic}-review-written.md`)), epic).toBe(true)
      expect(field(grader(`${epic}-review-written.md`), 'path')).toBe(`docs/product/critic/${epic}-*.md`)
    }
    for (const words of ['`critic-<epic>`', 'the brief of each holds only the path of its spec', '`answer-<epic>.txt`', '`review-<epic>.md`']) expect(prompt).toContain(words)
    expect([field(grader('critics.md'), 'min'), field(grader('critics.md'), 'max')]).toEqual([String(EPICS.length), String(EPICS.length)])
    // The behaviour of each new plan: an llm grader that reads its review, and a regex grader on the fact it must name.
    for (const name of ['limit-duplicate.md', 'sum-guard-cheaper.md', 'sum-output-revisit.md']) {
      expect(field(grader(name), 'type'), name).toBe('llm')
      expect(grader(name), name).toContain(`path: review-${name.slice(0, name.lastIndexOf('-'))}.md`)
    }
  })

  it('the fact graders of the new plans: the duplicate names src/clamp.mjs with a line, the alternative names the existing check, the revisit names ADR-0001', () => {
    const fact = (line: string): string => objection(1, `Fact: ${line}\n\n`)
    expect(passes('limit-names-clamp.md', review(fact('`src/clamp.mjs:2` exports `clamp(value, min, max)`'), 'Defer'))).toBe(true)
    expect(passes('limit-names-clamp.md', review(fact('`src/clamp.mjs` exports `clamp`'), 'Defer'))).toBe(false)
    expect(passes('limit-names-clamp.md', review('None.\n\n', 'Keep'))).toBe(false)

    const check = 'Extend `test/sum.test.mjs:6` with the table; `.githooks/pre-commit:3` already runs `node --test` before each commit.'
    expect(passes('sum-guard-alternative-names-check.md', review(objection(1), 'Defer', check))).toBe(true)
    expect(passes('sum-guard-alternative-names-check.md', review(objection(1), 'Defer', 'Build the checker in one ticket.'))).toBe(false)
    // The existing check named in an objection only, not in the alternative.
    expect(passes('sum-guard-alternative-names-check.md', review(fact('`test/sum.test.mjs:6`'), 'Defer', 'Build the checker in one ticket.'))).toBe(false)

    expect(passes('sum-output-cites-adr.md', review(fact('`docs/adr/0001-sum-cli-prints-plain-text.md:14` (revisit when a program reads the output)'), 'Defer'))).toBe(true)
    expect(passes('sum-output-cites-adr.md', review(fact('ADR-0001 deferred `--json`'), 'Defer'))).toBe(true)
    expect(passes('sum-output-cites-adr.md', review(fact('`src/sum-cli.mjs:5`'), 'Keep'))).toBe(false)
  })

  it('each fact of example.md is the line of the fixture it quotes, and epic-status reads all five plans', () => {
    const { work, home } = caseFixture('critic-verdict')
    const line = (rel: string, n: number): string => (readFileSync(join(work, rel), 'utf8').split('\n')[n - 1] ?? '').replace(/\r$/, '')
    const cited = [...example().matchAll(/`(\.scratch\/[^`]+):(\d+)` \(([^)]+)\)/g)].map((match) => [match[1] ?? '', Number(match[2]), match[3] ?? ''] as const)
    expect(cited.map(([rel, n]) => `${rel}:${n}`)).toEqual(['.scratch/export/issues/02-export-command.md:5', '.scratch/export/issues/02-export-command.md:10', '.scratch/export/spec.md:18'])
    expect(line('.scratch/export/issues/02-export-command.md', 5)).toBe('Blocked by: —')
    expect(line('.scratch/export/issues/02-export-command.md', 10)).toContain('`formatRow` is imported from `src/row.mjs`')
    expect(line('.scratch/export/spec.md', 18)).toBe('| 02 | src/export.mjs, test/export.test.mjs | 1 |')
    expect(line('.scratch/export/spec.md', 19)).toBe('| 03 | src/row.mjs, test/row.test.mjs | 2 |')
    // The plan without an error: each ticket names the one it waits for.
    expect(line('.scratch/greet/issues/01-greeting.md', 5)).toBe('Blocked by: —')
    expect(line('.scratch/greet/issues/02-greet-command.md', 5)).toBe('Blocked by: 01')
    expect(line('.scratch/greet/issues/03-shout.md', 5)).toBe('Blocked by: 02')
    const status = harness(home, work, 'epic-status', ['--json'])
    expect(status.status, status.stderr).toBe(0)
    const tickets = (JSON.parse(status.stdout) as { tickets: { epic: string; num: number; statusError: string | null }[] }).tickets
    const counts: Record<string, number> = { export: 3, greet: 3, limit: 2, 'sum-guard': 3, 'sum-output': 2 }
    for (const epic of EPICS) {
      const nums = Array.from({ length: counts[epic] ?? 0 }, (_, i) => [i + 1, null])
      expect(tickets.filter((ticket) => ticket.epic === epic).map((ticket) => [ticket.num, ticket.statusError]), epic).toEqual(nums)
    }
  })

  // What the graders of the three new plans hold the critic to is in the fixture, at the lines they name.
  it('the new plans: limit duplicates src/clamp.mjs, sum-guard rebuilds the test and hook the project has, sum-output leans on a deferral whose condition now holds', () => {
    const { work, home } = caseFixture('critic-verdict')
    const read = (rel: string): string => readFileSync(join(work, rel), 'utf8').replaceAll('\r\n', '\n')
    const line = (rel: string, n: number): string => read(rel).split('\n')[n - 1] ?? ''
    // A feature the repository has, committed before the plans, and the plan that adds it again.
    expect(line('src/clamp.mjs', 2)).toBe('export function clamp(value, min, max) {')
    expect(read('.scratch/limit/spec.md')).toContain('`limit(n, low, high)`')
    expect(read('.scratch/limit/issues/01-limit.md')).toContain('`src/limit.mjs` — new')
    // An existing check: the test of sum and the hook that runs every test before a commit; the plan builds its own.
    expect(line('test/sum.test.mjs', 6)).toBe('  assert.equal(sum(2, 3), 5)')
    expect(line('.githooks/pre-commit', 3)).toBe('exec node --test')
    expect(read('README.md')).toContain('git config core.hooksPath .githooks')
    expect(read('.scratch/sum-guard/spec.md')).toContain('`scripts/install-hook.mjs`')
    // An earlier deferral and its condition, and the plan that shows the condition met yet keeps the deferral.
    const adr = 'docs/adr/0001-sum-cli-prints-plain-text.md'
    expect(read(adr)).toContain('`--json` is deferred')
    expect(line(adr, 17)).toBe('A program, not a person, reads the output of `sum-cli`.')
    expect(read('.scratch/sum-output/spec.md')).toContain('two programs read the output of `node src/sum-cli.mjs`')
    expect(read('.scratch/sum-output/spec.md')).toContain('A JSON output: deferred by ADR-0001')
    // The history is older than the plans: the existing feature, check and decision were there first.
    const log = spawnSync('git', ['log', '--format=%s', '--reverse'], { cwd: work, encoding: 'utf8', env: childEnv(home, { PATH: process.env.PATH }) })
    expect(log.status, log.stderr).toBe(0)
    expect(log.stdout.trim().split('\n').slice(-2)).toEqual(['clamp, sum-cli, a pre-commit hook and ADR-0001', 'plans for acceptance'])
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
  }, process.platform === 'win32' ? ms(53_000) : undefined)
})

// The cases of the skills copied from mattpocock-skills 1.3.1 (worfy-skills 05). A run installs only
// the plugin under test, so a case sees the copies under their plugin names, `worfy:<skill>`.
describe('harness/evals: the cases of the copied skills', () => {
  const SKILL_CASES = CASES.map(([name]) => name).filter((name) => name.startsWith('skill-'))
  /** The `input_match` of a grader as a RegExp, the way `claude plugin eval` builds it: no flags. */
  const inputMatch = (name: string, grader: string): RegExp => new RegExp(field(frontMatter(join(EVALS, name, 'graders', grader)), 'input_match') ?? '<none>')
  /** The input of a Write call as the grader reads it: the JSON of the tool input. */
  const write = (path: string, content: string): string => JSON.stringify({ file_path: path, content })
  const skill = (name: string): string => JSON.stringify({ skill: name })
  /** The input of an Edit call, its fields in the order Claude Code sends them. */
  const edit = (path: string, before: string, after: string): string => JSON.stringify({ file_path: path, old_string: before, new_string: after })
  /** File name -> statusError of each ticket of `epic`, as `epic-status --json` reads the fixture. */
  const statusErrors = (home: string, work: string, epic: string): Map<string, string | null> => {
    const status = harness(home, work, 'epic-status', ['--json'])
    expect(status.status, status.stderr).toBe(0)
    const tickets = (JSON.parse(status.stdout) as { tickets: { epic: string; num: number; slug: string; statusError: string | null }[] }).tickets
    return new Map(tickets.filter((t) => t.epic === epic).map((t) => [`${String(t.num).padStart(2, '0')}-${t.slug}.md`, t.statusError]))
  }

  it('are the four cases of the ticket', () => {
    expect(SKILL_CASES.sort()).toEqual(['skill-code-review', 'skill-grilling-trigger', 'skill-to-tickets-format', 'skill-wayfinder-refs'])
  })

  // Red on a Harness without the copies (main before worfy-skills 01): there is no skills/grilling,
  // so no run can call worfy:grilling, and the grader of skill-grilling-trigger fails every run.
  it('each `worfy:<skill>` a grader or prompt names is a skill of the plugin, and a skill a Skill grader expects is open to the model', () => {
    const named = new Map<string, string>()
    for (const name of SKILL_CASES) {
      const texts = [join(EVALS, name, 'prompt.md'), ...graderFiles(name)].map((file) => [file, readFileSync(file, 'utf8')] as const)
      for (const [file, text] of texts) for (const match of text.matchAll(/worfy:([a-z][a-z-]*)/g)) named.set(match[1] ?? '', file)
    }
    expect([...named.keys()].sort()).toEqual(['code-review', 'domain-modeling', 'grilling', 'to-tickets', 'wayfinder'])
    for (const [name, file] of named) expect(existsSync(join(HARNESS, 'skills', name, 'SKILL.md')), `${name} in ${file}`).toBe(true)
    // The model calls these through the Skill tool; a skill with disable-model-invocation only takes a slash command.
    for (const name of ['grilling', 'domain-modeling']) {
      expect(frontMatter(join(HARNESS, 'skills', name, 'SKILL.md'))).not.toMatch(/disable-model-invocation:\s*true/)
    }
    // wayfinder still names both skills by their plugin names: the grader of skill-wayfinder-refs looks for those calls.
    const wayfinder = readFileSync(join(HARNESS, 'skills', 'wayfinder', 'SKILL.md'), 'utf8')
    expect(wayfinder).toContain('"worfy:grilling"')
    expect(wayfinder).toContain('"worfy:domain-modeling"')
  })

  it('the Skill graders take the call by the plugin name and refuse a call of another plugin', () => {
    for (const name of ['skill-grilling-trigger', 'skill-wayfinder-refs']) {
      const called = inputMatch(name, 'grilling-called.md')
      expect(skill('worfy:grilling')).toMatch(called)
      expect(JSON.stringify({ skill: 'worfy:grilling', args: 'the plan' })).toMatch(called)
      expect(skill('mattpocock-skills:grilling')).not.toMatch(called)
      expect(skill('worfy:grill-me')).not.toMatch(called)
      const other = inputMatch(name, 'no-other-plugin-skill.md')
      expect(skill('mattpocock-skills:grilling')).toMatch(other)
      expect(JSON.stringify({ skill: 'mattpocock-skills:domain-modeling', args: 'terms' })).toMatch(other)
      expect(skill('worfy:grilling')).not.toMatch(other)
      expect(JSON.stringify({ skill: 'worfy:domain-modeling', args: 'see mattpocock-skills:grilling' })).not.toMatch(other)
    }
    const modeling = inputMatch('skill-wayfinder-refs', 'domain-modeling-called.md')
    expect(skill('worfy:domain-modeling')).toMatch(modeling)
    expect(skill('mattpocock-skills:domain-modeling')).not.toMatch(modeling)
  })

  it('skill-grilling-trigger: the round grader takes the question format of skills/grilling', () => {
    const text = readFileSync(join(HARNESS, 'skills', 'grilling', 'SKILL.md'), 'utf8')
    const pattern = new RegExp(field(frontMatter(join(EVALS, 'skill-grilling-trigger', 'graders', 'numbered-round.md')), 'pattern') ?? '<none>')
    expect(text).toMatch(pattern)
    expect('❓ **Q1** - **One module or four?**: …\n\n➡️ One module.').toMatch(pattern)
    expect('1. One module or four?').not.toMatch(pattern)
  })

  // The header grader and epic-status read the same lines: a ticket the grader takes is one epic-status
  // reads with no error, and an old header epic-status refuses is one the other graders catch.
  it('skill-to-tickets-format: a ticket the header grader takes is read by epic-status, an old header is caught', () => {
    const { work, home, run } = caseFixtureToChange('skill-to-tickets-format')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(existsSync(join(work, '.scratch', 'greet', 'spec.md'))).toBe(true)
    expect(existsSync(join(work, '.scratch', 'greet', 'issues'))).toBe(false)
    const header = inputMatch('skill-to-tickets-format', 'ticket-header.md')
    const old = inputMatch('skill-to-tickets-format', 'no-old-header.md')
    const oldByEdit = inputMatch('skill-to-tickets-format', 'no-old-header-by-edit.md')
    const tickets: [file: string, content: string, ok: boolean][] = [
      ['01-greeting.md', '# 01: Greeting\n\nType: task\nStatus: open\nBlocked by: None — can start immediately\n\nThe function.\n', true],
      ['02-command.md', '# 02: Command\n\nType: task\nStatus: open 2026-10-01T12:00Z\nBlocked by: 01\n\nThe command.\n', true],
      ['03-shout.md', '# 03: Shout\n\nType: task\n**Status:** open\nBlocked by: 02\n', false],
      ['04-tail.md', '# 04: Tail\n\nType: task\nStatus: open — new\nBlocked by: 02\n', false],
      ['05-word.md', '# 05: Word\n\nType: task\nStatus: resolved\nBlocked by: 02\n', false],
    ]
    mkdirSync(join(work, '.scratch', 'greet', 'issues'))
    for (const [file, content] of tickets) writeFileSync(join(work, '.scratch', 'greet', 'issues', file), content)
    const errors = statusErrors(home, work, 'greet')
    expect(errors.size).toBe(tickets.length)
    for (const [file, content, ok] of tickets) {
      const path = `/tmp/run/.scratch/greet/issues/${file}`
      expect(errors.get(file), file).toBe(ok ? null : 'old header')
      expect(header.test(write(path, content)), file).toBe(ok || file === '04-tail.md')
      expect(old.test(write(path, content)), file).toBe(!ok)
      // An Edit counts by the text it writes, not by the text it replaces.
      expect(oldByEdit.test(edit(path, 'Status: claimed 2026-10-01T12:00Z', content)), file).toBe(!ok)
      expect(oldByEdit.test(edit(path, content, '# 01: Greeting\n')), file).toBe(false)
    }
    expect(oldByEdit.test(edit('/tmp/run/.scratch/greet/issues/01-greeting.md', 'x', 'Status: open'))).toBe(false)
    // A file outside the epic's tickets is none of the graders' business.
    expect(header.test(write('/tmp/run/.scratch/greet/spec.md', tickets[0]?.[1] ?? ''))).toBe(false)
    expect(old.test(write('/tmp/run/notes.md', '**Status:** draft\n'))).toBe(false)
    expect(oldByEdit.test(edit('/tmp/run/notes.md', 'x', '**Status:** draft\n'))).toBe(false)
  })

  it('skill-wayfinder-refs: the ticket grader takes the Type words of bin/TICKETS.md, and its tickets are read by epic-status; a resolved one is caught', () => {
    const header = inputMatch('skill-wayfinder-refs', 'ticket-header.md')
    const other = inputMatch('skill-wayfinder-refs', 'no-other-status-word.md')
    const otherByEdit = inputMatch('skill-wayfinder-refs', 'no-other-status-word-by-edit.md')
    // The four ticket types of the grader are the four words of the Type line in bin/TICKETS.md.
    const glossary = readFileSync(join(HARNESS, 'bin', 'TICKETS.md'), 'utf8').replace(/\r?\n\s*/g, ' ')
    const typesLine = /The ticket type is the `Type:` line — (.*?) — in place of/.exec(glossary)?.[1] ?? ''
    const types = [...typesLine.matchAll(/`([a-z]+)`/g)].map((match) => match[1] ?? '')
    expect(types).toEqual(['research', 'prototype', 'grilling', 'task'])
    const graded = /Type: \(\?:([a-z|]+)\)/.exec(field(frontMatter(join(EVALS, 'skill-wayfinder-refs', 'graders', 'ticket-header.md')), 'input_match') ?? '')?.[1]
    expect(graded?.split('|')).toEqual(types)

    const { work, home, run } = caseFixtureToChange('skill-wayfinder-refs')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const ticket = (type: string, status: string): string => `# 0x — A question\n\nType: ${type}\nStatus: ${status}\nBlocked by: —\n\n## Question\n\nWhat is the command called?\n`
    mkdirSync(join(work, '.scratch', 'cli', 'issues'), { recursive: true })
    writeFileSync(join(work, '.scratch', 'cli', 'map.md'), '# Map: cli\n\n## Destination\n\nA command.\n')
    const files = types.map((type, i) => [`0${i + 1}-${type}.md`, ticket(type, 'open')] as const)
    const resolved = ['05-resolved.md', ticket('grilling', 'resolved')] as const
    for (const [file, content] of [...files, resolved]) writeFileSync(join(work, '.scratch', 'cli', 'issues', file), content)
    const errors = statusErrors(home, work, 'cli')
    for (const [file, content] of files) {
      const path = `/tmp/run/.scratch/cli/issues/${file}`
      expect(errors.get(file), file).toBe(null)
      expect(write(path, content)).toMatch(header)
      expect(write(path, content)).not.toMatch(other)
      expect(edit(path, 'Status: open', content)).not.toMatch(otherByEdit)
    }
    expect(errors.get(resolved[0])).toBe('old header')
    expect(write(`/tmp/run/.scratch/cli/issues/${resolved[0]}`, resolved[1])).toMatch(other)
    expect(edit(`/tmp/run/.scratch/cli/issues/${resolved[0]}`, 'Status: open', 'Status: resolved')).toMatch(otherByEdit)
    expect(edit(`/tmp/run/.scratch/cli/issues/${resolved[0]}`, 'Status: resolved', 'Status: done')).not.toMatch(otherByEdit)
    const path = '/tmp/run/.scratch/cli/issues/01-command-name.md'
    expect(write(path, ticket('wayfinder:grilling', 'open'))).not.toMatch(header)
    expect(write('/tmp/run/.scratch/cli/map.md', ticket('grilling', 'open'))).not.toMatch(header)
    expect(write(path, ticket('grilling', 'done 2026-10-01T12:00Z'))).not.toMatch(other)
    expect(readFileSync(join(EVALS, 'skill-wayfinder-refs', 'prompt.md'), 'utf8')).toContain('/worfy:wayfinder ')
  })

  it('skill-code-review: the change breaks the standards and misses the test the ticket asks for, each defect on one axis', () => {
    const { work, home, run } = caseFixture('skill-code-review')
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const git = (...args: string[]): string => inFixture(home, work, 'git', args).stdout
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('demo/01')
    expect(git('status', '--porcelain')).toBe('')
    expect(git('diff', '--name-only', 'origin/main...HEAD').trim()).toBe('src/alpha.mjs')
    const standards = git('show', 'origin/main:CODING_STANDARDS.md')
    expect(standards).toMatch(/no `export default`[\s\S]*JSDoc/)
    // The standards say nothing of tests: the missing test is a Spec finding only.
    expect(standards).not.toMatch(/test/i)
    expect(readFileSync(join(work, 'src', 'alpha.mjs'), 'utf8')).toBe('export default function double(n) {\n  return n * 2\n}\n')
    expect(git('show', 'origin/main:.scratch/demo/issues/01-alpha.md')).toContain('test/alpha.test.mjs')
    expect(existsSync(join(work, 'test', 'alpha.test.mjs'))).toBe(false)

    // Each regex grader as `claude plugin eval` builds it: its own pattern and flags.
    const grader = (file: string): RegExp => {
      const yaml = frontMatter(join(EVALS, 'skill-code-review', 'graders', file))
      expect(field(yaml, 'type'), file).toBe('regex')
      return new RegExp(field(yaml, 'pattern') ?? '<none>', field(yaml, 'flags') ?? '')
    }
    const headings = grader('two-headings.md')
    const onStandards = grader('standards-names-its-breach.md')
    const onSpec = grader('spec-names-the-missing-test.md')
    const good = '## Standards\n\n1. `export default function double` breaks rule 1.\n\n## Spec\n\n- No `test/alpha.test.mjs`.\n\nStandards: 1, Spec: 1.'
    const specFirst = '## Spec\n\n- No `test/alpha.test.mjs`.\n\n## Standards\n\n- No JSDoc line over `double`.'
    for (const reply of [good, specFirst]) for (const pattern of [headings, onStandards, onSpec]) expect(reply).toMatch(pattern)
    expect('## Standards\n\n1. `export default` breaks rule 1.').not.toMatch(headings)
    expect('Standards and Spec are both fine.').not.toMatch(headings)
    // A finding under the other heading does not count for an axis.
    const swapped = '## Standards\n\n- No `test/alpha.test.mjs`.\n\n## Spec\n\n- `export default` and no JSDoc.'
    expect(swapped).not.toMatch(onStandards)
    expect(swapped).not.toMatch(onSpec)
    expect('## Standards\n\nNothing.\n\n## Spec\n\nNothing.\n\nSummary: export default, alpha.test.').not.toMatch(onStandards)
    expect(readFileSync(join(HARNESS, 'skills', 'code-review', 'SKILL.md'), 'utf8')).toMatch(/`## Standards` and `## Spec`/)
  })
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
