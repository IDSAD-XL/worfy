// scripts/check-lessons.mjs: every lesson (a `##` heading in docs/lessons/*.md, README.md aside) has a
// `Проверка:` line in one of two forms — `<path>:<line>` of the test, hook test or eval case that guards it
// (an explanation after ` — ` allowed), or `проверки нет: <почему>` with a reason; one such line per lesson.
// The fixtures are small repositories in test/fixtures/check-lessons/<case>/, each with its own
// docs/lessons/ and the files they point at.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-lessons.mjs')
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'check-lessons')
const LESSONS = 'docs/lessons/topic.md'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** Runs the script on a repository root; `pnpm test` runs under Electron as Node, so the child does too. */
function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
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

const NOT_A_FORM = '— не «<путь>:<строка>» и не «проверки нет: <почему>»'

describe('check-lessons', () => {
  it('passes a test line with an explanation, a Harness script test, and an honest gap; skips README.md and ## in a code block', () => {
    const { status, stdout, stderr } = check('good')
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('lessons: ok (3 урока: 2 со ссылкой, 1 без проверки)\n')
  })

  it('fails a lesson without a `Проверка:` line and names its file, line and heading', () => {
    const { status, stderr } = check('missing')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:7: «A lesson without a check»: нет строки «Проверка:» — «Проверка: <путь>:<строка>» test-а, test-а hook-а или eval-кейса, или «Проверка: проверки нет: <почему>»`,
    ])
    expect(stderr).toContain('lessons: нарушений 1')
  })

  it('fails a reference to a file that does not exist', () => {
    const { status, stderr } = check('no-file')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([`${LESSONS}:5: «A lesson pointing at a deleted test»: test/deleted.txt — такого файла нет`])
  })

  it('fails «проверки нет:» with an empty or blank reason and passes it with a reason', () => {
    const { status, stderr } = check('empty-reason')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:5: «A gap with no reason»: «проверки нет:» без причины`,
      `${LESSONS}:9: «A gap with only spaces for a reason»: «проверки нет:» без причины`,
    ])
  })

  it('fails a line past the end of the file, and line 0', () => {
    const { status, stderr } = check('past-end')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:5: «A line past the end of the file»: test/guard.txt:4 — за концом файла (в нём 3 строки)`,
      `${LESSONS}:9: «Line zero»: test/guard.txt:0 — строки считаются с 1`,
    ])
  })

  it('fails anything but the two forms, a folder, a path outside the repository and a file that is no test', () => {
    const { status, stderr } = check('bad-reference')
    expect(status).toBe(1)
    expect(violations(stderr)).toEqual([
      `${LESSONS}:5: «A reference without a line»: «test/guard.txt» ${NOT_A_FORM}`,
      `${LESSONS}:9: «A reference to a folder»: test/folder — не файл`,
      `${LESSONS}:13: «A reference outside the repository»: ../good/test/guard.txt — путь вне репозитория`,
      `${LESSONS}:17: «A reference to a file that is not a test, a hook test or an eval case»: src/guard.txt — не test: путь не начинается с test/, harness/hooks/tests/, harness/bin/tests/ или harness/evals/`,
      `${LESSONS}:21: «A reference in backticks»: «\`test/guard.txt:1\`» ${NOT_A_FORM}`,
      `${LESSONS}:25: «A range»: «test/guard.txt:1-3» ${NOT_A_FORM}`,
      `${LESSONS}:29: «Two references»: «test/guard.txt:1, test/guard.txt:2» ${NOT_A_FORM}`,
      `${LESSONS}:33: «Free text only»: «the unit test of the reader.» ${NOT_A_FORM}`,
      `${LESSONS}:38: «Two check lines»: вторая строка «Проверка:» — у урока она одна (первая — строка 37)`,
    ])
    expect(stderr).toContain('lessons: нарушений 9')
  })

  it('passes the example line of docs/lessons/README.md as the check line of a lesson', () => {
    const readme = readFileSync(join(REPO, 'docs', 'lessons', 'README.md'), 'utf8')
    const example = readme.split('\n').find((line) => line.startsWith('Проверка: test/'))
    if (example === undefined) throw new Error('docs/lessons/README.md has no example line `Проверка: test/…`')
    const target = /^Проверка: (\S+):\d+/.exec(example)?.[1]
    if (target === undefined) throw new Error(`the example is not <path>:<line>: ${example}`)
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-lessons-')))
    dirs.push(root)
    mkdirSync(join(root, dirname(target)), { recursive: true })
    copyFileSync(join(REPO, target), join(root, target))
    mkdirSync(join(root, 'docs', 'lessons'), { recursive: true })
    writeFileSync(join(root, LESSONS), `# Topic\n\n## The example of the README\n\n${example}\nИсточник: README.\n`)
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('lessons: ok (1 урок: 1 со ссылкой, 0 без проверки)\n')
  })

  it('exits 2 when the lessons folder cannot be read', () => {
    const { status, stderr } = check('absent')
    expect(status).toBe(2)
    expect(stderr).toContain('docs/lessons: не читается')
  })
})
