// The MCP servers of a Project's folder that the inventory hands to Claude Code, now that it runs outside the
// Project (worfy-mcp-live ticket 14; src/main/vendors/claude/project-mcp.ts). Only temp folders: the user's
// config is read from the HOME or CLAUDE_CONFIG_DIR the test gives, never from the real one.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { QueryHandle } from '../../src/main/agent/session'
import { projectMcpServers, withProjectScopes } from '../../src/main/vendors/claude/project-mcp'
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

describe('projectMcpServers', () => {
  it('reads .mcp.json from the folder up, the nearer file winning a name', async () => {
    const home = temp()
    const folder = join(home, 'work', 'project')
    write(join(home, 'work', '.mcp.json'), { mcpServers: { shared: { command: 'outer' }, outer: { command: 'outer' } } })
    write(join(folder, '.mcp.json'), { mcpServers: { shared: { command: 'inner' } } })
    const { servers, scopes } = await projectMcpServers(folder, { HOME: home })
    expect(servers).toEqual({ shared: { type: 'stdio', command: 'inner' }, outer: { type: 'stdio', command: 'outer' } })
    expect([...scopes]).toEqual([
      ['shared', 'project'],
      ['outer', 'project'],
    ])
  })

  it('leaves out a server rejected in any settings file, and one Claude Code would refuse', async () => {
    const home = temp()
    const folder = join(home, 'project')
    write(join(folder, '.mcp.json'), {
      mcpServers: { a: { command: 'a' }, b: { command: 'b' }, c: { command: 'c' }, d: { command: 'd' }, bad: { command: 3 }, ide: { type: 'sse-ide', url: 'x' } },
    })
    write(join(home, '.claude', 'settings.json'), { disabledMcpjsonServers: ['a'] })
    write(join(folder, '.claude', 'settings.json'), { disabledMcpjsonServers: ['b'] })
    write(join(folder, '.claude', 'settings.local.json'), { disabledMcpjsonServers: ['c'] })
    expect(Object.keys((await projectMcpServers(folder, { HOME: home })).servers)).toEqual(['d'])
  })

  it('takes the local servers of the folder from CLAUDE_CONFIG_DIR/.claude.json, over a project one, with ${VAR} expanded', async () => {
    const home = temp()
    const config = join(home, 'config')
    const folder = join(home, 'project')
    write(join(folder, '.mcp.json'), { mcpServers: { notes: { command: 'project' } } })
    write(join(config, '.claude.json'), {
      projects: { [folder]: { mcpServers: { notes: { type: 'http', url: 'https://${HOST}/mcp', headers: { token: '${TOKEN:-none}' } } } } },
    })
    const { servers, scopes } = await projectMcpServers(folder, { HOME: home, CLAUDE_CONFIG_DIR: config, HOST: 'notes.example.test' })
    expect(servers).toEqual({ notes: { type: 'http', url: 'https://notes.example.test/mcp', headers: { token: 'none' } } })
    expect(scopes.get('notes')).toBe('local')
  })

  it('gives nothing for a folder without config', async () => {
    const home = temp()
    expect(await projectMcpServers(join(home, 'none'), { HOME: home })).toEqual({ servers: {}, scopes: new Map() })
  })
})

describe('withProjectScopes', () => {
  it('gives a handed server its scope back, and leaves any other source alone', async () => {
    const handle = {
      close: () => undefined,
      mcpServerStatus: () =>
        Promise.resolve([
          { name: 'notes', status: 'connected', source: 'dynamic', scope: 'dynamic' },
          { name: 'tracker', status: 'connected', source: 'user', scope: 'user' },
          { name: 'other', status: 'connected', source: 'dynamic' },
        ]),
    } as unknown as QueryHandle
    const scoped = withProjectScopes(handle, new Map([
      ['notes', 'project'],
      ['tracker', 'local'],
    ]))
    expect(await scoped.mcpServerStatus!()).toEqual([
      { name: 'notes', status: 'connected', source: 'project', scope: 'project' },
      { name: 'tracker', status: 'connected', source: 'user', scope: 'user' },
      { name: 'other', status: 'connected', source: 'dynamic' },
    ])
  })
})
