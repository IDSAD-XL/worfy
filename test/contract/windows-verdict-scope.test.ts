// scripts/windows-verdict-scope.mjs (worfy-windows ticket 66): which machine gives the Windows
// verdict of a platform pull request. `runner` (exit 0) — a green run of the mode full of the
// "Windows tests" workflow; `pc` and the matching files (exit 1) — gate full on the owner's PC.
// Each test builds branches in a temporary git repository and runs the script there, as the
// orchestrator does with the base and the head of a pull request.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'windows-verdict-scope.mjs')
const SETTINGS = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0']

let scratch = ''
let repo = ''
let branches = 0

function git(...args: string[]): string {
  const result = spawnSync('git', [...SETTINGS, ...args], { cwd: repo, encoding: 'utf8' })
  expect(result.status, `git ${args.join(' ')}: ${result.stderr}`).toBe(0)
  return result.stdout
}

function put(path: string, text = `${path}\n`): void {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
}

/** git mv into a folder that may not exist yet. */
function move(from: string, to: string): void {
  mkdirSync(join(repo, to, '..'), { recursive: true })
  git('mv', from, to)
}

/** A new branch from main with one commit made by `change`; returns its name. */
function branch(change: () => void): string {
  const name = `topic-${++branches}`
  git('checkout', '-q', '-b', name, 'main')
  change()
  git('add', '-A')
  git('commit', '-q', '--allow-empty', '-m', name)
  git('checkout', '-q', 'main')
  return name
}

const scope = (...args: string[]) => {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' })
  return { status: result.status, lines: result.stdout.split('\n').filter((line) => line !== ''), stderr: result.stderr }
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worfy-verdict-scope-'))
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  git('init', '-q')
  for (const path of ['README.md', 'docs/adr/0001-x.md', 'harness/bin/ticket', 'src/main/terminal/pty.ts', 'src/main/menu.ts', 'src/main/agent/env.ts', 'package.json']) put(path)
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
})

afterAll(() => {
  removeTestTree(scratch)
})

describe('scripts/windows-verdict-scope.mjs', () => {
  it('prints runner, exit code 0, for a diff of documents, Harness files and code the runner checks', () => {
    const head = branch(() => {
      put('docs/adr/0002-y.md')
      put('README.md', 'changed\n')
      put('harness/bin/ticket', 'changed\n')
      put('src/main/agent/env.ts', 'changed\n')
      // Names close to the listed ones, but not on the list.
      put('src/main/terminals.ts')
      put('src/main/window-state.ts')
      put('src/renderer/canvas/nodes/SessionNode.tsx')
      put('test/unit/e2e-gh-stub.test.ts')
      put('test/unit/shell-resolve.test.ts')
    })
    expect(scope('main', head)).toEqual({ status: 0, lines: ['runner'], stderr: '' })
  })

  it('prints runner for an empty diff', () => {
    const head = branch(() => {})
    expect(scope('main', head)).toEqual({ status: 0, lines: ['runner'], stderr: '' })
  })

  it.each([
    ['the Terminal', 'src/main/terminal/windows-pty.ts'],
    ['the Terminal AI', 'src/main/terminal-ai/socket.ts'],
    ['the Terminal IPC', 'src/main/ipc/terminal-ai.ts'],
    ['the shell IPC', 'src/main/ipc/shell.ts'],
    ['the Terminal node', 'src/renderer/canvas/nodes/TerminalNode.tsx'],
    ['a Terminal module of the renderer', 'src/renderer/canvas/nodes/terminal-replay.ts'],
    ['a Terminal test in a folder of test/', 'test/contract/terminal-windows.test.ts'],
    ['a Terminal test deeper in test/', 'test/unit/nested/terminal-x.test.ts'],
    // `**/` is any number of folders, none too.
    ['a Terminal helper right under test/', 'test/terminal-helper.ts'],
    ['the window', 'src/main/window.ts'],
    ['the window frame', 'src/main/window-frame.ts'],
    ['the menu', 'src/main/menu.ts'],
    ['the notifications', 'src/main/notify.ts'],
    ['the Dock icon', 'src/main/dock-icon.ts'],
    ['an e2e spec', 'test/e2e/terminal.spec.ts'],
    ['an e2e helper in a subfolder', 'test/e2e/helpers/launch.ts'],
    ['the acceptance test', 'test/acceptance/e3.spec.ts'],
    ['the Playwright config', 'playwright.config.ts'],
    ['the packaging config', 'electron-builder.yml'],
    ['an icon', 'build/icon.ico'],
    ['the manifest', 'package.json'],
    ['the lockfile', 'pnpm-lock.yaml'],
    ['the install script', 'scripts/postinstall.mjs'],
    ['the workflow of the run', '.github/workflows/windows-tests.yml'],
    ['the script itself', 'scripts/windows-verdict-scope.mjs'],
    ['the vitest config', 'vitest.config.ts'],
  ])('prints pc, exit code 1, and the path for %s', (_name, path) => {
    const head = branch(() => {
      put('docs/notes.md')
      put(path, `${path} changed\n`)
    })
    expect(scope('main', head)).toEqual({ status: 1, lines: ['pc', path], stderr: '' })
  })

  it('names every matching file once, in the order of git, and no other', () => {
    const head = branch(() => {
      put('test/e2e/b.spec.ts')
      put('README.md', 'changed again\n')
      put('src/main/menu.ts', 'changed\n')
      put('test/e2e/a b.spec.ts')
    })
    expect(scope('main', head)).toEqual({ status: 1, lines: ['pc', 'src/main/menu.ts', 'test/e2e/a b.spec.ts', 'test/e2e/b.spec.ts'], stderr: '' })
  })

  it('sees both sides of a rename: a listed file moved out of the list is pc', () => {
    const head = branch(() => move('src/main/terminal/pty.ts', 'src/main/process/pty.ts'))
    // Without --no-renames git would list only the new name, which is not on the list.
    expect(git('diff', '--name-status', '-M', `main...${head}`).trim()).toMatch(/^R100\tsrc\/main\/terminal\/pty\.ts\tsrc\/main\/process\/pty\.ts$/)
    expect(scope('main', head)).toEqual({ status: 1, lines: ['pc', 'src/main/terminal/pty.ts'], stderr: '' })
  })

  it('sees both sides of a rename: a file moved into a listed path is pc', () => {
    const head = branch(() => move('src/main/agent/env.ts', 'src/main/terminal/env.ts'))
    expect(scope('main', head)).toEqual({ status: 1, lines: ['pc', 'src/main/terminal/env.ts'], stderr: '' })
  })

  it('takes the changes of the head since it left the base: a later change on the base does not count', () => {
    const head = branch(() => put('docs/later.md'))
    git('checkout', '-q', '-b', 'moved-base', 'main')
    put('src/main/window.ts')
    git('add', '-A')
    git('commit', '-q', '-m', 'the base moves on')
    git('checkout', '-q', 'main')
    expect(scope('moved-base', head)).toEqual({ status: 0, lines: ['runner'], stderr: '' })
  })

  it.each([
    ['no arguments', []],
    ['one argument', ['main']],
    ['three arguments', ['main', 'main', 'main']],
    ['an option in place of a ref', ['--output=x', 'main']],
    ['an empty ref', ['', 'main']],
  ])('gives no verdict, exit code 2, for %s', (_name, args) => {
    const result = scope(...args)
    expect(result.status).toBe(2)
    expect(result.lines).toEqual([])
    expect(result.stderr).toMatch(/usage: node scripts\/windows-verdict-scope\.mjs <base> <head>/)
  })

  it('gives no verdict, exit code 2, when git cannot compute the diff', () => {
    const result = scope('main', 'no-such-branch')
    expect(result.status).toBe(2)
    expect(result.lines).toEqual([])
    expect(result.stderr).toMatch(/git diff main\.\.\.no-such-branch failed/)
  })
})
