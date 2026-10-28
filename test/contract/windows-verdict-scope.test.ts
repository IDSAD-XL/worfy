// scripts/windows-verdict-scope.mjs (worfy-windows ticket 66): which machine gives the Windows
// verdict of a platform pull request. `runner` (exit 0) — a green run of the mode full of the
// "Windows tests" workflow; `pc` and the matching files (exit 1) — gate full on the owner's PC.
// Each test builds branches in a temporary git repository and runs the script there, as the
// orchestrator does with the base and the head of a pull request.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'windows-verdict-scope.mjs')
const SETTINGS = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0']

let scratch = ''
let repo = ''
let branches = 0
let emptyConfig = ''

/**
 * The environment of every git this file starts, the script's own git included: no system and no
 * user configuration (an empty file stands for the global one), and no inherited GIT_* variable —
 * a GIT_DIR or GIT_INDEX_FILE of the run around the tests would point git at another repository.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig }
}

function git(...args: string[]): string {
  const result = spawnSync('git', [...SETTINGS, ...args], { cwd: repo, encoding: 'utf8', env: gitEnv() })
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
  const result = spawnSync(scriptNode(), [SCRIPT, ...args], { cwd: repo, encoding: 'utf8', env: gitEnv() })
  return { status: result.status, lines: result.stdout.split('\n').filter((line) => line !== ''), stderr: result.stderr }
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worfy-verdict-scope-'))
  emptyConfig = join(scratch, 'empty-gitconfig')
  writeFileSync(emptyConfig, '')
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

  /**
   * Every entry of PC_ONLY with a file of this repository it matches, nested where the pattern
   * reaches into subfolders. A missing, extra or narrowed entry turns a test below red.
   */
  const ENTRIES: [pattern: string, file: string][] = [
    ['src/main/terminal/**', 'src/main/terminal/zsh/rc.d/10-assist.zsh'],
    ['src/main/terminal-ai/**', 'src/main/terminal-ai/features/suggest.ts'],
    ['src/main/ipc/terminal*.ts', 'src/main/ipc/terminal-ai-fix.ts'],
    ['src/main/ipc/shell.ts', 'src/main/ipc/shell.ts'],
    ['src/shared/ipc/terminal*.ts', 'src/shared/ipc/terminal.ts'],
    ['src/shared/terminal/**', 'src/shared/terminal/cursor-answer.ts'],
    ['src/renderer/canvas/nodes/Terminal*', 'src/renderer/canvas/nodes/TerminalNode.css'],
    ['src/renderer/canvas/nodes/terminal-*', 'src/renderer/canvas/nodes/terminal-views.ts'],
    ['src/renderer/canvas/ReadOnlyTerminal.tsx', 'src/renderer/canvas/ReadOnlyTerminal.tsx'],
    ['test/**/terminal*', 'test/contract/terminal-harness.ts'],
    ['src/main/window.ts', 'src/main/window.ts'],
    ['src/main/window-frame.ts', 'src/main/window-frame.ts'],
    ['src/main/window-show.ts', 'src/main/window-show.ts'],
    ['src/shared/window/**', 'src/shared/window/bounds.ts'],
    ['src/main/quiet-windows.ts', 'src/main/quiet-windows.ts'],
    ['src/main/broadcast.ts', 'src/main/broadcast.ts'],
    ['src/main/settings/interface-scale.ts', 'src/main/settings/interface-scale.ts'],
    ['src/main/menu.ts', 'src/main/menu.ts'],
    ['src/main/ipc/menu.ts', 'src/main/ipc/menu.ts'],
    ['src/shared/ipc/menu.ts', 'src/shared/ipc/menu.ts'],
    ['src/main/notify.ts', 'src/main/notify.ts'],
    ['src/main/notify-pending.ts', 'src/main/notify-pending.ts'],
    ['src/main/ipc/notify.ts', 'src/main/ipc/notify.ts'],
    ['src/shared/ipc/notify.ts', 'src/shared/ipc/notify.ts'],
    ['src/main/dock-icon.ts', 'src/main/dock-icon.ts'],
    ['src/main/browser/**', 'src/main/browser/screencast.ts'],
    ['src/main/ipc/browser.ts', 'src/main/ipc/browser.ts'],
    ['src/renderer/browser/**', 'src/renderer/browser/BrowserProfiles.tsx'],
    ['src/shared/browser/**', 'src/shared/browser/partition.ts'],
    ['src/renderer/canvas/overlays/BrowserLayer.tsx', 'src/renderer/canvas/overlays/BrowserLayer.tsx'],
    ['src/renderer/canvas/overlays/browser-pages.ts', 'src/renderer/canvas/overlays/browser-pages.ts'],
    ['src/renderer/canvas/nodes/BrowserNode.tsx', 'src/renderer/canvas/nodes/BrowserNode.tsx'],
    ['src/renderer/canvas/nodes/BrowserNode.css', 'src/renderer/canvas/nodes/BrowserNode.css'],
    ['src/renderer/canvas/nodes/browser-frame.ts', 'src/renderer/canvas/nodes/browser-frame.ts'],
    ['src/shared/ipc/browser.ts', 'src/shared/ipc/browser.ts'],
    ['src/main/mcp/browser-server.ts', 'src/main/mcp/browser-server.ts'],
    ['test/e2e/**', 'test/e2e/browser-sleep.spec.ts'],
    ['test/acceptance/**', 'test/acceptance/fixtures/silent-repo/src/index.js'],
    ['playwright.config.ts', 'playwright.config.ts'],
    ['playwright.acceptance.config.ts', 'playwright.acceptance.config.ts'],
    ['electron-builder.yml', 'electron-builder.yml'],
    ['build/**', 'build/brand/icon.svg'],
    ['electron.vite.config.ts', 'electron.vite.config.ts'],
    ['scripts/build-version.ts', 'scripts/build-version.ts'],
    ['scripts/dev-bundle.ts', 'scripts/dev-bundle.ts'],
    ['package.json', 'package.json'],
    ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
    ['pnpm-workspace.yaml', 'pnpm-workspace.yaml'],
    ['scripts/install-stable.mjs', 'scripts/install-stable.mjs'],
    ['scripts/make-icons.mjs', 'scripts/make-icons.mjs'],
    ['scripts/ico.mjs', 'scripts/ico.mjs'],
    ['scripts/postinstall.mjs', 'scripts/postinstall.mjs'],
    ['test/windows-runner.ts', 'test/windows-runner.ts'],
  ]

  it.each([
    // ADR-0083, point 6: the pull request's own CI run, with the changed workflow, is its verdict.
    '.github/workflows/windows-tests.yml',
    '.github/workflows/ci.yml',
    // Run from a checkout of main, so the pull request does not decide its own verdict.
    'scripts/windows-verdict-scope.mjs',
    // The vitest setup: the runner and the PC run it alike.
    'scripts/vitest-electron.mjs',
    'vitest.config.ts',
    'test/setup-contract.ts',
    'test/setup-dom.ts',
  ])('prints runner, exit code 0, for a change of %s alone: the CI run of the pull request judges it', (path) => {
    const head = branch(() => put(path, `${path} changed\n`))
    expect(scope('main', head)).toEqual({ status: 0, lines: ['runner'], stderr: '' })
  })

  it('lists exactly the entries pinned here, in this order', () => {
    // The list as the script spells it: one quoted pattern per line of the PC_ONLY array.
    const text = readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n')
    const list = /^const PC_ONLY = \[\n([\s\S]*?)^\]$/m.exec(text)?.[1] ?? ''
    const patterns = [...list.matchAll(/^ {2}'([^']+)',$/gm)].map((match) => match[1])
    expect(patterns).toEqual(ENTRIES.map(([pattern]) => pattern))
  })

  it('matches a file of this repository with every entry: each file pinned above is tracked by git', () => {
    // Read-only: git ls-files in the repository root. An entry whose files are all gone matches
    // nothing and protects nothing.
    const listed = spawnSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z'], { cwd: REPO, encoding: 'utf8', env: gitEnv() })
    expect(listed.status, listed.stderr).toBe(0)
    const tracked = new Set(listed.stdout.split('\0'))
    for (const [pattern, file] of ENTRIES) expect(tracked.has(file), `${pattern}: ${file}`).toBe(true)
  })

  it.each(ENTRIES)('prints pc, exit code 1, and the path for the entry %s (%s)', (_pattern, path) => {
    const head = branch(() => {
      put('docs/notes.md')
      put(path, `${path} changed\n`)
    })
    expect(scope('main', head)).toEqual({ status: 1, lines: ['pc', path], stderr: '' })
  })

  it.each([
    ['a file right under the Terminal folder', 'src/main/terminal/windows-pty.ts'],
    ['a file right under the Terminal AI folder', 'src/main/terminal-ai/socket.ts'],
    ['a Terminal test deeper in test/', 'test/unit/nested/terminal-x.test.ts'],
    // `**/` is any number of folders, none too.
    ['a Terminal helper right under test/', 'test/terminal-helper.ts'],
    ['an e2e helper in a subfolder', 'test/e2e/helpers/launch.ts'],
    ['an icon right under build/', 'build/icon.ico'],
    ['a file nested in src/shared/window/', 'src/shared/window/deep/frame.ts'],
  ])('prints pc, exit code 1, and the path for %s', (_name, path) => {
    const head = branch(() => {
      put('docs/notes.md')
      put(path, `${path} changed\n`)
    })
    expect(scope('main', head)).toEqual({ status: 1, lines: ['pc', path], stderr: '' })
  })

  it('prints pc for a diff of the Browser layer alone: its pages live in windows of the app', () => {
    const head = branch(() => {
      put('src/main/browser/live.ts')
      put('src/main/ipc/browser.ts')
      put('src/renderer/browser/control.ts')
      put('src/shared/browser/tools.ts')
    })
    expect(scope('main', head)).toEqual({
      status: 1,
      lines: ['pc', 'src/main/browser/live.ts', 'src/main/ipc/browser.ts', 'src/renderer/browser/control.ts', 'src/shared/browser/tools.ts'],
      stderr: '',
    })
  })

  it('prints pc for a diff of the Browser layer overlay alone', () => {
    const head = branch(() => put('src/renderer/canvas/overlays/BrowserLayer.tsx'))
    expect(scope('main', head)).toEqual({ status: 1, lines: ['pc', 'src/renderer/canvas/overlays/BrowserLayer.tsx'], stderr: '' })
  })

  it('prints runner for the folder picker and the Browser section of the settings: not the Browser layer', () => {
    const head = branch(() => {
      put('src/renderer/projects/FolderBrowser.tsx')
      put('src/renderer/settings/BrowserSection.tsx')
    })
    expect(scope('main', head)).toEqual({ status: 0, lines: ['runner'], stderr: '' })
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
