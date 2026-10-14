// Command request of Terminal AI: a line that starts with `# ` and Enter, on a real zsh in a real
// pseudo-terminal (node-pty under Electron's Node), the script rc.d/40-command-request.zsh, the
// handler src/main/terminal-ai/features/command-request.ts and the assist service between them; and
// the channels of the ⌘I panel (src/main/ipc/terminal-ai-request.ts) over the same shells.
//
// The assist process is the fake of fake-backend.ts, given to the service as its backend: answers
// come from a file the test writes, and every request is one line of a log the test reads. Claude
// Code is never started and the subscription is never spent. HOME and the user's files are in a
// temporary folder: the real ~/.zshrc and ~/.zsh_history are never read or written.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_PATH, type Env } from '../../src/main/agent/env'
import { LimitsTracker } from '../../src/main/agent/limits'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { terminalKey } from '../../src/main/ipc/terminal'
import { NOT_CONNECTED, terminalAiRequestHandlers } from '../../src/main/ipc/terminal-ai-request'
import type { ShellEvent, ShellState } from '../../src/main/terminal/osc'
import { spawnShellPty, TerminalRegistry, type SpawnPty, type TerminalSink } from '../../src/main/terminal/pty'
import { ShellIntegration } from '../../src/main/terminal/shell-integration'
import { AssistService, type AssistBackend } from '../../src/main/terminal-ai/assist'
import { fakeAssistBackend, type FakeAnswer, type FakeLogEntry } from '../../src/main/terminal-ai/fake-backend'
import { clockText, refusalText, requestWords } from '../../src/main/terminal-ai/features/command-request'
import { featureModules, ShellLink, type FeatureLoader, type ShellAsk, type ShellFeature, type ShellReply } from '../../src/main/terminal-ai/shell-link'
import { TerminalAiSettingsStore } from '../../src/main/terminal-ai/settings'
import type { LimitWindowState } from '../../src/shared/agent/limits'
import { accessOf, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { TerminalAiSettingsPatch } from '../../src/shared/terminal-ai/settings'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

// The real SDK module, replaced: a test that reached it would fail here instead of starting Claude Code.
const sdkModule = vi.hoisted(() => ({ loaded: 0 }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  sdkModule.loaded++
  const refuse = (): never => {
    throw new Error('a test reached the real Agent SDK')
  }
  return { prewarm: vi.fn(refuse), query: vi.fn(refuse), startup: vi.fn(refuse) }
})

/** The zsh of the machine: /bin/zsh on macOS, /usr/bin/zsh on Linux CI (.github/workflows/ci.yml). */
const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()
const PROJECT = 'alpha-0000000a'
const NODE = 'terminal-node-1'
const SH_NODE = 'terminal-node-sh'
/** The key of the zsh Terminal, as main keys the shells of Terminal Nodes. */
const KEY = terminalKey(PROJECT, NODE)
const WAIT = { timeout: 10_000, interval: 20 }
/** Ubuntu's /etc/zsh/zshrc runs compinit unless this is set, and on the CI runner compinit waits for a key. */
const QUIET_ZSH: Env = { skip_global_compinit: '1' }
/** The modules of the features as main finds them: the glob of shell-link.ts over ./features/. */
const REQUEST_MODULE = './features/command-request.ts'
const SUGGEST_MODULE = './features/suggest.ts'

const WORDS = 'list big files'
const REQUEST_LINE = `# ${WORDS}`
/** The answer of the fake: it would leave a file behind if it ran. */
const MARK_FILE = 'found.txt'
const ANSWER = `find . -size +100M > ${MARK_FILE}`
/** The keys as xterm.js 6.0.0 sends them. */
const LEFT = '\x1b[D'
const CTRL_U = '\x15'

let home: string
let root: string
let scratch: string
const registries: TerminalRegistry[] = []
const integrations: ShellIntegration[] = []
const links: ShellLink[] = []
const services: AssistService[] = []

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-request-home-')))
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-request-project-')))
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-request-data-')))
  // A prompt without colours and a history that is kept: what a user's .zshrc usually sets.
  await writeFile(join(home, '.zshrc'), "PS1='zle%# '\nHISTSIZE=1000\nSAVEHIST=1000\n")
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
  for (const link of links.splice(0)) link.closeSync()
  for (const service of services.splice(0)) service.dispose()
  for (const integration of integrations.splice(0)) integration.disposeSync()
  removeTestTree(scratch)
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The output as xterm.js shows it: OSC sequences end on BEL, ESC \\ or U+009C and are not shown. */
// eslint-disable-next-line no-control-regex -- the sequences are made of control characters.
const shown = (text: string) => text.replace(/\x1b\][^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)/g, '')

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Grey as zsh prints `fg=8`: SGR 90 with xterm's terminfo entry, 38;5;8 with one that has no bright colours. */
const greyNote = (text: string) => new RegExp(`\\x1b\\[(?:90|38;5;8)m  ${escapeRegExp(text)}`)
/**
 * The grey note `text` in `output`, where zsh may draw it over an earlier note: it moves the cursor
 * and paints each changed letter grey, so the text is whole only without the colours.
 */
const hasGreyNote = (output: string, text: string): boolean =>
  // eslint-disable-next-line no-control-regex -- SGR sequences start with ESC.
  /\x1b\[(?:90|38;5;8)m/.test(output) && output.replace(/\x1b\[[0-9;]*m/g, '').includes(text)

// ---- the assist service over the fake backend --------------------------------------------------------

interface World {
  service: AssistService
  limits: LimitsTracker
  answers: (answers: FakeAnswer[]) => void
  requests: () => FakeLogEntry[]
  /** The lines the service wrote to its log. */
  logged: string[]
}

/** The assist service of one test. Of the features that ask the model, only Command request is on unless `settings` says otherwise. */
function world(options: { settings?: TerminalAiSettingsPatch } = {}): World {
  const dataDir = join(scratch, 'data')
  const answersFile = join(scratch, 'answers.json')
  const logFile = join(scratch, 'requests.jsonl')
  const limits = new LimitsTracker({ dataDir })
  const fake = fakeAssistBackend({ answersFile, logFile })
  const logged: string[] = []
  const service = new AssistService({
    backend: () => Promise.resolve(fake as AssistBackend),
    prewarmOptions: () => Promise.resolve({}),
    settings: new TerminalAiSettingsStore(dataDir),
    limits,
    dataDir,
    log: (line) => logged.push(line),
  })
  services.push(service)
  service.setSettings({ suggestionAsksModel: false, nextCommand: false, fix: false, commandRequest: true, ...options.settings })
  return {
    service,
    limits,
    answers: (answers) => writeFileSync(answersFile, JSON.stringify(answers)),
    requests: () =>
      (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as FakeLogEntry),
    logged,
  }
}

/** The answer of the fake to the words of this file, after `delayMs`. */
const answering = (delayMs = 300): FakeAnswer[] => [{ feature: 'request', match: WORDS, answer: `\`${ANSWER}\``, delayMs }]

const limitWindow = (over: Partial<LimitWindowState>): LimitWindowState => ({
  utilization: 0.1,
  resetsAt: Math.round(Date.now() / 1000) + 3600,
  status: 'allowed',
  receivedAt: Date.now(),
  source: 'sdk',
  ...over,
})

// ---- a real zsh ----------------------------------------------------------------------------------------

interface StartOptions {
  world?: World
  /** A pause for the Suggestion from the model (rc.d/20-suggest-ai.zsh) shorter than its own 600 ms. */
  suggestPauseMs?: number
}

interface Probe {
  /** BUFFER: the line being edited. */
  line: string
  /** POSTDISPLAY: the grey text after it. */
  grey: string
  /** The id of the ask that is open; 0 without one. */
  asked: number
  /** The line as rc.d/20-suggest-ai.zsh holds it given, not typed. */
  given: string
  /** The features the settings have on, as the shell got them (`config`); `-` before it got any. */
  features: string
}

/** Ctrl+X g: the key of the tests' own script (testKeys). */
const PROBE_KEY = '\x18g'

/**
 * A script of the tests' own, read after the feature's: Ctrl+X g writes what zsh holds into `file`,
 * without changing the line. To rc.d/40-command-request.zsh the probe is not a key of the user's: it
 * marks its own redraw the way Enter that asked does, so a request that waits goes on waiting.
 */
const testKeys = (file: string) =>
  [
    '__test_probe() {',
    '  __worfy_request_fresh=1',
    '  builtin local features=-',
    '  (( __worfy_assist_configured )) && features="${(okj: :)__worfy_assist_features}"',
    `  builtin print -r -- "line:[$BUFFER] grey:[$POSTDISPLAY] asked:[$__worfy_assist_asked] given:[\${__worfy_suggest_given-}] features:[$features]" >| ${file}`,
    '}',
    'zle -N __test_probe',
    "bindkey '^Xg' __test_probe",
  ].join('\n')

/**
 * A registry of Terminals with the shell integration over the temporary HOME, the link to their
 * shells and the assist service, and one zsh Terminal connected to the link.
 */
async function start(options: StartOptions = {}) {
  const w = options.world ?? world()
  const integration = new ShellIntegration()
  integrations.push(integration)
  const base: Env = { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8', SHELL: ZSH }
  const asks: (ShellAsk & { feature: string })[] = []
  /** The real handler of Command request, with every ask seen by the test. */
  const watched: FeatureLoader = async () => {
    const feature = (await featureModules[REQUEST_MODULE]?.()) as ShellFeature | undefined
    if (feature === undefined) return undefined
    const module: ShellFeature = {
      feature: feature.feature,
      ask: async (ask, reply, context) => {
        asks.push({ ...ask, feature: feature.feature })
        await feature.ask(ask, reply, context)
      },
    }
    return module
  }
  /** Suggestion from the model: only seen, never answered. */
  const suggestSeen: FeatureLoader = () => Promise.resolve({ feature: 'suggest', ask: (ask: ShellAsk) => void asks.push({ ...ask, feature: 'suggest' }) } satisfies ShellFeature)
  const link = new ShellLink({
    settings: () => Promise.resolve({ current: () => w.service.state().settings, subscribe: (listener) => w.service.subscribe(() => listener()) }),
    context: { shellState: (terminal) => registry.shellState(terminal), assist: () => Promise.resolve(w.service) },
    features: { [REQUEST_MODULE]: watched, [SUGGEST_MODULE]: suggestSeen },
  })
  links.push(link)
  /** What anything wrote into a pty. */
  const written: string[] = []
  const spawn: SpawnPty = (file, args, spawnOptions) => {
    const pty = spawnShellPty(file, args, spawnOptions)
    const write = pty.write.bind(pty)
    pty.write = (data: string) => {
      written.push(data)
      write(data)
    }
    return pty
  }
  const registry: TerminalRegistry = new TerminalRegistry({ env: () => Promise.resolve(base), killGraceMs: 1000, integration, spawn, assist: link })
  registries.push(registry)
  const events: { key: string; event: ShellEvent }[] = []
  registry.onShellEvent((key, event) => events.push({ key, event }))

  const dir = await integration.prepare()
  await mkdir(join(dir, 'rc.d'), { recursive: true })
  if (options.suggestPauseMs !== undefined) await writeFile(join(dir, 'rc.d', '15-test-pause.zsh'), `__worfy_suggest_pause_ms=${options.suggestPauseMs}\n`)
  const probeFile = join(scratch, 'probe.txt')
  await writeFile(join(dir, 'rc.d', '90-test.zsh'), `${testKeys(probeFile)}\n`)

  const t = await openTerminal(registry, events, KEY)
  await t.prompt()
  await vi.waitFor(() => expect(link.connected(KEY)).toBe(true), WAIT)
  /** What zsh holds right now; a request that waits is left alone. */
  const probe = async (): Promise<Probe> => {
    removeTestTree(probeFile)
    t.type(PROBE_KEY)
    await vi.waitFor(() => expect(existsSync(probeFile) && readFileSync(probeFile, 'utf8').endsWith(']\n')).toBe(true), WAIT)
    const found = /^line:\[(.*)\] grey:\[(.*)\] asked:\[(\d*)\] given:\[(.*)\] features:\[(.*)\]\n$/s.exec(readFileSync(probeFile, 'utf8'))
    if (found === null) throw new Error(`the probe wrote ${JSON.stringify(readFileSync(probeFile, 'utf8'))}`)
    return { line: found[1] ?? '', grey: found[2] ?? '', asked: Number(found[3]), given: found[4] ?? '', features: found[5] ?? '' }
  }
  /** Waits until the shell has the settings of the service: before them it asks nothing. */
  const configured = async () => {
    await vi.waitFor(async () => expect((await probe()).features).not.toBe('-'), WAIT)
  }
  await configured()
  /** The ask of the shell with `id`, once main has it. */
  const lastAsk = (feature = 'request') => asks.findLast((ask) => ask.feature === feature)
  return { ...w, registry, link, asks, lastAsk, written, t, probe, configured, integration }
}

async function openTerminal(registry: TerminalRegistry, allEvents: { key: string; event: ShellEvent }[], key: string) {
  const chunks: string[] = []
  const typed: string[] = []
  const sink: TerminalSink = { output: (data) => chunks.push(data), exit: () => undefined, started: () => undefined }
  const client = {}
  await registry.open(key, { cwd: root, cols: 120, rows: 30 }, client, sink)
  const events = () => allEvents.filter((each) => each.key === key).map((each) => each.event)
  const count = (type: ShellEvent['type']) => events().filter((event) => event.type === type).length
  const text = () => chunks.join('')
  const type = (data: string) => {
    typed.push(data)
    registry.write(key, data, client)
  }
  const prompt = async (prompts = 1) => {
    await vi.waitFor(() => expect(count('prompt'), `prompts in ${JSON.stringify(text().slice(-2000))}`).toBeGreaterThanOrEqual(prompts), WAIT)
  }
  return {
    text,
    type,
    typed,
    count,
    prompt,
    /** Types one command line and waits until it finished and the next prompt is shown; answers its output. */
    run: async (line: string) => {
      const finished = count('command-finished')
      const prompts = count('prompt')
      type(`${line}\r`)
      await vi.waitFor(() => {
        expect(count('command-finished')).toBe(finished + 1)
        expect(count('prompt')).toBeGreaterThan(prompts)
      }, WAIT)
      return registry.shellState(key)?.lastOutput ?? ''
    },
    /** The output since `from`, as xterm.js shows it. */
    since: (from: number) => shown(text().slice(from)),
  }
}

/**
 * Waits until the shell has handled every message main sent it so far: a note with no ask (`status 0`)
 * goes after them, and the shell handles its messages in order.
 */
async function processed(s: Awaited<ReturnType<typeof start>>): Promise<void> {
  const marker = `processed-${Math.random().toString(36).slice(2)}`
  expect(s.link.push(KEY, { type: 'status', id: 0, text: marker })).toBe(true)
  await vi.waitFor(async () => expect((await s.probe()).grey).toBe(`  ${marker}`), WAIT)
}

// ---- the words of a line -------------------------------------------------------------------------------

describe('the words and the notes', () => {
  it('a Command request is `# ` and words on one line; anything else is not one', () => {
    expect(requestWords('# list big files')).toBe('list big files')
    expect(requestWords('#   kill what listens on 3000  ')).toBe('kill what listens on 3000')
    expect(requestWords('#comment')).toBeNull()
    expect(requestWords('# ')).toBeNull()
    expect(requestWords('#    ')).toBeNull()
    expect(requestWords(' # list')).toBeNull()
    expect(requestWords('# list\nrm -rf x')).toBeNull()
  })

  it('a refusal says why; the time of the Limits is the time of this Machine, with the day when it is not today', () => {
    const now = new Date(2026, 9, 14, 9, 5).getTime()
    expect(refusalText({ ok: false, reason: 'limits', until: new Date(2026, 9, 14, 14, 20).getTime() }, now)).toBe('Limits reached until 14:20')
    expect(refusalText({ ok: false, reason: 'limits', until: new Date(2026, 9, 16, 8, 5).getTime() }, now)).toBe('Limits reached until Oct 16, 08:05')
    expect(refusalText({ ok: false, reason: 'off' }, now)).toBe('Terminal AI is off')
    expect(refusalText({ ok: false, reason: 'command-running' }, now)).toBe('Terminal is busy')
    expect(refusalText({ ok: false, reason: 'timeout' }, now)).toBe('Claude did not answer in time')
    expect(refusalText({ ok: false, reason: 'failed', detail: 'error' }, now)).toBe('Claude could not answer')
    expect(refusalText({ ok: false, reason: 'cancelled' }, now)).toBeNull()
  })
})

// ---- the handler, without a shell ----------------------------------------------------------------------

describe('the handler of the feature', () => {
  const state: ShellState = { cwd: '/Users/me/work', awaitingInput: true, commandRunning: false, altScreen: false, exitCode: 1, commands: ['ls -la', 'du -sh .'], lastOutput: 'output-of-the-last-command' }

  /** Calls the handler as the link does; answers what it sent, in order. */
  async function asked(w: World, line: string, signal: AbortSignal = new AbortController().signal): Promise<string[]> {
    const feature = (await featureModules[REQUEST_MODULE]?.()) as ShellFeature
    const sent: string[] = []
    const reply: ShellReply = {
      show: (text) => sent.push(`show ${text}`) > 0,
      status: (text) => !signal.aborted && sent.push(`status ${text}`) > 0,
      insert: (text) => !signal.aborted && sent.push(`insert ${text}`) > 0,
    }
    await feature.ask({ terminal: KEY, id: 7, line, signal }, reply, { shellState: () => state, assist: () => Promise.resolve(w.service) })
    return sent
  }

  it('is found by main under the name request', async () => {
    expect(Object.keys(featureModules)).toContain(REQUEST_MODULE)
    expect(((await featureModules[REQUEST_MODULE]?.()) as ShellFeature).feature).toBe('request')
  })

  it('answers with an empty status and then the insert, so the shell can tell the answer of this ask; the context is the words, not the line', async () => {
    const w = world()
    w.answers(answering(0))
    expect(await asked(w, REQUEST_LINE)).toEqual(['status ', `insert ${ANSWER}`])
    expect(w.requests()).toMatchObject([
      { feature: 'request', model: 'sonnet', context: { line: '', request: WORDS, cwd: '/Users/me/work', commands: ['ls -la', 'du -sh .'], exitCode: 1, output: null } },
    ])
  })

  it('a refusal is a status with its reason; a cancelled ask and a line that is no request get nothing', async () => {
    const w = world()
    w.answers(answering(0))
    w.service.setSettings({ commandRequest: false })
    expect(await asked(w, REQUEST_LINE)).toEqual(['status Terminal AI is off'])
    w.service.setSettings({ commandRequest: true })
    const cancelled = new AbortController()
    cancelled.abort()
    expect(await asked(w, REQUEST_LINE, cancelled.signal)).toEqual([])
    expect(await asked(w, '#comment')).toEqual([])
    expect(w.requests()).toEqual([])
  })
})

// ---- the line `# …` -----------------------------------------------------------------------------------

describe('a line that starts with `# ` and Enter', () => {
  it('becomes the command of the answer, and the command does not run: no file of it, no Enter from main', async () => {
    const w = world()
    w.answers(answering())
    const s = await start({ world: w })
    const prompts = s.t.count('prompt')
    const from = s.t.text().length

    s.t.type(`${REQUEST_LINE}\r`)
    // While the model answers, the line stays and a grey note says what goes on.
    await vi.waitFor(() => expect(s.t.text().slice(from)).toMatch(greyNote('asking Claude…')), WAIT)
    // The answer replaces the line, the cursor at its end; the note is gone.
    await vi.waitFor(() => expect(w.requests()).toHaveLength(1), WAIT)
    await vi.waitFor(async () => expect(await s.probe()).toMatchObject({ line: ANSWER, grey: '', asked: 0 }), WAIT)
    // zsh did not run `#`, and nothing ran the answer: no new prompt, no file, no error of zsh.
    expect(s.t.since(from)).not.toMatch(/command not found|zsh: /)
    expect(s.t.count('prompt')).toBe(prompts)
    expect(existsSync(join(root, MARK_FILE))).toBe(false)
    // Main wrote nothing into the pty: every write is a key the test typed, and none of them is Enter after the first.
    expect(s.written).toEqual(s.t.typed)
    expect(s.written.slice(s.written.indexOf(`${REQUEST_LINE}\r`) + 1).join('')).not.toMatch(/[\r\n]/)

    // The model was asked once: Command request, Sonnet, with the words after `# `.
    expect(s.asks.map((ask) => ask.line)).toEqual([REQUEST_LINE])
    const requests = w.requests()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ feature: 'request', model: 'sonnet', cancelled: false, context: { request: WORDS, line: '', cwd: root } })

    // Enter is the user's: now the command runs.
    s.t.type('\r')
    await s.t.prompt(prompts + 1)
    await vi.waitFor(() => expect(existsSync(join(root, MARK_FILE))).toBe(true), WAIT)
  })

  it('a key before the answer cancels the request, even one that leaves the line as it is; the line stays `# …` and no late answer lands', async () => {
    const w = world()
    w.answers(answering(1500))
    const s = await start({ world: w })
    const from = s.t.text().length
    s.t.type(`${REQUEST_LINE}\r`)
    await vi.waitFor(() => expect(s.t.text().slice(from)).toMatch(greyNote('asking Claude…')), WAIT)
    // ← moves the cursor and changes nothing of the line.
    await vi.waitFor(() => expect(s.lastAsk()).toBeDefined(), WAIT)
    s.t.type(LEFT)
    // The cancel reached main: the handler's ask is aborted.
    await vi.waitFor(() => expect(s.lastAsk()?.signal.aborted).toBe(true), WAIT)
    // Past the moment the answer would have come.
    await sleep(1700)
    expect(await s.probe()).toMatchObject({ line: REQUEST_LINE, grey: '', asked: 0 })
    expect(s.written).toEqual(s.t.typed)
    // The fake answered nothing: a request that reached it at all was cancelled there.
    expect(w.requests().filter((entry) => !entry.cancelled)).toEqual([])
  })

  it('an answer that left main before the cancel of a key is dropped; an insert of the panel is taken as before', async () => {
    const w = world()
    w.answers(answering(1500))
    const s = await start({ world: w })
    s.t.type(`${REQUEST_LINE}\r`)
    await vi.waitFor(() => expect(s.lastAsk()).toBeDefined(), WAIT)
    const first = s.lastAsk()?.id ?? 0
    s.t.type(LEFT)
    await vi.waitFor(async () => expect((await s.probe()).asked).toBe(0), WAIT)
    // What main sends for an answer, after the shell cancelled the ask: an empty status, then the insert.
    expect(s.link.push(KEY, { type: 'status', id: first, text: '' })).toBe(true)
    expect(s.link.push(KEY, { type: 'insert', text: 'echo late-answer' })).toBe(true)
    await processed(s)
    expect((await s.probe()).line).toBe(REQUEST_LINE)

    // Enter asks again, ← cancels that one too, and Enter asks a third time: the late answer of the
    // second request comes while the third waits, and does not take its line.
    s.t.type('\r')
    await vi.waitFor(() => expect(s.lastAsk()?.id).toBeGreaterThan(first), WAIT)
    const second = s.lastAsk()?.id ?? 0
    s.t.type(LEFT)
    await vi.waitFor(async () => expect((await s.probe()).asked).toBe(0), WAIT)
    s.t.type('\r')
    await vi.waitFor(() => expect(s.lastAsk()?.id).toBeGreaterThan(second), WAIT)
    expect(s.link.push(KEY, { type: 'status', id: second, text: '' })).toBe(true)
    expect(s.link.push(KEY, { type: 'insert', text: 'echo late-answer' })).toBe(true)
    // The second request is answered: its command is the line.
    await vi.waitFor(() => expect(w.requests().filter((entry) => !entry.cancelled)).toHaveLength(1), WAIT)
    await vi.waitFor(async () => expect((await s.probe()).line).toBe(ANSWER), WAIT)

    // An insert with no status before it — the ⌘I panel — replaces the line.
    expect(s.link.push(KEY, { type: 'insert', text: 'echo from-the-panel' })).toBe(true)
    await vi.waitFor(async () => expect((await s.probe()).line).toBe('echo from-the-panel'), WAIT)
  }, 30_000)

  it('`#comment` without a space, and `# ` without words, are accept-line as before: no ask', async () => {
    const s = await start()
    const from = s.t.text().length
    await s.t.run('#comment')
    await s.t.run('#   ')
    // Without INTERACTIVE_COMMENTS zsh runs them as commands, as it did without worfy.
    expect(s.t.since(from)).toMatch(/command not found: #comment/)
    // A line of several lines (pasted) that starts with `# ` is not a request either.
    s.t.type(`\x1b[200~${REQUEST_LINE}\necho worfy-pasted-second\x1b[201~\r`)
    await vi.waitFor(() => expect(s.t.since(from)).toMatch(/^worfy-pasted-second\r?$/m), WAIT)
    expect(s.asks).toEqual([])
  })

  it('a widget of the user on accept-line still gets every other line; the line `# …` asks', async () => {
    const accepted = join(scratch, 'accepted.txt')
    await writeFile(
      join(home, '.zshrc'),
      ["PS1='zle%# '", `__user_accept() { builtin print -r -- "$BUFFER" >> ${accepted}; zle .accept-line }`, 'zle -N accept-line __user_accept', ''].join('\n'),
    )
    const w = world()
    w.answers(answering())
    const s = await start({ world: w })
    await s.t.run('echo worfy-plain-line')
    expect(readFileSync(accepted, 'utf8')).toBe('echo worfy-plain-line\n')
    s.t.type(`${REQUEST_LINE}\r`)
    await vi.waitFor(async () => expect((await s.probe()).line).toBe(ANSWER), WAIT)
    expect(readFileSync(accepted, 'utf8')).toBe('echo worfy-plain-line\n')
  })

  it('the line `# …` does not go into the history of zsh', async () => {
    const w = world()
    w.answers(answering())
    const s = await start({ world: w })
    await s.t.run('echo worfy-request-before')
    s.t.type(`${REQUEST_LINE}\r`)
    await vi.waitFor(() => expect(w.requests()).toHaveLength(1), WAIT)
    await vi.waitFor(async () => expect((await s.probe()).line).toBe(ANSWER), WAIT)
    s.t.type(CTRL_U)
    const listed = await s.t.run('fc -ln 1')
    expect(listed).toContain('echo worfy-request-before')
    expect(listed).not.toContain(WORDS)
    expect(listed).not.toContain(ANSWER)
  })

  it('with Command request off in Settings, Enter is accept-line as before', async () => {
    const w = world({ settings: { commandRequest: false } })
    w.answers(answering())
    const s = await start({ world: w })
    expect((await s.probe()).features).not.toContain('request')
    const from = s.t.text().length
    await s.t.run(REQUEST_LINE)
    expect(s.t.since(from)).toMatch(/command not found: #/)
    expect(s.asks).toEqual([])
    expect(w.requests()).toEqual([])
  })
})

describe('the Limits', () => {
  it('rejected: a grey note with the time they reset, and no request', async () => {
    const w = world()
    w.answers(answering())
    const resetsAt = Math.round(Date.now() / 1000) + 2 * 3600
    w.limits.record([{ window: 'five_hour', state: limitWindow({ status: 'rejected', utilization: 1, resetsAt }) }])
    const s = await start({ world: w })
    const from = s.t.text().length
    s.t.type(`${REQUEST_LINE}\r`)
    const note = `Limits reached until ${clockText(resetsAt * 1000, Date.now())}`
    await vi.waitFor(() => expect(hasGreyNote(s.t.text().slice(from), note), JSON.stringify(s.t.text().slice(from))).toBe(true), WAIT)
    await sleep(300)
    expect(w.requests()).toEqual([])
    expect(await s.probe()).toMatchObject({ line: REQUEST_LINE, grey: `  ${note}` })
    // The note goes with the next key; the line stays.
    s.t.type(LEFT)
    await vi.waitFor(async () => expect(await s.probe()).toMatchObject({ line: REQUEST_LINE, grey: '', asked: 0 }), WAIT)
  })

  it('at 90 % of the five-hour window the request still goes: Command request is on demand', async () => {
    const w = world()
    w.answers(answering())
    w.limits.record([{ window: 'five_hour', state: limitWindow({ status: 'allowed_warning', utilization: 0.9 }) }])
    const s = await start({ world: w })
    s.t.type(`${REQUEST_LINE}\r`)
    await vi.waitFor(() => expect(w.requests()).toMatchObject([{ feature: 'request', cancelled: false }]), WAIT)
    await vi.waitFor(async () => expect((await s.probe()).line).toBe(ANSWER), WAIT)
  })
})

describe('with the Suggestion from the model (rc.d/20-suggest-ai.zsh)', () => {
  it('neither the line `# …` nor the command put into the line is asked about; a line typed after it is', async () => {
    const w = world({ settings: { suggestionAsksModel: true } })
    w.answers(answering())
    const s = await start({ world: w, suggestPauseMs: 150 })
    s.t.type(REQUEST_LINE)
    await sleep(600)
    s.t.type('\r')
    await vi.waitFor(() => expect(w.requests()).toHaveLength(1), WAIT)
    await vi.waitFor(async () => expect(await s.probe()).toMatchObject({ line: ANSWER, given: ANSWER }), WAIT)
    await sleep(600)
    expect(s.asks.filter((ask) => ask.feature === 'suggest')).toEqual([])
    // The widget of the Suggestion still works: a line the user changed is asked about after the pause.
    s.t.type(' -print')
    await vi.waitFor(() => expect(s.lastAsk('suggest')?.line).toBe(`${ANSWER} -print`), WAIT)
  })
})

// ---- the channels of the panel -------------------------------------------------------------------------

class FakeWindow {
  sent: { channel: string; payload: unknown }[] = []
  private destroyed = false
  private readonly onDestroyed: (() => void)[] = []
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  once(_event: 'destroyed', listener: () => void): void {
    this.onDestroyed.push(listener)
  }
  destroy(): void {
    this.destroyed = true
    for (const listener of this.onDestroyed) listener()
  }
  /** The payloads of `terminalAi.request.changed`. */
  changes(): unknown[] {
    return this.sent.filter((entry) => entry.channel === `${IPC_CHANNEL_PREFIX}terminalAi.request.changed`).map((entry) => entry.payload)
  }
}

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

/** The zsh Terminal of `start`, a Terminal on /bin/sh beside it, and the channels of the panel over both. */
async function panel(options: StartOptions = {}) {
  const s = await start(options)
  const sh = new TerminalRegistry({
    env: () => Promise.resolve({ ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8', SHELL: '/bin/sh' }),
    killGraceMs: 1000,
    integration: s.integration,
    assist: s.link,
  })
  registries.push(sh)
  await sh.open(terminalKey(PROJECT, SH_NODE), { cwd: root, cols: 80, rows: 24 }, {}, { output: () => undefined, exit: () => undefined, started: () => undefined })
  const shells = {
    shellState: (key: string) => s.registry.shellState(key) ?? sh.shellState(key),
    onShellEvent: (listener: (key: string, event: ShellEvent) => void) => {
      const offs = [s.registry.onShellEvent(listener), sh.onShellEvent(listener)]
      return () => offs.forEach((off) => off())
    },
  }
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './terminal-ai-request.ts': async () => terminalAiRequestHandlers({ registry: () => shells, link: () => s.link, assist: () => Promise.resolve(s.service) }) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  const window = new FakeWindow()
  const call = async (channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: APP_URL }, sender: window } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  return { ...s, call, window }
}

describe('the channels of the ⌘I panel', () => {
  it('are marked `project`: the panel works with a Terminal of the Project', () => {
    for (const channel of ['terminalAi.request.state', 'terminalAi.request.changed', 'terminalAi.request', 'terminalAi.request.cancel']) expect(accessOf(channel), channel).toBe('project')
  })

  it('the state: available for a zsh connected to Terminal AI, not for a Terminal on /bin/sh, not with Command request off; busy while a command runs', async () => {
    const p = await panel()
    expect(await p.call('terminalAi.request.state', { projectId: PROJECT, nodeId: NODE })).toEqual({ ok: true, value: { available: true, busy: false } })
    expect(await p.call('terminalAi.request.state', { projectId: PROJECT, nodeId: SH_NODE })).toEqual({ ok: true, value: { available: false, busy: false } })

    // Settings: the window hears the change of the Terminal it follows.
    p.service.setSettings({ commandRequest: false })
    await vi.waitFor(() => expect(p.window.changes().at(-1)).toEqual({ projectId: PROJECT, nodeId: NODE, available: false, busy: false }), WAIT)
    expect(await p.call('terminalAi.request.state', { projectId: PROJECT, nodeId: NODE })).toEqual({ ok: true, value: { available: false, busy: false } })
    p.service.setSettings({ commandRequest: true })
    await vi.waitFor(() => expect(p.window.changes().at(-1)).toMatchObject({ nodeId: NODE, available: true }), WAIT)

    // A command: busy while it runs, not after.
    const before = p.window.changes().length
    await p.t.run('sleep 1')
    const during = p.window.changes().slice(before)
    expect(during).toEqual([
      { projectId: PROJECT, nodeId: NODE, available: true, busy: true },
      { projectId: PROJECT, nodeId: NODE, available: true, busy: false },
    ])
    // The window goes: it hears nothing more.
    p.window.destroy()
    const sent = p.window.sent.length
    p.service.setSettings({ commandRequest: false })
    await sleep(200)
    expect(p.window.sent).toHaveLength(sent)
  })

  it('the zsh leaving makes the panel unavailable', async () => {
    const p = await panel()
    await p.call('terminalAi.request.state', { projectId: PROJECT, nodeId: NODE })
    await p.registry.close(KEY)
    await vi.waitFor(() => expect(p.window.changes().at(-1)).toEqual({ projectId: PROJECT, nodeId: NODE, available: false, busy: false }), WAIT)
  })

  it('a request puts the command into the line of the zsh, and nothing runs', async () => {
    const p = await panel()
    p.answers(answering())
    const prompts = p.t.count('prompt')
    expect(await p.call('terminalAi.request', { projectId: PROJECT, nodeId: NODE, text: `  ${WORDS} ` })).toEqual({ ok: true, value: { ok: true } })
    await vi.waitFor(async () => expect((await p.probe()).line).toBe(ANSWER), WAIT)
    await sleep(300)
    expect(p.t.count('prompt')).toBe(prompts)
    expect(existsSync(join(root, MARK_FILE))).toBe(false)
    expect(p.written).toEqual(p.t.typed)
    expect(p.requests()).toMatchObject([{ feature: 'request', model: 'sonnet', context: { request: WORDS, line: '', cwd: root } }])
  })

  it('a request to a Terminal without the integration fails, and the model is not asked', async () => {
    const p = await panel()
    p.answers(answering())
    const result = await p.call('terminalAi.request', { projectId: PROJECT, nodeId: SH_NODE, text: WORDS })
    expect(result).toEqual({ ok: false, error: `terminalAi.request failed: ${NOT_CONNECTED}` })
    await sleep(300)
    expect(p.requests()).toEqual([])
  })

  it('a request while a command runs says the Terminal is busy, and the model is not asked', async () => {
    const p = await panel()
    p.answers(answering())
    p.t.type('sleep 2\r')
    await vi.waitFor(() => expect(p.registry.shellState(KEY)?.commandRunning).toBe(true), WAIT)
    expect(await p.call('terminalAi.request', { projectId: PROJECT, nodeId: NODE, text: WORDS })).toEqual({ ok: true, value: { ok: false, message: 'Terminal is busy' } })
    expect(p.requests()).toEqual([])
  })

  it('a request the panel cancels puts nothing into the line', async () => {
    const p = await panel()
    p.answers(answering(1500))
    p.t.type('echo typed-by-the-user')
    const pending = p.call('terminalAi.request', { projectId: PROJECT, nodeId: NODE, text: WORDS })
    await sleep(300)
    expect(await p.call('terminalAi.request.cancel', { projectId: PROJECT, nodeId: NODE })).toEqual({ ok: true, value: undefined })
    expect(await pending).toEqual({ ok: true, value: { ok: false, message: 'Cancelled' } })
    await sleep(1700)
    expect((await p.probe()).line).toBe('echo typed-by-the-user')
    // A request that reached the fake at all was cancelled there.
    expect(p.requests().filter((entry) => !entry.cancelled)).toEqual([])
  })
})

describe('the log and the errors of main', () => {
  it('hold neither the words, nor the line, nor the answer', async () => {
    const printed: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : String(arg))).join(' ')))
    }
    const p = await panel()
    p.answers(answering())
    // The line `# …`.
    p.t.type(`${REQUEST_LINE}\r`)
    await vi.waitFor(() => expect(p.requests()).toHaveLength(1), WAIT)
    await vi.waitFor(async () => expect((await p.probe()).line).toBe(ANSWER), WAIT)
    // The panel, to the zsh and to the Terminal on /bin/sh.
    expect(await p.call('terminalAi.request', { projectId: PROJECT, nodeId: NODE, text: WORDS })).toEqual({ ok: true, value: { ok: true } })
    const failed = await p.call('terminalAi.request', { projectId: PROJECT, nodeId: SH_NODE, text: WORDS })
    expect(failed.ok).toBe(false)
    // A refusal and a request to an unknown Terminal.
    expect(await p.call('terminalAi.request', { projectId: PROJECT, nodeId: 'gone', text: WORDS })).toMatchObject({ ok: false })
    p.service.setSettings({ commandRequest: false })
    expect(await p.call('terminalAi.request', { projectId: PROJECT, nodeId: NODE, text: WORDS })).toEqual({ ok: true, value: { ok: false, message: 'Terminal AI is off' } })

    const everything = [...printed, ...p.logged, JSON.stringify(failed)].join('\n')
    expect(printed.length + p.logged.length).toBeGreaterThan(0)
    for (const secret of [WORDS, ANSWER, 'size +100M', REQUEST_LINE]) expect(everything).not.toContain(secret)
  })
})
