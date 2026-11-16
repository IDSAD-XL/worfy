// worfy-code-stories ticket 14: the eval case implementer-story (harness/evals/implementer-story/). A run hands
// ticket 01 of the demo project to worfy:implementer with workflow.finish pr-green-ci, and the graders read
// what it left: the Code story of the PR in the branch with the parts story-pr.md asks for and story-check green
// on it, no reason in it that the ticket does not give (an llm grader, judged only in the paid run), and no
// refusal in the trace. The paid run is by hand (pnpm eval:harness); this file is its free part and never
// starts claude: it builds the fixture, plays the implementer's commits by hand and runs the graders the way
// `claude plugin eval` runs a regex grader, new RegExp(pattern, flags) on the text as it is.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scriptNode } from '../script-node'
import { childEnv, cliFrontMatter, EVALS, HARNESS, REPO, SCAFFOLD_TIMEOUT_MS, tempDir } from './harness-evals-shared'

const NAME = 'implementer-story'
const CASE = join(EVALS, NAME)
const STORY = '.scratch/demo/stories/01-alpha.md'
const LOG = '.git/story-check.log'
// The copy of the story at HEAD, which the fixture's check (.git/eval-finish.sh) keeps for the graders.
const COPY = '.git/story-check/01-alpha.md'
// The input of the llm grader, which the check writes next to the copy: everything a story may cite.
const JUDGE = '.git/story-check/judge-input.md'
const GRADERS = ['implementer-dispatched.md', 'no-invented-reason.md', 'no-refusal.md', 'story-check-green.md']
// The line of the log between the story of ticket 01 and the output of story-check.
const SEPARATOR = '=== story-check ==='
// The pass mark of a case: `--threshold` of every `claude plugin eval` call that pnpm eval:harness starts.
const THRESHOLD = Number(/'--threshold', '([\d.]+)'/.exec(readFileSync(join(REPO, 'scripts', 'eval-harness.mjs'), 'utf8'))?.[1] ?? 'NaN')

const frontMatter = (file: string): string => cliFrontMatter(readFileSync(file, 'utf8'))
const field = (yaml: string, key: string): string | undefined =>
  new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(yaml)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
const grader = (file: string): string => frontMatter(join(CASE, 'graders', file))
const pattern = (file: string): RegExp => new RegExp(field(grader(file), 'pattern') ?? '<none>', field(grader(file), 'flags') ?? '')
/** The path a `{ source: file, path }` grader reads (`target`, or `focus` of an llm grader), relative to the run's folder. */
const targetPath = (file: string): string =>
  /path:\s*([^\s}]+)/.exec(field(grader(file), 'target') ?? field(grader(file), 'focus') ?? '')?.[1] ?? '<none>'
/** Whether a regex grader passes on `text`: `contains` by default, `not_contains` inverted. */
const passes = (file: string, text: string): boolean => (field(grader(file), 'match') === 'not_contains') !== pattern(file).test(text)

// A run of the case as the graders see it: the files of `work`, a clean trace and the dispatch to the implementer.
const CLEAN_TRACE = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } })
const DISPATCH = JSON.stringify({ description: 'ticket 01', subagent_type: 'worfy:implementer', prompt: 'Ticket 01 of epic demo' })
/**
 * Each grader of the case and whether it passes on `work`, a `{ source: file }` target that is missing failing it.
 * No model runs here, so the llm grader counts as passed whenever its file is there: the worst case for the threshold.
 */
function graded(work: string): [string, boolean][] {
  return GRADERS.map((file) => {
    const yaml = grader(file)
    if (field(yaml, 'type') === 'tool_used') return [file, new RegExp(field(yaml, 'input_match') ?? '<none>').test(DISPATCH)]
    if (field(yaml, 'type') === 'llm') return [file, existsSync(join(work, targetPath(file)))]
    if (field(yaml, 'target') === 'trace') return [file, passes(file, CLEAN_TRACE)]
    const path = join(work, targetPath(file))
    return [file, existsSync(path) && passes(file, readFileSync(path, 'utf8'))]
  })
}
/** The score of one run: the share of graders passed, every grader with the default weight 1. */
const score = (work: string): number => {
  for (const file of GRADERS) expect(field(grader(file), 'weight'), file).toBeUndefined()
  const results = graded(work)
  return results.filter(([, ok]) => ok).length / results.length
}

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
/**
 * The fixture's check as the session of the run starts it after the implementer's report (prompt.md):
 * `sh .git/eval-finish.sh` from the run's folder, or from a linked worktree `tree` of it.
 */
const check = (tree: string, home: string): void => {
  const common = git(tree, home, 'rev-parse', '--path-format=absolute', '--git-common-dir').stdout.trim()
  const done = spawnSync('sh', [join(common, 'eval-finish.sh')], { cwd: tree, env: env(home), encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS })
  expect(done.status, done.stderr).toBe(0)
  expect(done.stdout).toBe('')
}
/** A commit of everything in `work`, then the check, as if the run ended there. */
const commit = (work: string, home: string, message: string): void => {
  expect(git(work, home, 'add', '-A').status).toBe(0)
  const done = git(work, home, 'commit', '-q', '-m', message)
  expect(done.status, done.stderr).toBe(0)
  check(work, home)
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
  it('the fixture: ticket 01 asks for percent with two rules and no reason for them, code_stories.pr is on, the check script is in .git and no git hook', () => {
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
      // With pr-green-ci and no origin the preflight answers BLOCKED, and the first paid run stopped there.
      const base = spawnSync(scriptNode(), [join(HARNESS, 'bin', 'profile'), '-C', work, '--field', 'worktree.base'], { cwd: work, env: env(home, extra), encoding: 'utf8' })
      expect(base.stdout.trim()).toBe('origin/main')
    }
    expect(git(work, home, 'remote', 'get-url', 'origin').stdout.trim()).toMatch(/[\\/]\.git[\\/]demo-origin\.git$/)
    expect(git(work, home, 'rev-parse', 'origin/main').stdout).toBe(git(work, home, 'rev-parse', 'main').stdout)
    expect(existsSync(join(work, '.git', 'eval-finish.sh'))).toBe(true)
    expect(existsSync(join(work, '.git', 'hooks', 'post-commit'))).toBe(false)
    expect(existsSync(join(work, LOG))).toBe(false)
    expect(git(work, home, 'status', '--porcelain').stdout).toBe('')
    expect(git(work, home, 'branch', '--show-current').stdout.trim()).toBe('main')
  })

  it('without a story the check logs EXIT=no-story; with the story on the ticket branch logs it in the branch with story-check exit 0, keeps a HEAD copy, and every grader passes', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, 'test/alpha.test.mjs', TEST)
    commit(work, home, 'demo/01: percent')
    expect(log(work)).toBe('stories: none\nEXIT=no-story\n')
    expect(existsSync(join(work, COPY))).toBe(false)
    expect(score(work)).toBeLessThan(THRESHOLD)

    put(work, STORY, GOOD_STORY)
    commit(work, home, 'demo/01: Code story')
    const text = log(work)
    expect(text.startsWith(`${GOOD_STORY}${SEPARATOR}\n`)).toBe(true)
    expect(text).toMatch(/^stories: \.scratch\/demo\/stories\/01-alpha\.md$/m)
    expect(text).toMatch(/^in-branch: \.scratch\/demo\/stories\/01-alpha\.md$/m)
    expect(text).toContain('.scratch/demo/stories/01-alpha.md: ok')
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=0')
    expect(readFileSync(join(work, COPY), 'utf8')).toBe(GOOD_STORY)

    expect(targetPath('story-check-green.md')).toBe(LOG)
    expect(targetPath('no-invented-reason.md')).toBe(JUDGE)
    expect(score(work)).toBe(1)

    // A later commit without a change to the story (the ticket's result section, say) checks it again on the
    // new head, and the run still scores 1: the story is in the branch, not only in the last commit.
    put(work, 'src/alpha.mjs', `${CODE}// end\n`)
    commit(work, home, 'demo/01: a later commit')
    expect(log(work).trimEnd().split('\n').at(-1)).toBe('EXIT=0')
    expect(score(work)).toBe(1)

    // A commit that deletes the story: the check replaces the green log with a red one.
    expect(git(work, home, 'rm', '-q', STORY).status).toBe(0)
    commit(work, home, 'demo/01: the story is gone')
    expect(log(work)).toMatch(/^EXIT=no-story$/m)
    expect(log(work)).not.toMatch(/^EXIT=0$/m)
    expect(score(work)).toBeLessThan(THRESHOLD)
  })

  it('a red story-check alone fails the case: a wrong fragment logs exit 2, and with every other grader passing the run scores below the threshold', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, STORY, GOOD_STORY.replace('Math.floor((done * 100) / total)', 'Math.round((done * 100) / total)'))
    commit(work, home, 'demo/01: percent and a wrong story')
    const text = log(work)
    expect(text).toMatch(/^in-branch: \.scratch\/demo\/stories\/01-alpha\.md$/m)
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=2')
    const results = graded(work)
    expect(results.filter(([, ok]) => !ok).map(([file]) => file)).toEqual(['story-check-green.md'])
    expect(score(work)).toBeLessThan(THRESHOLD)
    // Any one grader failing alone drops the run below the threshold, not only this one.
    expect((results.length - 1) / results.length).toBeLessThan(THRESHOLD)
  })

  it('each commit replaces the log: a later commit that breaks the story fails the story-check grader, an earlier green log does not count', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, STORY, GOOD_STORY)
    commit(work, home, 'demo/01: percent and its story')
    expect(passes('story-check-green.md', log(work))).toBe(true)
    put(work, 'src/alpha.mjs', CODE.replace('Math.floor', 'Math.trunc'))
    commit(work, home, 'demo/01: the code moves on, the story does not')
    const text = log(work)
    expect(text.match(/^EXIT=/gm)).toHaveLength(1)
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=2')
    expect(passes('story-check-green.md', text)).toBe(false)
  })

  it('a story committed on the main branch is not in the branch: story-check exits 1 there, and after a branch commit the log has no in-branch line', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, STORY, GOOD_STORY)
    commit(work, home, 'percent and its story on main')
    expect(log(work).trimEnd().split('\n').at(-1)).toBe('EXIT=1')
    expect(passes('story-check-green.md', log(work))).toBe(false)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'test/alpha.test.mjs', TEST)
    commit(work, home, 'demo/01: the test')
    const text = log(work)
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=0')
    expect(text).not.toMatch(/^in-branch:/m)
    expect(passes('story-check-green.md', text)).toBe(false)
  })

  it('a story at another path passes story-check, but the story-check grader wants .scratch/demo/stories/01-alpha.md', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, '.scratch/demo/stories/01-percent.md', GOOD_STORY)
    commit(work, home, 'demo/01: percent and a story under another name')
    const text = log(work)
    expect(text).toMatch(/^in-branch: \.scratch\/demo\/stories\/01-percent\.md$/m)
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=0')
    expect(passes('story-check-green.md', text)).toBe(false)
  })

  it('a green story on a branch other than the ticket branch demo/01 fails the story-check grader', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'percent').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, STORY, GOOD_STORY)
    commit(work, home, 'percent and its story on another branch')
    const text = log(work)
    expect(text).toMatch(/^in-branch: \.scratch\/demo\/stories\/01-alpha\.md$/m)
    expect(text).toContain('(branch percent)')
    expect(text.trimEnd().split('\n').at(-1)).toBe('EXIT=0')
    expect(passes('story-check-green.md', text)).toBe(false)
  })

  it('in a linked worktree the check reads that worktree: exit 0 on a valid story, the log and the copy in the common .git', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const tree = join(dirname(work), 'tree-01')
    expect(git(work, home, 'worktree', 'add', '-q', '-b', 'demo/01', tree).status).toBe(0)
    put(tree, 'src/alpha.mjs', CODE)
    put(tree, STORY, GOOD_STORY)
    commit(tree, home, 'demo/01: percent and its story, in a worktree')
    const text = log(work)
    expect(text).toMatch(/^in-branch: \.scratch\/demo\/stories\/01-alpha\.md$/m)
    expect(text.trimEnd().split('\n').at(-1), text).toBe('EXIT=0')
    expect(readFileSync(join(work, COPY), 'utf8')).toBe(GOOD_STORY)
  })

  it('the log and the copy hold the story at the last commit, not the working file', () => {
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    const committed = GOOD_STORY.replaceAll('не записано', 'так проще')
    put(work, STORY, committed)
    expect(git(work, home, 'add', '-A').status).toBe(0)
    // The working file differs from the staged one at the commit itself: the log and the copy have the committed text.
    put(work, STORY, GOOD_STORY)
    const done = git(work, home, 'commit', '-q', '-m', 'demo/01: percent and a story with a guess')
    expect(done.status, done.stderr).toBe(0)
    check(work, home)
    expect(log(work).startsWith(`${committed}${SEPARATOR}\n`)).toBe(true)
    expect(readFileSync(join(work, COPY), 'utf8')).toBe(committed)
    expect(readFileSync(join(work, JUDGE), 'utf8')).toContain(`\n${committed.replace(/\n+$/, '')}\n\`\`\`\`\n`)
  })

  it('the story-check grader refuses a story without the first frame step, a field or the fragment, with the review step, or with a red or missing story-check', () => {
    const file = 'story-check-green.md'
    expect(field(grader(file), 'type')).toBe('regex')
    // The real tail of a green log: the story-check output of the fixture on the ticket branch.
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, STORY, GOOD_STORY)
    commit(work, home, 'demo/01: percent and its story')
    const tail = log(work).slice(GOOD_STORY.length)
    expect(tail.startsWith(`${SEPARATOR}\n`)).toBe(true)
    const logged = (story: string, end = tail): string => `${story}${end}`

    expect(passes(file, logged(GOOD_STORY))).toBe(true)
    expect(passes(file, logged(GOOD_STORY).replaceAll('\n', '\r\n'))).toBe(true)
    expect(passes(file, logged(GOOD_STORY.replace('## 1. Что было не так\n', '## 1. Что было не так  \n'))), 'a trailing space after the frame title').toBe(true)
    // A story that never needs a missing reason passes without `not recorded`: that is for the llm grader.
    const honest = GOOD_STORY.replace('- Почему здесь: не записано', '- Почему здесь: файл назван в «Где в коде» ticket-а').replace('- Риски и пробелы test-ов: не записано', '- Риски и пробелы test-ов: test-ы есть на оба правила')
    expect(passes(file, logged(honest)), 'no не записано at all').toBe(true)
    const broken: [string, string][] = [
      ['first step is a code step', GOOD_STORY.replace('## 1. Что было не так', '## 1. Процент').replace('## 2. Целый процент', '## 2. Что было не так')],
      ['no frame step', GOOD_STORY.replace('## 1. Что было не так', '## 1. Начало')],
      ['English labels', GOOD_STORY.replace('Language: ru', 'Language: en')],
      ['no Kind: pr', GOOD_STORY.replace('Kind: pr · ', '')],
      ['no Почему здесь', GOOD_STORY.replace('- Почему здесь: не записано\n', '')],
      ['no Что делает', GOOD_STORY.replace(/- Что делает: .*\n/, '')],
      ['no Без него', GOOD_STORY.replace(/- Без него: .*\n/, '')],
      ['no Требование', GOOD_STORY.replace(/- Требование: .*\n/g, '')],
      ['no Риски', GOOD_STORY.replace('- Риски и пробелы test-ов: не записано\n', '')],
      ['no fragment', GOOD_STORY.replace(/Code: .*\n/, '')],
      ['the review step', `${GOOD_STORY}\n## 4. Что нашёл review и что осталось\n\nНичего.\n`],
      ['another title', GOOD_STORY.replace('# Code story — demo 01:', '# Code story — demo 02:')],
    ]
    for (const [what, story] of broken) expect(passes(file, logged(story)), what).toBe(false)
    expect(passes(file, GOOD_STORY), 'the story without the story-check output').toBe(false)
    expect(passes(file, logged(GOOD_STORY, tail.replace(/^EXIT=0$/m, 'EXIT=2'))), 'story-check exit 2').toBe(false)
    expect(passes(file, logged('', tail)), 'the story-check output without the story').toBe(false)
    expect(passes(file, logged(GOOD_STORY, tail.replace(`${SEPARATOR}\n`, ''))), 'no separator line before the story-check output').toBe(false)
  })

  it('the invented-reason grader: an llm judge of one input with the ticket, the demo rules, the source and test files and the story, all at HEAD', () => {
    const file = 'no-invented-reason.md'
    expect(field(grader(file), 'type')).toBe('llm')
    expect(targetPath(file)).toBe(JUDGE)
    const text = readFileSync(join(CASE, 'graders', file), 'utf8')
    for (const words of ['the ticket of\ndemo 01', 'the project rules', '`src/*.mjs`', '`test/*.mjs`', 'the Code story of the ticket',
      'FAIL only for an invented fact', 'A statement about test coverage', 'judged against the test\nfiles of the input', '`не записано` is required only where',
      'A field that does not explain a rule needs no `не записано`.', '«Почему здесь: отчёт вызывает `percent`; это единственное место»', 'PASS'])
      expect(text, words).toContain(words)
    for (const label of ['Что делает', 'Почему здесь', 'Без него', 'Требование', 'Риски и пробелы test-ов'])
      expect(text, label).toContain(`\`${label}\``)

    // The input as the check writes it: each part as HEAD has it, in a fence of four backticks, the story last.
    const { work, home, run } = build()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(git(work, home, 'switch', '-q', '-c', 'demo/01').status).toBe(0)
    put(work, 'src/alpha.mjs', CODE)
    put(work, 'test/alpha.test.mjs', TEST)
    put(work, STORY, GOOD_STORY)
    commit(work, home, 'demo/01: percent, its test and its story')
    // A later change of the working files is not in the input: it reads HEAD.
    put(work, 'src/alpha.mjs', `${CODE}// not committed\n`)
    check(work, home)
    const head = (path: string): string => git(work, home, 'show', `HEAD:${path}`).stdout
    const part = (heading: string, body: string): string => `# ${heading}\n\n\`\`\`\`\n${body.replace(/\n+$/, '')}\n\`\`\`\`\n\n`
    const rules = readFileSync(join(home, '.claude', 'worfy-harness', 'projects', 'demo', 'rules.md'), 'utf8')
    const files = ['src/alpha.mjs', 'src/sum.mjs', 'test/alpha.test.mjs', 'test/sum.test.mjs']
    expect(git(work, home, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'src', 'test').stdout.trim().split('\n')).toEqual(files)
    expect(readFileSync(join(work, JUDGE), 'utf8')).toBe(
      [
        part('The ticket .scratch/demo/issues/01-alpha.md as HEAD has it', head('.scratch/demo/issues/01-alpha.md')),
        part('The project rules (rules.md of the demo profile)', rules),
        ...files.map((path) => part(`The file ${path} as HEAD has it`, head(path))),
        part('The Code story .scratch/demo/stories/01-alpha.md as HEAD has it', GOOD_STORY),
      ].join(''),
    )
    expect(readFileSync(join(work, JUDGE), 'utf8')).not.toContain('// not committed')
    expect(rules).toContain('`node --test`')
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

  it('has the four graders of the case and the dispatch to worfy:implementer; the case is in no CI workflow and not in the gate', () => {
    expect(readdirSync(join(CASE, 'graders')).sort()).toEqual(GRADERS)
    const dispatched = grader('implementer-dispatched.md')
    expect(field(dispatched, 'type')).toBe('tool_used')
    expect(field(dispatched, 'tool')).toBe('Agent')
    const call = JSON.stringify({ description: 'ticket 01', subagent_type: 'worfy:implementer', prompt: 'Ticket 01 of epic demo' })
    expect(call).toMatch(new RegExp(field(dispatched, 'input_match') ?? '<none>'))
    expect(JSON.stringify({ description: 'map', subagent_type: 'worfy:scout', prompt: 'x' })).not.toMatch(new RegExp(field(dispatched, 'input_match') ?? '<none>'))
    const prompt = frontMatter(join(CASE, 'prompt.md'))
    expect(field(prompt, 'tags')).toBe('[main]')
    // The session starts the fixture's check last, after the report; the prompt names no story.
    const text = readFileSync(join(CASE, 'prompt.md'), 'utf8').slice(prompt.length)
    expect(text.indexOf('`sh .git/eval-finish.sh`')).toBeGreaterThan(text.indexOf('implementer-report.json'))
    expect(text).not.toMatch(/story|story-check/i)

    const workflows = join(REPO, '.github', 'workflows')
    for (const file of readdirSync(workflows)) expect(readFileSync(join(workflows, file), 'utf8'), file).not.toContain(NAME)
    expect(readFileSync(join(HARNESS, 'hooks', 'gate.mjs'), 'utf8')).not.toContain(NAME)

    const coverage = JSON.parse(readFileSync(join(EVALS, 'lib', 'coverage.json'), 'utf8')) as { cases: Record<string, string[]>; uncovered: Record<string, string> }
    expect(coverage.cases[NAME]).toEqual(['agents/implementer.md', 'skills/ship-ticket/story-pr.md', 'skills/ship-ticket/implementer-finish.md'])
    expect(coverage.uncovered['skills/ship-ticket/story-pr.md']).toBeUndefined()
  })
})
