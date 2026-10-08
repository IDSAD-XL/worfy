// The access mark of every IPC channel (worfy-link ticket 08): whether a Linked machine may call it.
// `link` is open always, `project` while "Linked machines can work with my Projects" is on,
// `desktop` and `local` never. The mark is a required argument of invokeChannel/eventChannel, so a
// channel without one fails `pnpm typecheck`; this test catches the rest — a mark slipped past the
// type with `as`, or a value outside the four.
import { describe, expect, it } from 'vitest'
import { CHANNEL_ACCESS, type ChannelAccess } from '../../src/shared/ipc/channels'

interface FoundChannel {
  file: string
  name: string
  kind: 'invoke' | 'event'
  access: unknown
}

/** Every channel object a module exports: anything with `kind` invoke/event and a string `name`. */
function channelsOf(modules: Record<string, Record<string, unknown>>): FoundChannel[] {
  const found: FoundChannel[] = []
  for (const [file, exports] of Object.entries(modules)) {
    for (const value of Object.values(exports)) {
      if (typeof value !== 'object' || value === null) continue
      const candidate = value as { kind?: unknown; name?: unknown; access?: unknown }
      if ((candidate.kind !== 'invoke' && candidate.kind !== 'event') || typeof candidate.name !== 'string') continue
      found.push({ file, name: candidate.name, kind: candidate.kind, access: candidate.access })
    }
  }
  return found
}

/** The channels whose mark is missing or not one of the four, as "<name> (<file>): <mark>". */
function unmarked(channels: readonly FoundChannel[]): string[] {
  return channels
    .filter((channel) => !(CHANNEL_ACCESS as readonly unknown[]).includes(channel.access))
    .map((channel) => `${channel.name} (${channel.file}): ${JSON.stringify(channel.access) ?? 'no mark'}`)
}

const domains = import.meta.glob<Record<string, unknown>>('../../src/shared/ipc/*.ts', { eager: true })
const sample = import.meta.glob<Record<string, unknown>>('../contract/ipc-sample/shared/*.ts', { eager: true })
const channels = channelsOf(domains)
const accessOf = new Map(channels.map((channel) => [channel.name, channel.access]))

describe('the access mark of IPC channels', () => {
  it('finds the channels of every domain file', () => {
    // A guard for the test itself: an empty glob would pass the check below.
    expect(Object.keys(domains).length).toBeGreaterThanOrEqual(20)
    expect(channels.length).toBeGreaterThanOrEqual(100)
    expect(accessOf.has('link.ping')).toBe(true)
  })

  it('every channel of src/shared/ipc/*.ts carries one of link, project, desktop, local', () => {
    expect(unmarked(channels)).toEqual([])
  })

  it('the sample channel domain is marked too', () => {
    const found = channelsOf(sample)
    expect(found.length).toBeGreaterThan(0)
    expect(unmarked(found)).toEqual([])
  })

  it('the check fails on a channel without a mark, or with a mark slipped past the type, and names it', () => {
    const forged = { kind: 'invoke', name: 'sample.forged', input: {}, output: {} }
    const wrong = { kind: 'event', name: 'sample.wrong', payload: {}, access: 'everyone' }
    expect(unmarked(channelsOf({ 'forged.ts': { forged, wrong } }))).toEqual(['sample.forged (forged.ts): no mark', 'sample.wrong (forged.ts): "everyone"'])
  })

  it('a channel name is declared once', () => {
    const names = channels.map((channel) => channel.name)
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
  })
})

describe('the initial marks', () => {
  const marked = (access: ChannelAccess): string[] =>
    channels
      .filter((channel) => channel.access === access)
      .map((channel) => channel.name)
      .sort()

  it('link: link.ping alone', () => {
    expect(marked('link')).toEqual(['link.ping'])
  })

  it('desktop: the actions that need the desktop of the Project machine (a dialog, the OS shell)', () => {
    expect(marked('desktop')).toEqual(['agent.attachPick', 'cardApi.ask', 'projects.pickFolder', 'shell.openExternal', 'shell.openInEditor'])
  })

  it('local: the state of the screen machine, every other link channel, the Harness and the first run', () => {
    const local = marked('local')
    // viewport.* (worfy-link ticket 06): the Canvas camera of the screen's own machine.
    for (const name of ['projects.select', 'view.get', 'view.changed', 'notify.pending', 'notify.open', 'limits.open', 'limits.changed', 'app.version', 'viewport.get', 'viewport.set']) {
      expect(local, name).toContain(name)
    }
    // A Linked machine never switches access on, links or revokes machines for the owner.
    const linkChannels = channels.map((channel) => channel.name).filter((name) => name.startsWith('link.') && name !== 'link.ping')
    expect(linkChannels.length).toBeGreaterThan(0)
    for (const name of linkChannels) expect(local, name).toContain(name)
    for (const name of channels.map((channel) => channel.name).filter((name) => /^(harness|harnessMigration|firstRun)\./.test(name))) {
      expect(local, name).toContain(name)
    }
  })

  it('no channel of the shell domain, and no dialog, is open to a Linked machine', () => {
    for (const channel of channels) {
      if (channel.name.startsWith('shell.')) expect(channel.access, channel.name).toBe('desktop')
    }
  })

  it('project: the work with Projects, including what starts processes (Sessions, Terminal, Autopilot)', () => {
    const project = marked('project')
    for (const name of ['projects.list', 'layout.apply', 'layout.changed', 'agent.start', 'terminal.open', 'terminal.output', 'terminal.takeSize', 'terminal.started', 'autopilot.start', 'workflow.open', 'docs.open', 'claudeHome.sessions', 'bindings.get', 'cards.get', 'cardApi.dataGet', 'cardApi.dataSet', 'trash.put', 'projects.changed']) {
      expect(project, name).toContain(name)
    }
  })
})
