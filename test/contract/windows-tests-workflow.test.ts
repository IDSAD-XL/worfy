// The manual "Windows tests" workflow (.github/workflows/windows-tests.yml, worfy-windows ticket 25)
// and the check of its input (scripts/windows-test-list.mjs). A Windows runner minute is paid, and
// the whole suite is red on Windows, so every limit of the job is pinned here: loosening one turns
// the Linux CI red. The project has no YAML parser, so the workflow is read as text: it is written
// in block style, one key per line, with `#` only at the start of comment lines.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const WORKFLOW = join(REPO, '.github', 'workflows', 'windows-tests.yml')
const SCRIPT = join(REPO, 'scripts', 'windows-test-list.mjs')

/** The workflow without its comment lines and blank lines. */
const code = (): string[] =>
  readFileSync(WORKFLOW, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

const indent = (line: string): number => line.length - line.trimStart().length

/** The lines nested under the line that reads exactly `header`; there must be one such line. */
function under(lines: string[], header: string): string[] {
  expect(lines.filter((line) => line === header), `lines that read "${header}"`).toHaveLength(1)
  const nested: string[] = []
  for (const line of lines.slice(lines.indexOf(header) + 1)) {
    if (indent(line) <= indent(header)) break
    nested.push(line)
  }
  return nested
}

/** The keys one level down in a block: its least indented lines, up to the colon. */
function keys(block: string[]): string[] {
  const least = Math.min(...block.map(indent))
  return block.filter((line) => indent(line) === least).map((line) => line.trim().replace(/:.*$/, ''))
}

/** The one job of the workflow: its name and its lines. */
function job(): { name: string; lines: string[] } {
  const jobs = under(code(), 'jobs:')
  const names = keys(jobs)
  expect(names, 'jobs of the workflow').toHaveLength(1)
  const name = names[0] ?? ''
  return { name, lines: under(jobs, `  ${name}:`) }
}

/** A step: a plain value is a string; a nested block (`env:`, `with:`, `run: |`) is its lines. */
type Step = Record<string, string | string[]>

function steps(): Step[] {
  const parsed: Step[] = []
  let step: Step = {}
  let key = ''
  for (const raw of under(job().lines, '    steps:')) {
    const starts = raw.startsWith('      - ')
    const line = starts ? raw.replace('      - ', '        ') : raw
    if (starts) {
      step = {}
      parsed.push(step)
    }
    if (indent(line) === 8) {
      const match = /^([^:\s]+):(?: (.*))?$/.exec(line.trim())
      expect(match, `a "key: value" line of a step: ${raw}`).not.toBeNull()
      key = match?.[1] ?? ''
      const value = match?.[2]
      step[key] = value === undefined || value === '|' ? [] : value
    } else {
      const block = step[key]
      expect(Array.isArray(block), `a nested line under "${key}": ${raw}`).toBe(true)
      if (Array.isArray(block)) block.push(line.trim())
    }
  }
  return parsed
}

/** What a step does: its action without the version, or its commands. */
const does = (step: Step): string | string[] | undefined =>
  typeof step.uses === 'string' ? step.uses.replace(/@.*$/, '') : step.run

const CHECK = 'node scripts/windows-test-list.mjs'
const INSTALL = 'pnpm install --frozen-lockfile'
const RUN = ['test -n "$TEST_FILES"', 'node scripts/vitest-electron.mjs $TEST_FILES']

describe('.github/workflows/windows-tests.yml', () => {
  it('starts by hand only: workflow_dispatch is its one trigger', () => {
    const lines = code()
    // One `on:` key in block style: `on: push`, `on: [workflow_dispatch, push]` and a second key fail here.
    expect(lines.filter((line) => /^["']?on["']?\s*:/.test(line))).toEqual(['on:'])
    expect(keys(under(lines, 'on:'))).toEqual(['workflow_dispatch'])
    expect(lines.join('\n')).not.toMatch(/\b(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call)\b/)
  })

  it('takes one required input, the list of files, with no default list', () => {
    const inputs = under(under(under(code(), 'on:'), '  workflow_dispatch:'), '    inputs:')
    expect(keys(inputs)).toEqual(['files'])
    const files = under(inputs, '      files:')
    expect(keys(files)).toEqual(['description', 'required', 'type'])
    expect(files).toContain('        required: true')
    expect(files).toContain('        type: string')
  })

  it('may only read the repository: permissions are contents: read and nothing else', () => {
    // `permissions: write-all` on one line and a `permissions` key of the job fail here too.
    expect(code().filter((line) => /permissions/.test(line))).toEqual(['permissions:'])
    expect(under(code(), 'permissions:')).toEqual(['  contents: read'])
  })

  it('has one job, on windows-latest, with no matrix', () => {
    const { lines } = job()
    // Exactly these keys: no `strategy` (a matrix multiplies the paid minutes), no `if`, no
    // `continue-on-error`, no job-level `env` or `defaults` that would change what the steps see.
    expect(keys(lines)).toEqual(['runs-on', 'timeout-minutes', 'steps'])
    expect(lines).toContain('    runs-on: windows-latest')
    expect(code().join('\n')).not.toMatch(/matrix|strategy/)
    expect(code().filter((line) => /runs-on/.test(line))).toEqual(['    runs-on: windows-latest'])
  })

  it('stops the job after 10 minutes', () => {
    // The limit is the job's own: a limit on a step alone would leave the install unbounded.
    expect(code().filter((line) => /timeout-minutes/.test(line))).toEqual(['    timeout-minutes: 10'])
  })

  it('checks the list right after checkout, before anything is installed', () => {
    const all = steps().map(does)
    expect(all).toEqual(['actions/checkout', CHECK, 'pnpm/action-setup', 'actions/setup-node', INSTALL, RUN])
    expect(all.indexOf(CHECK)).toBe(1)
    expect(all.indexOf(CHECK)).toBeLessThan(all.indexOf(INSTALL))
  })

  it('hands the input to the check through env, never as text of a command', () => {
    // The whole step: no `if`, no `continue-on-error` — a refused list fails the job.
    expect(steps()[1]).toEqual({
      name: 'Check the list of test files',
      id: 'list',
      shell: 'bash',
      env: ['TEST_FILES: ${{ inputs.files }}'],
      run: CHECK,
    })
    // An expression inside `run` is pasted into the script before the shell reads it: a list such
    // as `x; rm -rf .` would run as a command. Expressions stand in the two `env` values only.
    expect(code().filter((line) => line.includes('${{'))).toEqual([
      '          TEST_FILES: ${{ inputs.files }}',
      '          TEST_FILES: ${{ steps.list.outputs.files }}',
    ])
    for (const step of steps()) expect([step.run ?? []].flat().join('\n')).not.toContain('${{')
  })

  it('runs node scripts/vitest-electron.mjs with the checked list', () => {
    // The whole step. The list comes from the output of the check, not from the input. bash, because
    // in PowerShell `$TEST_FILES` is an unset variable and the command would run the whole suite;
    // `test -n` stops the step for the same reason if the list is ever empty.
    expect(steps()[5]).toEqual({
      name: 'Run the listed test files',
      shell: 'bash',
      env: ['TEST_FILES: ${{ steps.list.outputs.files }}'],
      run: RUN,
    })
  })

  it('never runs the whole suite: no pnpm test, no vitest without the list', () => {
    const commands = steps().flatMap((step) => step.run ?? [])
    expect(commands).toEqual([CHECK, INSTALL, ...RUN])
    for (const command of commands) expect(command).not.toMatch(/pnpm\s+(run\s+)?test|vitest(?!-electron\.mjs \$TEST_FILES$)/)
  })
})

describe('scripts/windows-test-list.mjs', () => {
  /** Runs the check as the workflow does: the list in TEST_FILES, the answer in the GITHUB_OUTPUT file. */
  const check = (list: string | undefined, cwd = REPO) => {
    const outputFile = join(scratch, `output-${++runs}`)
    writeFileSync(outputFile, '')
    const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: outputFile }
    delete env.TEST_FILES
    if (list !== undefined) env.TEST_FILES = list
    const result = spawnSync(process.execPath, [SCRIPT], { cwd, env, encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: readFileSync(outputFile, 'utf8') }
  }

  let scratch = ''
  /** A stand-in repository where each refused file exists, so that one rule alone refuses it. */
  let tree = ''
  let runs = 0

  const TWO = ['test/unit/remote-links.test.ts', 'test/unit/shell-resolve.test.ts']

  /** Test files of this repository, in a stable order. */
  const realFiles = (count: number): string[] =>
    readdirSync(join(REPO, 'test', 'unit'))
      .filter((name) => /^[a-z0-9-]+\.test\.ts$/.test(name))
      .sort()
      .slice(0, count)
      .map((name) => `test/unit/${name}`)

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'worfy-windows-test-list-'))
    tree = join(scratch, 'tree')
    const files = [
      'test/unit/ok.test.ts',
      'test/unit/view.test.tsx',
      'test/unit/nested/deep.test.ts',
      'test/contract/ok.test.ts',
      'test/unit/e2e-flow.test.ts',
      'test/unit/E2E-upper.test.ts',
      'test/unit/packaged-app.test.ts',
      'test/contract/acceptance-run.test.ts',
      // The word in other places of a name: after "-", "_" and ".", and as the name of a folder.
      'test/unit/flow-e2e.test.ts',
      'test/unit/x_e2e.test.ts',
      'test/unit/app.packaged.test.ts',
      'test/unit/run_acceptance.test.ts',
      'test/unit/e2e/inner.test.ts',
      'test/unit/helper.ts',
      'test/unit/notes.test.js',
      'test/unit/ok.spec.ts',
      'test/unit/a[b].test.ts',
      'test/unit/a=b.test.ts',
      'test/unit/pair.test.ts',
      'test/unit/pair.test.tsx',
      // The same pair with another letter case in the longer name.
      'test/unit/twin.test.ts',
      'test/unit/Twin.test.tsx',
      'test/other/x.test.ts',
      'test/e2e/x.test.ts',
      'src/x.test.ts',
      '-x.test.ts',
    ]
    for (const file of files) {
      mkdirSync(join(tree, file, '..'), { recursive: true })
      writeFileSync(join(tree, file), '')
    }
    // A directory with the name of a test file.
    mkdirSync(join(tree, 'test', 'unit', 'folder.test.ts'))
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('accepts two test files and hands them on as the output "files"', () => {
    const result = check(TWO.join(' '))
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`files=${TWO.join(' ')}\n`)
  })

  it.each([
    ['a comma', TWO.join(',')],
    ['a comma and a space', TWO.join(', ')],
    ['a line break', TWO.join('\n')],
    ['a Windows line break', TWO.join('\r\n')],
    ['spaces around and a comma at the end', `  ${TWO.join('  ')}, `],
  ])('splits the list at %s', (_name, list) => {
    const result = check(list)
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`files=${TWO.join(' ')}\n`)
  })

  it('accepts files of both folders, .test.ts and .test.tsx, and files in subfolders', () => {
    const list = ['test/unit/ok.test.ts', 'test/unit/view.test.tsx', 'test/unit/nested/deep.test.ts', 'test/contract/ok.test.ts']
    const result = check(list.join(' '), tree)
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`files=${list.join(' ')}\n`)
  })

  it.each([
    ['not set', undefined],
    ['empty', ''],
    ['spaces only', '  \n '],
    ['separators only', ' , ,, '],
  ])('refuses a list that is %s', (_name, list) => {
    const result = check(list)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/the list is empty/)
    expect(result.output).toBe('')
  })

  it('accepts 12 files and refuses 13', () => {
    const thirteen = realFiles(13)
    expect(thirteen).toHaveLength(13)

    const twelve = check(thirteen.slice(0, 12).join(' '))
    expect(twelve.status, twelve.stderr).toBe(0)
    expect(twelve.output).toBe(`files=${thirteen.slice(0, 12).join(' ')}\n`)

    const refused = check(thirteen.join(' '))
    expect(refused.status).toBe(1)
    expect(refused.stderr).toMatch(/13 files listed, one run takes 12 at most/)
    expect(refused.output).toBe('')
  })

  // Every file below exists in the stand-in repository, unless the name says otherwise.
  it.each([
    ['an e2e file of this repository', 'test/e2e/terminal.spec.ts', /is not under test\/unit\/ or test\/contract\//, REPO],
    ['a file under another folder of test/', 'test/other/x.test.ts', /is not under test\/unit\/ or test\/contract\//, ''],
    ['a file under src/', 'src/x.test.ts', /is not under test\/unit\/ or test\/contract\//, ''],
    ['a path that leaves the folder through ..', 'test/unit/../e2e/x.test.ts', /has "e2e" in its name/, ''],
    ['a path with .. that stays in the two folders', 'test/unit/../contract/ok.test.ts', /is not a file found under/, ''],
    ['a path with a . segment', 'test/unit/./ok.test.ts', /is not a file found under/, ''],
    ['a path with a doubled slash', 'test/unit//ok.test.ts', /is not a file found under/, ''],
    ['an option with a value', '--config=x', /starts with "-"/, ''],
    ['a short option', '-t', /starts with "-"/, ''],
    ['a file whose name starts with -', '-x.test.ts', /starts with "-"/, ''],
    ['a file that does not exist', 'test/unit/no-such-file.test.ts', /is not a file found under/, ''],
    ['a file of this repository that does not exist', 'test/contract/no-such-file-zz.test.ts', /is not a file found under/, REPO],
    ['a name in another letter case', 'test/unit/OK.test.ts', /is not a file found under/, ''],
    ['a directory named like a test file','test/unit/folder.test.ts', /is not a file found under/, ''],
    ['a folder', 'test/unit/', /is not a \*\.test\.ts or \*\.test\.tsx file/, ''],
    ['a name with e2e', 'test/unit/e2e-flow.test.ts', /has "e2e" in its name/, ''],
    ['a name with E2E in capitals', 'test/unit/E2E-upper.test.ts', /has "e2e" in its name/, ''],
    ['a name with packaged', 'test/unit/packaged-app.test.ts', /has "packaged" in its name/, ''],
    ['a name with acceptance', 'test/contract/acceptance-run.test.ts', /has "acceptance" in its name/, ''],
    ['a name with e2e after -', 'test/unit/flow-e2e.test.ts', /has "e2e" in its name/, ''],
    ['a name with e2e after _', 'test/unit/x_e2e.test.ts', /has "e2e" in its name/, ''],
    ['a name with packaged between dots', 'test/unit/app.packaged.test.ts', /has "packaged" in its name/, ''],
    ['a name with acceptance after _', 'test/unit/run_acceptance.test.ts', /has "acceptance" in its name/, ''],
    ['a file in a folder named e2e', 'test/unit/e2e/inner.test.ts', /has "e2e" in its name/, ''],
    ['a helper that is not a test file', 'test/unit/helper.ts', /is not a \*\.test\.ts or \*\.test\.tsx file/, ''],
    ['a .test.js file', 'test/unit/notes.test.js', /is not a \*\.test\.ts or \*\.test\.tsx file/, ''],
    ['a .spec.ts file', 'test/unit/ok.spec.ts', /is not a \*\.test\.ts or \*\.test\.tsx file/, ''],
    ['a name that is a prefix of a test file name', 'test/unit/ok.test', /is not a \*\.test\.ts or \*\.test\.tsx file/, ''],
    ['a name with glob characters', 'test/unit/a[b].test.ts', /has a character other than/, ''],
    ['a glob', 'test/unit/*.test.ts', /has a character other than/, ''],
    ['a pattern with ?', 'test/unit/o?.test.ts', /has a character other than/, ''],
    ['a name with =', 'test/unit/a=b.test.ts', /has a character other than/, ''],
    ['a path with backslashes', 'test\\unit\\ok.test.ts', /has a character other than/, ''],
    ['a path with a drive letter', 'C:/repo/test/unit/ok.test.ts', /has a character other than/, ''],
    ['a path from the root of the disk', '/tmp/test/unit/ok.test.ts', /is not under test\/unit\/ or test\/contract\//, ''],
    ['a name that vitest would match to a second file', 'test/unit/pair.test.ts', /also matches test\/unit\/pair\.test\.tsx/, ''],
    // vitest compares without regard to letter case, on every system.
    ['a name that vitest would match to a file in another letter case', 'test/unit/twin.test.ts', /also matches test\/unit\/Twin\.test\.tsx/, ''],
  ])('refuses %s', (_name, element, reason, cwd) => {
    const result = check(element, cwd || tree)
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toMatch(reason)
    expect(result.stderr).toContain(JSON.stringify(element))
    expect(result.output).toBe('')
  })

  it('refuses the absolute path of a test file', () => {
    const result = check(join(tree, 'test', 'unit', 'ok.test.ts'), tree)
    expect(result.status, result.stdout).toBe(1)
    // A POSIX path fails on the folder, a Windows one already on `:` and `\`.
    expect(result.stderr).toMatch(/is not under test\/unit\/ or test\/contract\/|has a character other than/)
    expect(result.output).toBe('')
  })

  it('accepts the longer name of a pair that vitest tells apart', () => {
    const result = check('test/unit/pair.test.tsx', tree)
    expect(result.status, result.stderr).toBe(0)
  })

  it('refuses the whole list when one element is refused, and names every refused element', () => {
    const result = check('test/unit/ok.test.ts --config=x test/e2e/x.test.ts', tree)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/"--config=x": starts with "-"/)
    expect(result.stderr).toMatch(/"test\/e2e\/x\.test\.ts": is not under/)
    expect(result.stderr).not.toContain('"test/unit/ok.test.ts"')
    expect(result.output).toBe('')
  })

  // Not skipped on Windows: Developer Mode is a requirement of a development machine there
  // (README.md, "Development on Windows"), and without it this test fails and says so.
  it('refuses a path that goes through a symbolic link', () => {
    const link = (target: string, path: string) => {
      try {
        symlinkSync(target, path)
      } catch (error) {
        throw new Error(`cannot create the symbolic link ${path}: on Windows turn on Developer Mode (README.md, "Development on Windows")`, {
          cause: error,
        })
      }
    }
    link(join(tree, 'test', 'other'), join(tree, 'test', 'unit', 'linked'))
    link(join(tree, 'test', 'other', 'x.test.ts'), join(tree, 'test', 'unit', 'link.test.ts'))
    for (const element of ['test/unit/linked/x.test.ts', 'test/unit/link.test.ts']) {
      const result = check(element, tree)
      expect(result.status, element).toBe(1)
      expect(result.stderr).toMatch(/is not a file found under/)
    }
  })

  it('accepts every test file of this repository, but for the names with a forbidden word', () => {
    // A red test here means a new test file cannot be named in the workflow: its name has a
    // character the check refuses, or it is the start of another test file's name.
    const all = ['test/unit', 'test/contract'].flatMap((folder) =>
      readdirSync(join(REPO, folder), { recursive: true, encoding: 'utf8' })
        .map((name) => `${folder}/${name.split('\\').join('/')}`)
        .filter((name) => /\.test\.tsx?$/.test(name) && !/e2e|packaged|acceptance/i.test(name)),
    )
    expect(all.length).toBeGreaterThan(100)
    for (let at = 0; at < all.length; at += 12) {
      const result = check(all.slice(at, at + 12).join(' '))
      expect(result.status, result.stderr).toBe(0)
    }
    // One run of the script per 12 files: about twenty processes, too many for the 15 s of a contract test.
  }, 120_000)

  it('names files as vitest takes them: vitest lists exactly the accepted files, and runs none here', () => {
    const accepted = check(TWO.join(', '))
    expect(accepted.status, accepted.stderr).toBe(0)
    const files = accepted.output.trim().replace(/^files=/, '').split(' ')
    // `vitest list --filesOnly` answers which files the arguments select, without running a test.
    // The same Node as `pnpm test`: this process is Electron's Node, and so is its child.
    const listed = spawnSync(process.execPath, [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'list', '--filesOnly', ...files], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(listed.status, `${listed.stdout}\n${listed.stderr}`).toBe(0)
    // One line per file: "[project] path", with the separators of the system.
    const names = listed.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.trim().replace(/^\[[^\]]+\]\s+/, '').split('\\').join('/'))
    expect(names.sort()).toEqual([...TWO].sort())
  }, 120_000)
})
