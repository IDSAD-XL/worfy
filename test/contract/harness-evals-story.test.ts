// worfy-code-stories ticket 14: the eval case implementer-story (harness/evals/implementer-story/). A run hands
// ticket 01 of the demo project to worfy:implementer with workflow.finish pr-green-ci, and the graders read
// what it left: the Code story of the PR in the branch, story-check green on it, the parts story-pr.md asks for,
// and no refusal in the trace. The paid run is by hand (pnpm eval:harness); this file is its free part and never
// starts claude: it builds the fixture, plays the implementer's commits by hand and runs the graders the way
// `claude plugin eval` runs a regex grader, new RegExp(pattern, flags) on the text as it is.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scriptNode } from '../script-node'
import { childEnv, EVALS, HARNESS, REPO, SCAFFOLD_TIMEOUT_MS, tempDir } from './harness-evals-shared'

const NAME = 'implementer-story'
const CASE = join(EVALS, NAME)
const STORY = '.scratch/demo/stories/01-alpha.md'
const LOG = '.git/story-check.log'

const frontMatter = (file: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
const field = (yaml: string, key: string): string | undefined =>
  new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(yaml)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
const grader = (file: string): string => frontMatter(join(CASE, 'graders', file))
const pattern = (file: string): RegExp => new RegExp(field(grader(file), 'pattern') ?? '<none>', field(grader(file), 'flags') ?? '')
/** The path a `{ source: file, path }` grader reads, relative to the run's folder. */
const targetPath = (file: string): string => /path:\s*([^\s}]+)/.exec(field(grader(file), 'target') ?? '')?.[1] ?? '<none>'
/** Whether a regex grader passes on `text`: `contains` by default, `not_contains` inverted. */
const passes = (file: string, text: string): boolean => (field(grader(file), 'match') === 'not_contains') !== pattern(file).test(text)

// The fixed identity and dates of the commits a test makes as the implementer: the fixture's HOME is empty.
const COMMIT_ENV = {
  GIT_AUTHOR_NAME: 'demo',
  GIT_AUTHOR_EMAIL: 'demo@example.invalid',
  GIT_COMMITTER_NAME: 'demo',
  GIT_COMMITTER_EMAIL: 'demo@example.invalid',
}
const env = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  childEnv(home, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'C.UTF-8', ...COMMIT_ENV, ...extra })

/** Builds the fixture as `claude plugin eval` does: an empty folder, a temporary HOME, a short environment. */
function build(): { work: string; home: string; run: SpawnSyncReturns<string> } {
  const root = tempDir('worfy-eval-story-')
  const work = join(root, 'work')
  const home = join(root, 'home')
  mkdirSync(work)
  mkdirSync(home)
  const script = field(readFileSync(join(CASE, 'case.yaml'), 'utf8'), 'scaffold_script') ?? '<none>'
  const run = spawnSync('bash', [join(CASE, script)], {
    cwd: work,
    env: childEnv(home, { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), TERM: 'dumb' }),
    encoding: 'utf8',
    timeout: SCAFFOLD_TIMEOUT_MS,
  })
  return { work, home, run }
}

const git = (work: string, home: string, ...args: string[]): SpawnSyncReturns<string> =>
  spawnSync('git', args, { cwd: work, env: env(home), encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS })
const put = (work: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(work, rel)), { recursive: true })
  writeFileSync(join(work, rel), text)
}
const commit = (work: string, home: string, message: string): void => {
  expect(git(work, home, 'add', '-A').status).toBe(0)
  const done = git(work, home, 'commit', '-q', '-m', message)
  expect(done.status, done.stderr).toBe(0)
}
const log = (work: string): string => (existsSync(join(work, LOG)) ? readFileSync(join(work, LOG), 'utf8') : '')

// The code of ticket 01 as an implementer would write it, and its story in Russian (the demo profile's
// language.reports): the frame step first, one code step with the five fields, the Russian `not recorded` where
// the ticket gives no reason, a `How it was checked` step, no review step.
const CODE = [
  '/** The whole percent of `done` in `total`, rounded down; 0 when `total` is 0. */',
  'export function percent(done, total) {',
  '  if (total === 0) return 0',
  '  return Math.floor((done * 100) / total)',
  '}',
  '',
].join('\n')
const TEST = [
  "import assert from 'node:assert/strict'",
  "import { test } from 'node:test'",
  "import { percent } from '../src/alpha.mjs'",
  '',
  "test('percent rounds down and gives 0 for an empty total', () => {",
  '  assert.equal(percent(2, 3), 66)',
  '  assert.equal(percent(0, 0), 0)',
  '})',
  '',
].join('\n')
const GOOD_STORY = [
  '# Code story — demo 01: alpha: процент выполнения',
  '',
  'Kind: pr · Epic: demo · Ticket: 01 · PR: - · Language: ru',
  '',
  '## 1. Что было не так',
  '',
  'Отчёт показывал долю готовых задач дробью вместо целого процента.',
  '',
  '- Требование: [Что происходит](../issues/01-alpha.md#что-происходит)',
  '',
  '## 2. Целый процент, округлённый вниз',
  '',
  'Code: `src/alpha.mjs:2-5` · key lines: 3, 4',
  '',
  '```js',
  'export function percent(done, total) {',
  '  if (total === 0) return 0',
  '  return Math.floor((done * 100) / total)',
  '}',
  '```',
  '',
  '- Что делает: при пустом `total` отдаёт 0, иначе целый процент, округлённый вниз.',
  '- Почему здесь: не записано',
  '- Без него: отчёт по-прежнему показывал бы дробь.',
  '- Требование: [Что делаем](../issues/01-alpha.md#что-делаем)',
  '- Риски и пробелы test-ов: не записано',
  '',
  '## 3. Как проверено',
  '',
  '`node --test` — exit 0.',
  '',
].join('\n')

describe('harness/evals: implementer-story', () => {
  it('the fixture: ticket 01 asks for percent with two rules and no reason for them, code_stories.pr is on, a post-commit hook waits for a story', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const ticket = readFileSync(join(work, '.scratch', 'demo', 'issues', '01-alpha.md'), 'utf8')
    expect(ticket).toContain('`percent(done, total)`')
    expect(ticket).toContain('`Math.floor`')
    expect(ticket).toContain('`percent(0, 0)` возвращает `0`')
    // No reason for either rule: a story that invents one is what the case looks for.
    for (const reason of ['потому что', 'чтобы', 'так как', 'иначе']) expect(ticket, reason).not.toContain(reason)
    for (const extra of [{}, { EVAL_HARNESS_HOME: 'worfy-harness' }]) {
      const profile = spawnSync(scriptNode(), [join(HARNESS, 'bin', 'profile'), '-C', work, '--field', 'code_stories.pr'], { cwd: work, env: env(home, extra), encoding: 'utf8' })
      expect(profile.status, profile.stderr).toBe(0)
      expect(profile.stdout.trim()).toBe('on')
      const finish = spawnSync(scriptNode(), [join(HARNESS, 'bin', 'profile'), '-C', work, '--field', 'workflow.finish'], { cwd: work, env: env(home, extra), encoding: 'utf8' })
      expect(finish.stdout.trim()).toBe('pr-green-ci')
    }
    expect(existsSync(join(work, '.git', 'hooks', 'post-commit'))).toBe(true)
    expect(existsSync(join(work, LOG))).toBe(false)
    expect(git(work, home, 'status', '--porcelain').stdout).toBe('')
    expect(git(work, home, 'branch', '--show-current').stdout.trim()).toBe('main')
  })

  it('a commit without a story writes no log; the commit of the story on the ticket branch logs it with story-check exit 0, and the graders pass', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, 'test/alpha.test.mjs', TEST)
    commit(work, home, 'demo/01: percent')
    expect(log(work)).toBe('')

    put(work, STORY, GOOD_STORY)
    commit(work, home, 'demo/01: Code story')
    const text = log(work)
    expect(text).toMatch(/^stories: \.scratch\/demo\/stories\/01-alpha\.md$/m)
    expect(text).toContain('.scratch/demo/stories/01-alpha.md: ok')
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=0')

    expect(targetPath('story-in-branch.md')).toBe(LOG)
    expect(targetPath('story-check-green.md')).toBe(LOG)
    expect(targetPath('story-required-parts.md')).toBe(STORY)
    expect(passes('story-in-branch.md', text)).toBe(true)
    expect(passes('story-check-green.md', text)).toBe(true)
    expect(passes('story-required-parts.md', readFileSync(join(work, STORY), 'utf8'))).toBe(true)

    // A later commit without a change to the story checks it again on the new head.
    put(work, 'src/alpha.mjs', `${CODE}// end\n`)
    commit(work, home, 'demo/01: a later commit')
    expect(log(work).trimEnd().split('\n').at(-1)).toBe('EXIT=0')
  })

  it('a story whose fragment does not match the code logs story-check exit 2, and the story-check grader fails it', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, STORY, GOOD_STORY.replace('Math.floor((done * 100) / total)', 'Math.round((done * 100) / total)'))
    commit(work, home, 'demo/01: percent and a wrong story')
    const text = log(work)
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=2')
    expect(passes('story-in-branch.md', text)).toBe(true)
    expect(passes('story-check-green.md', text)).toBe(false)
  })

  it('a story committed on the main branch logs story-check exit 1: the main branch is not the head of a PR', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, STORY, GOOD_STORY)
    commit(work, home, 'percent and its story on main')
    expect(log(work).trimEnd().split('\n').at(-1)).toBe('EXIT=1')
    expect(passes('story-check-green.md', log(work))).toBe(false)
  })

  it('the required-parts grader refuses a story without the first frame step, a field, the Russian `not recorded`, or with the review step', () => {
    const file = 'story-required-parts.md'
    expect(field(grader(file), 'type')).toBe('regex')
    expect(passes(file, GOOD_STORY)).toBe(true)
    expect(passes(file, GOOD_STORY.replaceAll('\n', '\r\n'))).toBe(true)
    const broken: [string, string][] = [
      ['first step is a code step', GOOD_STORY.replace('## 1. Что было не так', '## 1. Процент').replace('## 2. Целый процент', '## 2. Что было не так')],
      ['no frame step', GOOD_STORY.replace('## 1. Что было не так', '## 1. Начало')],
      ['English labels', GOOD_STORY.replace('Language: ru', 'Language: en')],
      ['no Почему здесь', GOOD_STORY.replace('- Почему здесь: не записано\n', '')],
      ['no Что делает', GOOD_STORY.replace(/- Что делает: .*\n/, '')],
      ['no Без него', GOOD_STORY.replace(/- Без него: .*\n/, '')],
      ['no Риски', GOOD_STORY.replace('- Риски и пробелы test-ов: не записано\n', '')],
      ['a guess instead of не записано', GOOD_STORY.replaceAll('не записано', 'так проще читать')],
      ['no fragment', GOOD_STORY.replace(/Code: .*\n/, '')],
      ['the review step', `${GOOD_STORY}\n## 4. Что нашёл review и что осталось\n\nНичего.\n`],
      ['another title', GOOD_STORY.replace('# Code story — demo 01:', '# Code story — demo 02:')],
    ]
    for (const [what, story] of broken) expect(passes(file, story), what).toBe(false)
  })

  it('the refusal grader: not_contains over the trace, failed by a refusal of reasoning_extraction or the refusal text of Claude Code', () => {
    const file = 'no-refusal.md'
    expect(field(grader(file), 'type')).toBe('regex')
    expect(field(grader(file), 'target')).toBe('trace')
    expect(field(grader(file), 'match')).toBe('not_contains')
    const clean = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Code story: .scratch/demo/stories/01-alpha.md' }] } })
    expect(passes(file, clean)).toBe(true)
    const refused = [
      JSON.stringify({ type: 'assistant', message: { stop_reason: 'refusal', stop_details: { category: 'reasoning_extraction', explanation: null } } }),
      JSON.stringify({ message: { stop_reason: 'refusal', stop_details: null } }),
      '{"stop_details":{"category":"reasoning_extraction"}}',
      "API Error: Claude Opus 5's safeguards flagged this message (https://www.anthropic.com/legal/aup).",
      "API Error: Claude can't help with this. Start a new session to continue.",
    ]
    for (const trace of refused) expect(passes(file, `${clean}\n${trace}\n${clean}`), trace).toBe(false)
  })

  it('has the four graders of the ticket and the dispatch to worfy:implementer; the case is in no CI workflow and not in the gate', () => {
    expect(readdirSync(join(CASE, 'graders')).sort()).toEqual(['implementer-dispatched.md', 'no-refusal.md', 'story-check-green.md', 'story-in-branch.md', 'story-required-parts.md'])
    const dispatched = grader('implementer-dispatched.md')
    expect(field(dispatched, 'type')).toBe('tool_used')
    expect(field(dispatched, 'tool')).toBe('Agent')
    const call = JSON.stringify({ description: 'ticket 01', subagent_type: 'worfy:implementer', prompt: 'Ticket 01 of epic demo' })
    expect(call).toMatch(new RegExp(field(dispatched, 'input_match') ?? '<none>'))
    expect(JSON.stringify({ description: 'map', subagent_type: 'worfy:scout', prompt: 'x' })).not.toMatch(new RegExp(field(dispatched, 'input_match') ?? '<none>'))
    const prompt = frontMatter(join(CASE, 'prompt.md'))
    expect(field(prompt, 'tags')).toBe('[main]')

    const workflows = join(REPO, '.github', 'workflows')
    for (const file of readdirSync(workflows)) expect(readFileSync(join(workflows, file), 'utf8'), file).not.toContain(NAME)
    expect(readFileSync(join(HARNESS, 'hooks', 'gate.mjs'), 'utf8')).not.toContain(NAME)

    const coverage = JSON.parse(readFileSync(join(EVALS, 'lib', 'coverage.json'), 'utf8')) as { cases: Record<string, string[]>; uncovered: Record<string, string> }
    expect(coverage.cases[NAME]).toEqual(['agents/implementer.md', 'skills/ship-ticket/story-pr.md', 'skills/ship-ticket/implementer-finish.md'])
    expect(coverage.uncovered['skills/ship-ticket/story-pr.md']).toBeUndefined()
  })
})
