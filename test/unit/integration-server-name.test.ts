// The name an Integration's server has in a Session (worfy-integrations ticket 06; spec, implementation decisions,
// the server name in a Session): the slug of its label — Latin letters, digits and `-`, at most 24 characters —
// unique in the Project, never a name of a Claude Code server from the MCP inventory's last answer and never
// under worfy's own prefix `worfy-`. A clash gets the suffix `-2` (then `-3`…) and a warning for the row.
// Claude Code drops a tool whose full name `mcp__<server>__<tool>` is longer than 128 characters without a word
// (the spike of ticket 01, 3.5): toolNameFits tells such a tool.
import { describe, expect, it } from 'vitest'
import { integrationServerNames, serverNameSlug, SERVER_NAME_MAX, TOOL_NAME_MAX, toolNameFits } from '../../src/main/integrations/proxy'

const one = (label: string, taken: readonly string[] = []) => integrationServerNames([{ id: 'aaaa1', label }], taken)[0]

describe('the slug of a label', () => {
  it('lowercase Latin letters, digits and -, one - for each run of anything else', () => {
    expect(serverNameSlug('Jira — client A')).toBe('jira-client-a')
    expect(serverNameSlug('  Linear (work) 2  ')).toBe('linear-work-2')
    expect(serverNameSlug('Café Notion')).toBe('cafe-notion')
    expect(serverNameSlug('my_server.v2')).toBe('my-server-v2')
  })

  it('a label with no Latin letter or digit is `integration`', () => {
    expect(serverNameSlug('Джира клиента')).toBe('integration')
    expect(serverNameSlug('— — —')).toBe('integration')
  })

  it('at most 24 characters, never ending in -', () => {
    expect(SERVER_NAME_MAX).toBe(24)
    const slug = serverNameSlug('Jira and Confluence — client with a long name')
    expect(slug.length).toBeLessThanOrEqual(24)
    expect(slug).toBe('jira-and-confluence-clie')
    expect(serverNameSlug('abcdefghijklmnopqrstuvw — x')).toBe('abcdefghijklmnopqrstuvw')
  })
})

describe('the names of a Project`s Integrations', () => {
  it('each gets its slug and no warning when nothing clashes', () => {
    expect(integrationServerNames([{ id: 'aaaa1', label: 'Jira — client A' }, { id: 'aaaa2', label: 'Jira — client B' }], [])).toEqual([
      { id: 'aaaa1', name: 'jira-client-a', warning: null },
      { id: 'aaaa2', name: 'jira-client-b', warning: null },
    ])
  })

  it('two labels with one slug in a Project: the second gets -2, the third -3, each with a warning', () => {
    const names = integrationServerNames(
      [
        { id: 'aaaa1', label: 'Jira: A' },
        { id: 'aaaa2', label: 'Jira (A)' },
        { id: 'aaaa3', label: 'jira a' },
      ],
      [],
    )
    expect(names.map((each) => each.name)).toEqual(['jira-a', 'jira-a-2', 'jira-a-3'])
    expect(names[0]?.warning).toBeNull()
    expect(names[1]?.warning).toMatch(/jira-a.*jira-a-2/u)
    expect(names[2]?.warning).toMatch(/jira-a.*jira-a-3/u)
  })

  it('a name of a Claude Code server from the inventory gets -2 and a warning, compared without case', () => {
    const named = one('Linear', ['example-notes', 'Linear'])
    expect(named).toEqual({ id: 'aaaa1', name: 'linear-2', warning: expect.stringMatching(/Claude Code/u) as unknown })
  })

  it('a slug under worfy`s own prefix gets -2 and a warning: worfy-canvas is never shadowed', () => {
    expect(one('worfy canvas')).toEqual({ id: 'aaaa1', name: 'worfy-canvas-2', warning: expect.stringMatching(/worfy-/u) as unknown })
    expect(one('Worfy tools')?.name).toBe('worfy-tools-2')
  })

  it('the suffix keeps the name within 24 characters', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz'
    const names = integrationServerNames(
      [
        { id: 'aaaa1', label: long },
        { id: 'aaaa2', label: long },
      ],
      [],
    )
    expect(names[0]?.name).toBe('abcdefghijklmnopqrstuvwx')
    expect(names[1]?.name).toBe('abcdefghijklmnopqrstuv-2')
    for (const each of names) expect(each.name.length).toBeLessThanOrEqual(SERVER_NAME_MAX)
  })

  it('a taken suffixed name moves on to the next number', () => {
    expect(one('Linear', ['linear', 'linear-2'])?.name).toBe('linear-3')
  })
})

describe('the full name of a tool', () => {
  it('fits when mcp__<server>__<tool> is at most 128 characters', () => {
    expect(TOOL_NAME_MAX).toBe(128)
    const server = 'a'.repeat(24)
    const longest = 'b'.repeat(128 - 'mcp__'.length - 24 - '__'.length)
    expect(toolNameFits(server, longest)).toBe(true)
    expect(toolNameFits(server, `${longest}c`)).toBe(false)
  })
})
