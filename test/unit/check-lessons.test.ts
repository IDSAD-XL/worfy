// scripts/check-lessons.mjs: every lesson (a `##` heading in docs/lessons/*.md, README.md aside) has a
// check line — it starts with the mark of scripts/doc-headings.json (`lessons.check`) — in one of two
// forms: `<path>:<line>` of the test, hook test or eval case that guards it (an explanation after ` — `
// allowed), or the no-check word (`lessons.no_check`) with a reason; one such line per lesson.
// The fixtures are small repositories in test/fixtures/check-lessons/<case>/, each with its own
// docs/lessons/ and the files they point at; they are written with the repository's own words.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-lessons.mjs')
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'check-lessons')
const LESSONS = 'docs/lessons/topic.md'
// The repository's words for the check line, as the script reads them.
const WORDS = (JSON.parse(readFileSync(join(REPO, 'scripts', 'doc-headings.json'), 'utf8')) as { lessons: { check: string; no_check: string } }).lessons
const MARK = WORDS.check
const GAP = WORDS.no_check

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** Runs the script on a repository root, under the real node (test/script-node.ts). */
function run(root: string, args: readonly string[] = []): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(scriptNode(), [SCRIPT, ...args, root], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  return { status: child.status, stdout: child.stdout, stderr: child.stderr }
}

/** Runs the script on one fixture repository. */
function check(fixture: string): { status: number | null; stdout: string; stderr: string } {
  return run(join(FIXTURES, fixture))
}

/** The violation lines of stderr, without the closing summary line. */
function violations(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith(`${LESSONS}:`))
}

const NOT_A_FORM = `is neither "<path>:<line>" nor "${GAP} <reason>"`

describe('check-lessons', () => {
  it('passes a test line with an explanation, a Harness script test, and an honest gap; skips README.md and ## in a code block', () => {
    const { status, stdout, stderr } = check('good')
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('lessons: ok (3 lessons: 2 linked, 1 without a check)\n')
  })

  it('fails a lesson without a check line and names its file, line and heading', () => {
    const { status, stderr } = check('missing')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:7: "A lesson without a check": no "${MARK}" line — "${MARK} <path>:<line>" of a test, a hook test or an eval case, or "${MARK} ${GAP} <reason>"`,
    ])
    expect(stderr).toContain('lessons: 1 violation —')
  })

  it('fails a reference to a file that does not exist', () => {
    const { status, stderr } = check('no-file')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([`${LESSONS}:5: "A lesson pointing at a deleted test": test/deleted.txt — no such file`])
  })

  it('fails the no-check word with an empty or blank reason and passes it with a reason', () => {
    const { status, stderr } = check('empty-reason')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:5: "A gap with no reason": "${GAP}" without a reason`,
      `${LESSONS}:9: "A gap with only spaces for a reason": "${GAP}" without a reason`,
    ])
  })

  it('fails a line past the end of the file, and line 0', () => {
    const { status, stderr } = check('past-end')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:5: "A line past the end of the file": test/guard.txt:4 — past the end of the file (it has 3 lines)`,
      `${LESSONS}:9: "Line zero": test/guard.txt:0 — lines are counted from 1`,
    ])
  })

  it('fails anything but the two forms, a folder, a path outside the repository and a file that is no test', () => {
    const { status, stderr } = check('bad-reference')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:5: "A reference without a line": "test/guard.txt" ${NOT_A_FORM}`,
      `${LESSONS}:9: "A reference to a folder": test/folder — not a file`,
      `${LESSONS}:13: "A reference outside the repository": ../good/test/guard.txt — a path outside the repository`,
      `${LESSONS}:17: "A reference to a file that is not a test, a hook test or an eval case": src/guard.txt — not a test: the path starts with none of test/, harness/hooks/tests/, harness/bin/tests/ or harness/evals/`,
      `${LESSONS}:21: "A reference in backticks": "\`test/guard.txt:1\`" ${NOT_A_FORM}`,
      `${LESSONS}:25: "A range": "test/guard.txt:1-3" ${NOT_A_FORM}`,
      `${LESSONS}:29: "Two references": "test/guard.txt:1, test/guard.txt:2" ${NOT_A_FORM}`,
      `${LESSONS}:33: "Free text only": "the unit test of the reader." ${NOT_A_FORM}`,
      `${LESSONS}:38: "Two check lines": a second "${MARK}" line — a lesson has one (the first is line 37)`,
    ])
    expect(stderr).toContain('lessons: 9 violations —')
  })

  it('passes the example line of docs/lessons/README.md as the check line of a lesson', () => {
    const readme = readFileSync(join(REPO, 'docs', 'lessons', 'README.md'), 'utf8')
    const example = readme.split('\n').find((line) => line.startsWith(`${MARK} test/`))
    if (example === undefined) throw new Error(`docs/lessons/README.md has no example line \`${MARK} test/…\``)
    const target = example.slice(MARK.length).trim().split(':')[0]
    if (target === undefined) throw new Error(`the example is not <path>:<line>: ${example}`)
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-lessons-')))
    dirs.push(root)
    mkdirSync(join(root, dirname(target)), { recursive: true })
    copyFileSync(join(REPO, target), join(root, target))
    mkdirSync(join(root, 'docs', 'lessons'), { recursive: true })
    writeFileSync(join(root, LESSONS), `# Topic\n\n## The example of the README\n\n${example}\nSource: README.\n`)
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('lessons: ok (1 lesson: 1 linked, 0 without a check)\n')
  })

  it('reads the words of the check line from the file given with --headings', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-lessons-')))
    dirs.push(root)
    mkdirSync(join(root, 'test'), { recursive: true })
    writeFileSync(join(root, 'test', 'guard.txt'), 'one\ntwo\n')
    mkdirSync(join(root, 'docs', 'lessons'), { recursive: true })
    const lesson = (title: string, line: string): string => `## ${title}\n\n${line}\n`
    writeFileSync(
      join(root, LESSONS),
      `# Topic\n\n${lesson('Linked', 'Check: test/guard.txt:2 — the second line')}\n${lesson('A gap', 'Check: no check: nothing runs it')}\n${lesson('The repository\'s word', `${MARK} test/guard.txt:1`)}`,
    )
    const config = join(root, 'headings.json')
    // Spaces around a word of the config are not part of it.
    writeFileSync(config, JSON.stringify({ lessons: { check: '  Check: ', no_check: ' no check:  ' } }))
    const { status, stderr } = run(root, ['--headings', config])
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([`${LESSONS}:11: "The repository's word": no "Check:" line — "Check: <path>:<line>" of a test, a hook test or an eval case, or "Check: no check: <reason>"`])
    // The same lessons with the repository's config: only the third one has a check line.
    const own = run(root)
    expect(own.status).toBe(1)
    expect(violations(own.stderr).map((line) => line.split(':')[1])).toEqual(['3', '7'])
  })

  it.each([
    ['a missing file', null, 'cannot be read'],
    ['a file that is not JSON', '[', 'is not JSON'],
    ['no lessons words', '{"handoff":{"sections":["Now"]}}', 'lessons.check and lessons.no_check are non-empty strings'],
    ['a blank mark', '{"lessons":{"check":" ","no_check":"no check:"}}', 'lessons.check and lessons.no_check are non-empty strings'],
    ['no no_check', '{"lessons":{"check":"Check:"}}', 'lessons.check and lessons.no_check are non-empty strings'],
    ['an empty no_check', '{"lessons":{"check":"Check:","no_check":""}}', 'lessons.check and lessons.no_check are non-empty strings'],
    ['a no_check that is not a string', '{"lessons":{"check":"Check:","no_check":5}}', 'lessons.check and lessons.no_check are non-empty strings'],
  ])('exits 2 when the headings config is %s', (_case, text, message) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-lessons-')))
    dirs.push(dir)
    const config = join(dir, 'headings.json')
    if (text !== null) writeFileSync(config, text)
    const { status, stdout, stderr } = run(join(FIXTURES, 'good'), ['--headings', config])
    expect(status).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain(config)
    expect(stderr).toContain(message)
  })

  it('exits 2 when the lessons folder cannot be read', () => {
    const { status, stderr } = check('absent')
    expect(status).toBe(2)
    expect(stderr).toContain('docs/lessons: cannot be read')
  })
})
