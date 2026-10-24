// The access mark of every IPC channel (worfy-link ticket 08): whether a Linked machine may call it.
// `link` is open always, `project` while "Linked machines can work with my Projects" is on,
// `desktop` and `local` never. The mark is a required argument of invokeChannel/eventChannel, so a
// channel without one fails `pnpm typecheck`; this test catches the rest — a mark slipped past the
// type with `as`, or a value outside the four.
import { describe, expect, it } from 'vitest'
import { CHANNEL_ACCESS, CHANNEL_USE, type ChannelAccess } from '../../src/shared/ipc/channels'

interface FoundChannel {
  file: string
  name: string
  kind: 'invoke' | 'event'
  access: unknown
  use: unknown
}

/** Every channel object a module exports: anything with `kind` invoke/event and a string `name`. */
function channelsOf(modules: Record<string, Record<string, unknown>>): FoundChannel[] {
  const found: FoundChannel[] = []
  for (const [file, exports] of Object.entries(modules)) {
    for (const value of Object.values(exports)) {
      if (typeof value !== 'object' || value === null) continue
      const candidate = value as { kind?: unknown; name?: unknown; access?: unknown; use?: unknown }
      if ((candidate.kind !== 'invoke' && candidate.kind !== 'event') || typeof candidate.name !== 'string') continue
      found.push({ file, name: candidate.name, kind: candidate.kind, access: candidate.access, use: candidate.use })
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
    // shell.openExternal is `local` since worfy-link ticket 12: a link opens on the screen's machine.
    expect(marked('desktop')).toEqual(['agent.attachPick', 'projects.pickFolder', 'shell.openInEditor'])
  })

  it('local: the state of the screen machine, every other link channel, the Harness and the first run', () => {
    const local = marked('local')
    // viewport.* (worfy-link ticket 06): the Canvas camera of the screen's own machine.
    for (const name of ['projects.select', 'view.get', 'view.changed', 'notify.pending', 'notify.open', 'limits.open', 'limits.changed', 'app.version', 'viewport.get', 'viewport.set', 'shell.openExternal']) {
      expect(local, name).toContain(name)
    }
    // A Browser's page is reached over CDP only on the Machine whose screen draws it (worfy-browser ticket 04, ADR-0078).
    expect(local).toContain('browser.page.live')
    expect(local).toContain('browser.pressing')
    // A Linked machine never switches access on, links or revokes machines for the owner.
    const linkChannels = channels.map((channel) => channel.name).filter((name) => name.startsWith('link.') && name !== 'link.ping')
    expect(linkChannels.length).toBeGreaterThan(0)
    for (const name of linkChannels) expect(local, name).toContain(name)
    for (const name of channels.map((channel) => channel.name).filter((name) => /^(harness|harnessMigration|firstRun)\./.test(name))) {
      expect(local, name).toContain(name)
    }
  })

  // worfy-link ticket 11: "Add project" on a Linked machine runs every step of the connection on
  // that Machine, so the steps are `project` — open to a Linked machine only while access is on, and
  // the narrowest mark that lets them go there. The gh sign-in types into a terminal of the Machine
  // whose screen shows it: it stays `local`, so a Linked machine never signs gh in on this one.
  const connectSteps = [
    'projects.connect.inspect',
    'projects.connect.draft',
    'projects.connect.stop',
    'projects.connect.check',
    'projects.connect.write',
    'projects.connect.activity',
    'projects.connect.accounts',
  ]
  const signIn = [
    'projects.connect.signIn',
    'projects.connect.signInInput',
    'projects.connect.signInResize',
    'projects.connect.signInClose',
    'projects.connect.signInOutput',
    'projects.connect.signInExit',
  ]

  it('connecting a Project (worfy-harness tickets 24, 25): the steps and the GitHub accounts are `project`, the gh sign-in `local` (worfy-link ticket 11)', () => {
    const connect = channels.map((channel) => channel.name).filter((name) => name.startsWith('projects.connect.'))
    // Named, so a channel that disappears, is renamed or is added without a decision fails here too.
    expect(connect.sort()).toEqual([...connectSteps, ...signIn].sort())
    const project = marked('project')
    for (const name of connectSteps) expect(project, name).toContain(name)
    const local = marked('local')
    for (const name of signIn) expect(local, name).toContain(name)
  })

  // worfy-pipeline ticket 08: only the Machine of a Project edits its Pipeline.
  // The write is `local`, closed to a Linked machine with full access too; the read is `project`,
  // `read`, so a Linked machine's window shows that Machine's Pipeline.
  it('the Pipeline editor: pipeline.write is `local`, pipeline.read is `project` and `read` (worfy-pipeline ticket 08)', () => {
    expect(marked('local')).toContain('pipeline.write')
    const read = channels.find((channel) => channel.name === 'pipeline.read')
    expect(read?.access).toBe('project')
    expect(read?.use).toBe('read')
  })

  it('projects.browse is `project`: the folders of a Linked machine, only while access is on (worfy-link ticket 11)', () => {
    expect(marked('project')).toContain('projects.browse')
  })

  it('no channel of the shell domain, and no dialog, is open to a Linked machine', () => {
    for (const channel of channels) {
      // `desktop` or `local` (shell.openExternal, worfy-link ticket 12): both are closed to a Linked machine.
      if (channel.name.startsWith('shell.')) expect(['desktop', 'local'], channel.name).toContain(channel.access)
    }
  })

  it('project: the work with Projects, including what starts processes (Sessions, Terminal, Autopilot)', () => {
    const project = marked('project')
    for (const name of ['projects.list', 'layout.apply', 'layout.changed', 'agent.start', 'terminal.open', 'terminal.output', 'terminal.takeSize', 'terminal.started', 'autopilot.start', 'workflow.open', 'docs.open', 'claudeHome.sessions', 'bindings.get', 'cards.get', 'cardApi.dataGet', 'cardApi.dataSet', 'trash.put', 'projects.changed']) {
      expect(project, name).toContain(name)
    }
  })
})

// worfy-link ticket 18 (ADR-0066): every `project` channel is marked `read` or `write`; a Linked
// machine with read-only access reaches the `read` ones only. The mark is a required argument of a
// `project` channel, so one without it fails `pnpm typecheck`. Both lists are named here: a new
// `project` channel, or one whose mark changed, fails this test until it is decided on here.
describe('the read-or-write mark of `project` channels', () => {
  /** Changes nothing, starts or stops nothing, sends nothing into a Session or a Terminal. */
  const READ_CALLS = [
    'actions.launches',
    'agent.commands',
    'agent.controls',
    'agent.list',
    'agent.models',
    'autopilot.state',
    'bindings.get',
    'bindings.signals',
    // The Browser profiles of a Project: a read-only screen shows a frame's profile name (worfy-browser ticket 03).
    'browser.profiles.list',
    // Who drives each Browser (worfy-browser ticket 04): a read-only screen shows «Claude is driving» too.
    'browser.control.list',
    'cardApi.dataGet',
    'cards.file',
    'cards.get',
    // Read-only git and gh: the owner counts them as reading (answer 3).
    'checks.get',
    'checks.repos',
    'claudeHome.close',
    'claudeHome.live',
    'claudeHome.search',
    'claudeHome.sessions',
    'claudeHome.subagentTranscript',
    'claudeHome.subagents',
    // Transcripts, Session events and notifications are reading (answer 2): they may show a secret.
    'claudeHome.transcript',
    // Find in the part of a transcript a view has not read yet (worfy-ui ticket 26): reading, as the transcript itself.
    'claudeHome.transcriptFind',
    'docs.close',
    // Opening the watcher of a Project's docs lets main sync the HANDOFF Node with the file, as it
    // does for its own active Project: the caller changes nothing.
    'docs.open',
    'docs.read',
    // Read-only gh, as checks.get: the cross-machine gate queue (worfy-windows ticket 17).
    'gateQueue.get',
    // The candidates of «Archive finished sessions now»: the registry and the transcripts are read;
    // the screen sends the archive itself through layout.apply (worfy-canvas ticket 08).
    'layout.archiveCandidates',
    'layout.get',
    // The batches of the archive timer a window missed while its page loaded: what layout.archived tells.
    'layout.recentBatches',
    'orchestrator.view',
    // Read-only git and gh, the marks files and the e2e lock, as checks.get; subscribing and leaving count as reading.
    'pipeline.close',
    'pipeline.get',
    // The Pipeline editor reads the Profile's Pipeline through bin/profile-set --read (worfy-pipeline ticket 08).
    'pipeline.read',
    'projects.list',
    'projects.settings.defaults',
    'projects.settings.get',
    'sessions.resumable',
    'sessions.views',
    'terminal.shells',
    'terminalAi.fix.state',
    'terminalAi.request.state',
    // The text of one Ticket file, for the focused Ticket (worfy-polish ticket 33), as docs.read.
    'tickets.read',
    'trash.list',
    'workflow.close',
    'workflow.open',
  ]
  const WRITE_CALLS = [
    // Sends the "Process gate queue" template into the Orchestrator, as Run wave (worfy-windows ticket 17).
    'actions.gateQueue',
    'actions.runWave',
    'actions.shipTicket',
    // Answers Claude Code's questions with answer options (worfy-ui ticket 17).
    'agent.answerQuestion',
    // Copies files to the Project machine's disk.
    'agent.attach',
    'agent.close',
    'agent.configure',
    'agent.interrupt',
    'agent.permission',
    'agent.queueRemove',
    'agent.queueSend',
    'agent.send',
    'agent.start',
    'autopilot.forceStop',
    'autopilot.start',
    'autopilot.stop',
    'bindings.remove',
    'bindings.set',
    // Only the user makes, changes and deletes a Browser profile; deleting one erases its logins.
    'browser.profiles.create',
    'browser.profiles.delete',
    'browser.profiles.update',
    // Taking a Browser over from a Session and giving it back change what a Session may do (worfy-browser ticket 04).
    'browser.control.hold',
    'browser.control.return',
    'browser.control.take',
    // What a read-only Linked machine may not see or touch of a Browser: only its frame with the
    // profile's name (worfy-browser ticket 07, ADR-0078 item 14) — no frames, no input, no address,
    // no lives, no picture of an Asleep page, no wake, no report of a screen.
    'browser.frames.watch',
    'browser.input',
    'browser.lives.list',
    'browser.navigate',
    'browser.picture',
    'browser.screen',
    'browser.wake',
    'cardApi.askFinish',
    'cardApi.askPrepare',
    'cardApi.dataSet',
    'layout.apply',
    // The Undo of the archive toast: main restores a batch (worfy-canvas ticket 10); a read-only screen has no Undo.
    'layout.restoreBatch',
    // Starts the Orchestrator Session when there is none.
    'orchestrator.open',
    'orchestrator.newConversation',
    'projects.add',
    // Reads the folders of the whole disk, outside every Project.
    'projects.browse',
    // The steps of "Add project": accounts and check start gh and the Harness script for a write.
    'projects.connect.accounts',
    'projects.connect.check',
    'projects.connect.draft',
    // Adds a folder already connected to the Project list.
    'projects.connect.inspect',
    'projects.connect.stop',
    'projects.connect.write',
    'projects.hold',
    'projects.remove',
    'projects.settings.set',
    'sessions.close',
    'sessions.new',
    'sessions.resume',
    'sessions.start',
    'terminal.close',
    'terminal.input',
    // Starts the shell when it does not run.
    'terminal.open',
    'terminal.resize',
    'terminal.takeSize',
    'terminalAi.fix.run',
    'terminalAi.request',
    'terminalAi.request.cancel',
    'trash.put',
    'trash.restore',
  ]
  /** Every event is reading but the output of a Terminal (answer 2), and the frames and lives of a Browser (worfy-browser ticket 07, ADR-0078 item 14). */
  const WRITE_EVENTS = ['browser.frame', 'browser.lives.changed', 'terminal.output']

  const project = channels.filter((channel) => channel.access === 'project')
  const named = (kind: 'invoke' | 'event', use: string): string[] =>
    project
      .filter((channel) => channel.kind === kind && channel.use === use)
      .map((channel) => channel.name)
      .sort()

  it('every `project` channel is marked read or write; no other channel carries the mark', () => {
    expect(project.length).toBeGreaterThanOrEqual(100)
    expect(project.filter((channel) => !(CHANNEL_USE as readonly unknown[]).includes(channel.use)).map((channel) => `${channel.name}: ${JSON.stringify(channel.use) ?? 'no mark'}`)).toEqual([])
    expect(channels.filter((channel) => channel.access !== 'project' && channel.use !== null).map((channel) => channel.name)).toEqual([])
  })

  it('a `project` channel named in neither list fails here, by name', () => {
    const decided = new Set([...READ_CALLS, ...WRITE_CALLS])
    expect(named('invoke', 'read').concat(named('invoke', 'write')).filter((name) => !decided.has(name))).toEqual([])
  })

  it('the `read` calls are exactly the ones named', () => {
    expect(named('invoke', 'read')).toEqual([...READ_CALLS].sort())
  })

  it('the `write` calls are exactly the ones named, including those whose names sound like reading', () => {
    expect(named('invoke', 'write')).toEqual([...WRITE_CALLS].sort())
  })

  it('every `project` event is `read` but Terminal output and a Browser\'s frames and lives', () => {
    expect(named('event', 'write')).toEqual(WRITE_EVENTS)
    expect(named('event', 'read').length).toBe(project.filter((channel) => channel.kind === 'event').length - WRITE_EVENTS.length)
  })
})
