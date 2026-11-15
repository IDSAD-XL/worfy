// What the inventory reads from the Project's record in the user's .claude.json, now that it runs outside the
// Project (worfy-mcp-live ticket 14; src/main/vendors/claude/project-mcp.ts): the key Claude Code files that record
// under (claudeConfigKey: its `Axe`, `lr`, `cr` and `E8`), and the record's servers. Only temp folders: the record is
// read from the HOME or CLAUDE_CONFIG_DIR the test gives, never from the real one.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeConfigKey, projectLocalMcp, type KeyDisk } from '../../src/main/vendors/claude/project-mcp'
import { removeTestTree } from '../remove'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) removeTestTree(dir)
})

function temp(): string {
  // The long form on Windows too (no RUNNER~1), as git writes it into a worktree's files.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-project-mcp-')))
  made.push(dir)
  return dir
}

const write = (file: string, value: unknown): void => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
}

/** A folder as Claude Code writes it as a key: forward slashes on Windows. */
const asKey = (folder: string): string => (process.platform === 'win32' ? folder.replaceAll('\\', '/') : folder)

const git = (at: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: at, stdio: 'pipe' })
}

/** A disk of Windows paths in memory: `files` by path, and the folders that exist. */
function windowsDisk(files: Record<string, string>, folders: string[]): KeyDisk {
  const known = new Set([...Object.keys(files), ...folders].map((path) => path.toLowerCase()))
  return { exists: (path) => known.has(path.toLowerCase()), read: (path) => files[path] ?? null, real: (path) => path }
}

describe('claudeConfigKey on Windows', () => {
  it('is the folder with forward slashes outside git', () => {
    expect(claudeConfigKey('D:\\work\\proj\\', 'win32', windowsDisk({}, []))).toBe('D:/work/proj')
  })

  it('is the git root with forward slashes, from a folder inside it', () => {
    expect(claudeConfigKey('D:\\work\\proj\\src\\a', 'win32', windowsDisk({}, ['D:\\work\\proj\\.git']))).toBe('D:/work/proj')
  })

  it('is the main checkout for a linked worktree', () => {
    const disk = windowsDisk(
      {
        'D:\\work\\proj\\.claude\\worktrees\\w\\.git': 'gitdir: D:/work/proj/.git/worktrees/w\n',
        'D:\\work\\proj\\.git\\worktrees\\w\\commondir': '../..\n',
        'D:\\work\\proj\\.git\\worktrees\\w\\gitdir': 'D:/work/proj/.claude/worktrees/w/.git\n',
      },
      ['D:\\work\\proj\\.git'],
    )
    expect(claudeConfigKey('D:\\work\\proj\\.claude\\worktrees\\w', 'win32', disk)).toBe('D:/work/proj')
  })
})

describe('claudeConfigKey over real git', () => {
  it('is the main checkout for a worktree, and the inner repository for a nested one', () => {
    const home = temp()
    const root = join(home, 'project')
    mkdirSync(root)
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'first')
    const worktree = join(root, '.claude', 'worktrees', 'w')
    git(root, 'worktree', 'add', '-q', worktree)
    const inner = join(root, 'vendor', 'inner')
    mkdirSync(join(inner, 'src'), { recursive: true })
    git(inner, 'init', '-q', '-b', 'main')
    expect(claudeConfigKey(join(root, 'src'))).toBe(asKey(root))
    expect(claudeConfigKey(worktree)).toBe(asKey(root))
    expect(claudeConfigKey(join(inner, 'src'))).toBe(asKey(inner))
  })

  it('is the bare repository’s folder for a worktree of it, `repo/.bare` and `repo.git` alike', () => {
    const home = temp()
    const source = join(home, 'source')
    mkdirSync(source)
    git(source, 'init', '-q', '-b', 'main')
    git(source, 'commit', '-q', '--allow-empty', '-m', 'first')
    for (const bare of [join(home, 'repo', '.bare'), join(home, 'other.git')]) {
      git(home, 'clone', '-q', '--bare', source, bare)
      const worktree = join(bare, '..', `${bare.endsWith('.git') ? 'other' : 'repo'}-main`)
      git(bare, 'worktree', 'add', '-q', worktree, 'main')
      expect(claudeConfigKey(worktree)).toBe(asKey(bare))
    }
  })
})

describe('projectLocalMcp', () => {
  it('reads the record of the main checkout for a Session in a worktree', () => {
    const home = temp()
    const root = join(home, 'project')
    mkdirSync(root)
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'first')
    const worktree = join(root, '.claude', 'worktrees', 'w')
    git(root, 'worktree', 'add', '-q', worktree)
    write(join(home, '.claude.json'), { projects: { [asKey(root)]: { mcpServers: { tracker: { command: 'tracker' } } }, [asKey(worktree)]: { mcpServers: { other: { command: 'x' } } } } })
    expect(projectLocalMcp(worktree, { HOME: home })).toEqual({ servers: { tracker: { command: 'tracker' } }, disabled: [] })
  })

  it('keeps a server as written, leaves out a turned-off one and a shape Claude Code refuses, and names the turned-off ones', () => {
    const home = temp()
    const config = join(home, 'config')
    const folder = join(home, 'project')
    mkdirSync(folder, { recursive: true })
    // unscaled: a field of a server's configuration handed through as written, not a limit of the test
    const remote = { type: 'http', url: 'https://${HOST}/mcp', headersHelper: 'helper', oauth: { clientId: 'c' }, timeout: 1000 }
    write(join(config, '.claude.json'), {
      projects: {
        [asKey(folder)]: {
          mcpServers: { remote, socket: { type: 'ws', url: 'ws://localhost:1' }, off: { command: 'off' }, bad: { command: 3 }, ide: { type: 'sse-ide', url: 'x' } },
          disabledMcpServers: ['off', 'from-mcp-json', 7],
        },
      },
    })
    expect(projectLocalMcp(folder, { HOME: home, CLAUDE_CONFIG_DIR: config })).toEqual({
      servers: { remote, socket: { type: 'ws', url: 'ws://localhost:1' } },
      disabled: ['off', 'from-mcp-json'],
    })
  })

  it('gives nothing without a record, or without .claude.json', () => {
    const home = temp()
    expect(projectLocalMcp(join(home, 'none'), { HOME: home })).toEqual({ servers: {}, disabled: [] })
    write(join(home, '.claude.json'), { projects: { '/elsewhere': { mcpServers: { x: { command: 'x' } } } } })
    expect(projectLocalMcp(join(home, 'none'), { HOME: home })).toEqual({ servers: {}, disabled: [] })
  })
})
