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
