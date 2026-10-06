// The slash menu's commands in main (src/main/agent/commands.ts, ticket 20): supportedCommands() of
// the live query first, then system/commands_changed, then the bare names of system/init.
import { describe, expect, it, vi } from 'vitest'
import { CommandCatalog } from '../../src/main/agent/commands'

const init = (slashCommands: unknown, skills: unknown = []) => ({ type: 'system', subtype: 'init', slash_commands: slashCommands, skills })

describe('CommandCatalog', () => {
  it('without a query and before any message lists nothing', async () => {
    expect(await new CommandCatalog().list(null)).toEqual([])
  })

  it('lists the names of system/init without descriptions, skills marked, slashes dropped', async () => {
    const catalog = new CommandCatalog()
    catalog.observe(init(['ship-ticket', '/compact', '', 3], ['ship-ticket']))
    expect(await catalog.list(null)).toEqual([
      { name: 'ship-ticket', description: '', argumentHint: '', kind: 'skill' },
      { name: 'compact', description: '', argumentHint: '', kind: 'command' },
    ])
  })

  it('takes supportedCommands() over the names, and adds names it lacks', async () => {
    const catalog = new CommandCatalog()
    catalog.observe(init(['ship-ticket', 'qmd'], ['ship-ticket', 'qmd']))
    const query = { supportedCommands: vi.fn(() => Promise.resolve([{ name: 'ship-ticket', description: 'Carry a ticket', argumentHint: '<NN>', extra: 1 }, { name: 'help' }])) }
    expect(await catalog.list(query)).toEqual([
      { name: 'ship-ticket', description: 'Carry a ticket', argumentHint: '<NN>', kind: 'skill' },
      { name: 'help', description: '', argumentHint: '', kind: 'command' },
      { name: 'qmd', description: '', argumentHint: '', kind: 'skill' },
    ])
  })

  it('falls back to the last system/commands_changed when supportedCommands() fails or is missing', async () => {
    const catalog = new CommandCatalog()
    catalog.observe({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'retro', description: 'Record a lesson', argumentHint: '' }, { nope: true }] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = { supportedCommands: () => Promise.reject(new Error('gone')) }
    expect(await catalog.list(failing)).toEqual([{ name: 'retro', description: 'Record a lesson', argumentHint: '', kind: 'command' }])
    expect(await catalog.list({})).toEqual([{ name: 'retro', description: 'Record a lesson', argumentHint: '', kind: 'command' }])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('a later system/init replaces the names of the earlier one; other messages change nothing', async () => {
    const catalog = new CommandCatalog()
    catalog.observe(init(['a']))
    catalog.observe(init(['b']))
    catalog.observe({ type: 'assistant', slash_commands: ['c'] })
    catalog.observe(null)
    expect((await catalog.list(null)).map((each) => each.name)).toEqual(['b'])
  })
})

// Claude Code names one command two ways (ticket 25 of worfy-daily): system/init and `skills` carry
// the command's own name (`anthropic-skills:docs`, `mcp__github__AssignCodingAgent`), while
// supportedCommands() carries the name its menu shows (`docs` with the own name among `aliases`,
// `github:AssignCodingAgent (MCP)`). One command is one row.
describe('CommandCatalog with the two spellings of a name', () => {
  const supported = [
    { name: 'compact', description: 'Clear the history but keep a summary', argumentHint: '' },
    { name: 'ship-ticket', description: 'Carry a ticket', argumentHint: '<NN>' },
    { name: 'docs', description: 'Write a document', argumentHint: '', aliases: ['anthropic-skills:docs'] },
    { name: 'github:AssignCodingAgent (MCP)', description: 'Assign the coding agent', argumentHint: '<issue>' },
    { name: 'my.server:summarize (MCP)', description: 'Summarize', argumentHint: '' },
  ]
  const initMessage = init(
    ['compact', 'ship-ticket', 'anthropic-skills:docs', 'mcp__github__AssignCodingAgent', 'mcp__my_server__summarize', 'local-only'],
    ['ship-ticket', 'anthropic-skills:docs'],
  )

  it('lists a plugin skill and an MCP prompt once each, with the description and the right kind', async () => {
    const catalog = new CommandCatalog()
    catalog.observe(initMessage)
    expect(await catalog.list({ supportedCommands: () => Promise.resolve(supported) })).toEqual([
      { name: 'compact', description: 'Clear the history but keep a summary', argumentHint: '', kind: 'command' },
      { name: 'ship-ticket', description: 'Carry a ticket', argumentHint: '<NN>', kind: 'skill' },
      { name: 'anthropic-skills:docs', description: 'Write a document', argumentHint: '', kind: 'skill' },
      { name: 'mcp__github__AssignCodingAgent', description: 'Assign the coding agent', argumentHint: '<issue>', kind: 'command' },
      { name: 'mcp__my_server__summarize', description: 'Summarize', argumentHint: '', kind: 'command' },
      { name: 'local-only', description: '', argumentHint: '', kind: 'command' },
    ])
  })

  it('reads the same spellings from system/commands_changed', async () => {
    const catalog = new CommandCatalog()
    catalog.observe(initMessage)
    catalog.observe({ type: 'system', subtype: 'commands_changed', commands: supported })
    const names = (await catalog.list(null)).map((each) => each.name)
    expect(names).toEqual(['compact', 'ship-ticket', 'anthropic-skills:docs', 'mcp__github__AssignCodingAgent', 'mcp__my_server__summarize', 'local-only'])
  })

  it('before system/init gives an MCP prompt the name without a space, so the field can hold it', async () => {
    const catalog = new CommandCatalog()
    const listed = await catalog.list({ supportedCommands: () => Promise.resolve(supported) })
    expect(listed.map((each) => each.name)).toEqual(['compact', 'ship-ticket', 'docs', 'mcp__github__AssignCodingAgent', 'mcp__my_server__summarize'])
  })

  it('a row named like another command does not take that command by an alias', async () => {
    const catalog = new CommandCatalog()
    catalog.observe(init(['usage', 'cost', 'docs', 'anthropic-skills:docs']))
    const rows = [
      { name: 'usage', description: 'Show usage', argumentHint: '', aliases: ['cost'] },
      { name: 'cost', description: 'Show the cost', argumentHint: '' },
      { name: 'docs', description: 'My docs', argumentHint: '' },
      { name: 'docs', description: 'Plugin docs', argumentHint: '', aliases: ['anthropic-skills:docs'] },
    ]
    expect(await catalog.list({ supportedCommands: () => Promise.resolve(rows) })).toEqual([
      { name: 'usage', description: 'Show usage', argumentHint: '', kind: 'command' },
      { name: 'cost', description: 'Show the cost', argumentHint: '', kind: 'command' },
      { name: 'docs', description: 'My docs', argumentHint: '', kind: 'command' },
      { name: 'anthropic-skills:docs', description: 'Plugin docs', argumentHint: '', kind: 'command' },
    ])
  })
})
