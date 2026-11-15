// What the inventory reads from the Project's record in the user's .claude.json, now that it runs outside the
// Project (worfy-mcp-live ticket 14; src/main/vendors/claude/project-mcp.ts). Only temp folders: the record is read
// from the HOME or CLAUDE_CONFIG_DIR the test gives, never from the real one; the repository root is given.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { QueryHandle } from '../../src/main/agent/session'
import { projectLocalMcp, withLocalScope } from '../../src/main/vendors/claude/project-mcp'
import { removeTestTree } from '../remove'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) removeTestTree(dir)
})

function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-project-mcp-')))
  made.push(dir)
  return dir
}

const write = (file: string, value: unknown): void => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

const noRepository = (): Promise<string | null> => Promise.resolve(null)

describe('projectLocalMcp', () => {
  it('reads the record of the main repository root, not of the folder asked from', async () => {
    const home = temp()
    const root = join(home, 'project')
    const worktree = join(root, '.claude', 'worktrees', 'w')
    mkdirSync(worktree, { recursive: true })
    write(join(home, '.claude.json'), { projects: { [root]: { mcpServers: { tracker: { command: 'tracker' } } }, [worktree]: { mcpServers: { other: { command: 'x' } } } } })
    expect(await projectLocalMcp(worktree, { HOME: home }, () => Promise.resolve(root))).toEqual({ servers: { tracker: { command: 'tracker' } }, disabled: [] })
  })

  it('keeps a server as written, leaves out a turned-off one and a shape Claude Code refuses, and names the turned-off ones', async () => {
    const home = temp()
    const config = join(home, 'config')
    const folder = join(home, 'project')
    mkdirSync(folder, { recursive: true })
    const remote = { type: 'http', url: 'https://${HOST}/mcp', headersHelper: 'helper', oauth: { clientId: 'c' }, timeout: 1000 }
    write(join(config, '.claude.json'), {
      projects: {
        [folder]: {
          mcpServers: { remote, socket: { type: 'ws', url: 'ws://localhost:1' }, off: { command: 'off' }, bad: { command: 3 }, ide: { type: 'sse-ide', url: 'x' } },
          disabledMcpServers: ['off', 'from-mcp-json', 7],
        },
      },
    })
    expect(await projectLocalMcp(folder, { HOME: home, CLAUDE_CONFIG_DIR: config }, noRepository)).toEqual({
      servers: { remote, socket: { type: 'ws', url: 'ws://localhost:1' } },
      disabled: ['off', 'from-mcp-json'],
    })
  })

  it('gives nothing without a record, or without .claude.json', async () => {
    const home = temp()
    expect(await projectLocalMcp(join(home, 'none'), { HOME: home }, noRepository)).toEqual({ servers: {}, disabled: [] })
    write(join(home, '.claude.json'), { projects: { '/elsewhere': { mcpServers: { x: { command: 'x' } } } } })
    expect(await projectLocalMcp(join(home, 'none'), { HOME: home }, noRepository)).toEqual({ servers: {}, disabled: [] })
  })
})

describe('withLocalScope', () => {
  it('gives a handed server its scope local back, and leaves any other source alone', async () => {
    const handle = {
      close: () => undefined,
      mcpServerStatus: () =>
        Promise.resolve([
          { name: 'tracker', status: 'connected', source: 'dynamic', scope: 'dynamic' },
          { name: 'notes', status: 'connected', source: 'project', scope: 'project' },
          { name: 'other', status: 'connected', source: 'dynamic' },
        ]),
    } as unknown as QueryHandle
    expect(await withLocalScope(handle, ['tracker', 'notes']).mcpServerStatus!()).toEqual([
      { name: 'tracker', status: 'connected', source: 'local', scope: 'local' },
      { name: 'notes', status: 'connected', source: 'project', scope: 'project' },
      { name: 'other', status: 'connected', source: 'dynamic' },
    ])
  })
})
