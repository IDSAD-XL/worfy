// Next command of Terminal AI: once a command is over and zsh shows an empty line, the model
// proposes the command to run next, in grey. The script rc.d/30-next-command.zsh on a real zsh in a
// real pseudo-terminal (node-pty under Electron's Node), the handler of
// src/main/terminal-ai/features/next-command.ts and the assist service between them.
//
// The assist process is the fake of fake-backend.ts, given to the service as its backend: answers
// come from a file the test writes, and every request is one line of a log the test reads. Claude
// Code is never started and the subscription is never spent. HOME and the user's files are in a
// temporary folder: the real ~/.zshrc and ~/.zsh_history are never read or written.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_PATH, type Env } from '../../src/main/agent/env'
import { LimitsTracker } from '../../src/main/agent/limits'
import type { ShellEvent, ShellState } from '../../src/main/terminal/osc'
import { spawnShellPty, TerminalRegistry, type SpawnPty, type TerminalSink } from '../../src/main/terminal/pty'
import { ShellIntegration } from '../../src/main/terminal/shell-integration'
import { AssistService, type AssistBackend } from '../../src/main/terminal-ai/assist'
import { fakeAssistBackend, type FakeAnswer, type FakeLogEntry } from '../../src/main/terminal-ai/fake-backend'
import { NEXT_COMMAND_PAUSE_MS, nextCommandFeature } from '../../src/main/terminal-ai/features/next-command'
import { featureModules, ShellLink, type FeatureLoader, type ShellAsk, type ShellFeature, type ShellReply } from '../../src/main/terminal-ai/shell-link'
import { TerminalAiSettingsStore } from '../../src/main/terminal-ai/settings'
import type { TerminalAiSettingsPatch } from '../../src/shared/terminal-ai/settings'
import { removeTestTree } from '../remove'
import { needsZsh, zshPath } from '../zsh'

// The real SDK module, replaced: a test that reached it would fail here instead of starting Claude Code.
const sdkModule = vi.hoisted(() => ({ loaded: 0 }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  sdkModule.loaded++
  const refuse = (): never => {
    throw new Error('a test reached the real Agent SDK')
  }
  return { prewarm: vi.fn(refuse), query: vi.fn(refuse), startup: vi.fn(refuse) }
})

const KEY = 'terminal-1'
const WAIT = { timeout: 10_000, interval: 20 }
/** Ubuntu's /etc/zsh/zshrc runs compinit unless this is set, and on the CI runner compinit waits for a key. */
const QUIET_ZSH: Env = { skip_global_compinit: '1' }
/** The module of the feature as main finds it: the glob of shell-link.ts over ./features/. */
const NEXT_MODULE = './features/next-command.ts'
/** The pause of the handler in these tests; its own is NEXT_COMMAND_PAUSE_MS. */
const PAUSE_MS = 100
/** Long enough for an ask to have come, waited its pause and reached the model. */
const SEVERAL_PAUSES_MS = PAUSE_MS * 6
const BRANCH = 'worfy-next-branch'
/** What the fake proposes in most tests: running it would print RAN. */
const RAN = 'worfy-next-ran-zz'
const ANSWER = `echo ${RAN}`

/** The keys as xterm.js 6.0.0 sends them (node_modules/@xterm/xterm/src/common/input/Keyboard.ts). */
const RIGHT = '\x1b[C'
const ESC = '\x1b'
const CTRL_C = '\x03'
const CTRL_L = '\x0c'
const BACKSPACE = '\x7f'

let home: string
let root: string
let scratch: string
const registries: TerminalRegistry[] = []
const integrations: ShellIntegration[] = []
const links: ShellLink[] = []
const services: AssistService[] = []

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-next-home-')))
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-next-project-')))
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-next-data-')))
  // A prompt without colours and a history that is kept: what a user's .zshrc usually sets.
  await writeFile(join(home, '.zshrc'), "PS1='zle%# '\nHISTSIZE=1000\nSAVEHIST=1000\n")
  // The folder of the Terminal is a repository on a branch of its own: the request carries the branch.
  execFileSync('git', ['init', '-q', '-b', BRANCH, root])
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
const GREY = '\\x1b\\[(?:90|38;5;8)m'
// eslint-disable-next-line no-control-regex -- an SGR sequence starts with ESC.
const ANY_GREY = /\x1b\[(?:90|38;5;8)m/
/** The end of the prompt: on Debian /etc/zsh/zshrc turns the keypad mode on (ESC =) as zsh starts to edit. */
const PROMPT = 'zle[%#] (?:\\x1b[=>])*'
/** The line of the prompt with `typed` in the default colour and `grey` after it in grey. */
const lineWithGrey = (typed: string, grey: string) => new RegExp(`${PROMPT}${escapeRegExp(typed)}${GREY}${escapeRegExp(grey)}\\x1b\\[39m`)
/** The line of the prompt with `typed` and nothing after it. */
const lineAlone = (typed: string) => new RegExp(`${PROMPT}${escapeRegExp(typed)}(?:\\x1b\\[K|\\x1b\\[J)*$`)
/** What the command of ANSWER prints when it runs: its own line, not the grey text of the prompt. */
const RAN_OUTPUT = new RegExp(`\\r\\n${RAN}\\r\\n`)
/** What zsh prints when something of the scripts went wrong. */
const ZSH_ERROR = /zsh: |command not found|bad file descriptor|no such|not found|write error|broken pipe|parse error/i

// ---- the assist service over the fake backend --------------------------------------------------------

interface World {
  service: AssistService
  limits: LimitsTracker
  /** Writes the answers of the fake; it reads the file anew on every request. */
  answers: (answers: FakeAnswer[]) => void
  /** The requests that reached the assist process, in the order they ended. */
  requests: () => FakeLogEntry[]
  /** The log of requests as it is on the disk. */
  requestsText: () => string
  /** How many requests reached the assist process so far: their prompt went out. */
  claims: () => number
}

/** The assist service of one test. Only Next command is on: no other feature asks the model here. */
function world(options: { backend?: () => Promise<AssistBackend>; settings?: TerminalAiSettingsPatch } = {}): World {
  const dataDir = join(scratch, 'data')
  const answersFile = join(scratch, 'answers.json')
  const logFile = join(scratch, 'requests.jsonl')
  const limits = new LimitsTracker({ dataDir })
  const fake = fakeAssistBackend({ answersFile, logFile })
  let claims = 0
  const counting: AssistBackend = {
    prewarm: async (prewarmOptions) => {
      const spare = await fake.prewarm(prewarmOptions)
      return {
        claimed: spare.claimed,
        exited: spare.exited,
        close: () => spare.close(),
        claim: (params, meta) => {
          claims++
          return spare.claim(params, meta)
        },
      }
    },
    query: (params, meta) => fake.query(params, meta),
  }
  const service = new AssistService({
    backend: options.backend ?? (() => Promise.resolve(counting)),
    prewarmOptions: () => Promise.resolve({}),
    settings: new TerminalAiSettingsStore(dataDir),
    limits,
    dataDir,
  })
  services.push(service)
  service.setSettings({ suggestionAsksModel: false, commandRequest: false, fix: false, ...options.settings })
  const requestsText = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
  return {
    service,
    limits,
    answers: (answers) => writeFileSync(answersFile, JSON.stringify(answers)),
    requests: () =>
      requestsText()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as FakeLogEntry),
    requestsText,
    claims: () => claims,
  }
}

const warning = () => ({ utilization: 0.3, resetsAt: Date.now() / 1000 + 3600, status: 'allowed_warning' as const, receivedAt: Date.now(), source: 'sdk' as const })

// ---- the handler, without a shell ----------------------------------------------------------------------

const STATE: ShellState = { cwd: '/Users/me/work', awaitingInput: true, commandRunning: false, altScreen: false, exitCode: 0, commands: ['git status'], lastOutput: null }

/** Calls a handler as the link does, with a shell whose state the test gives. */
async function asked(w: World, options: { line?: string; state?: ShellState | null; signal?: AbortSignal; feature?: ShellFeature } = {}) {
  const feature = options.feature ?? nextCommandFeature({ pauseMs: PAUSE_MS })
  const signal = options.signal ?? new AbortController().signal
  const state = options.state === undefined ? STATE : options.state
  const shows: string[] = []
  const others: string[] = []
  const reply: ShellReply = {
    show: (text) => {
      shows.push(text)
      return !signal.aborted
    },
    status: (text) => {
      others.push(`status ${text}`)
      return true
    },
    insert: (text) => {
      others.push(`insert ${text}`)
      return true
    },
  }
  await feature.ask({ terminal: KEY, id: 1, line: options.line ?? '', signal }, reply, { shellState: () => state, assist: () => Promise.resolve(w.service) })
  return { shows, others }
}

describe('the handler of Next command', () => {
  it('is found by main under the name next', async () => {
    expect(Object.keys(featureModules)).toContain(NEXT_MODULE)
    const load = featureModules[NEXT_MODULE]
    expect(((await load?.()) as ShellFeature).feature).toBe('next')
  })

  it('after its pause asks Sonnet with the folder, the last commands, the branch and the exit code, and shows the answer whole', async () => {
    const w = world()
    w.answers([{ feature: 'next', answer: '`git add -A`' }])
    const state: ShellState = { ...STATE, cwd: root, exitCode: 0, commands: ['git status'], lastOutput: 'On branch output-marker-zz' }
    const { shows, others } = await asked(w, { state })
    expect(shows).toEqual(['git add -A'])
    expect(others).toEqual([])
    expect(w.requests()).toEqual([
      {
        feature: 'next',
        model: 'sonnet',
        context: { line: '', request: null, cwd: root, commands: ['git status'], branch: BRANCH, exitCode: 0, output: null },
        cancelled: false,
        cold: false,
      },
    ])
    expect(w.requestsText()).not.toContain('output-marker-zz')
  })

  it('waits its pause before the model is asked; a cancel during the pause asks nothing', async () => {
    const w = world()
    w.answers([{ feature: 'next', answer: ANSWER }])
    // A pause longer than main's own: the one given is the one waited.
    const began = performance.now()
    const pending = asked(w, { feature: nextCommandFeature({ pauseMs: 1_500 }) })
    await sleep(1_000)
    expect(w.claims()).toBe(0)
    await vi.waitFor(() => expect(w.claims()).toBe(1), WAIT)
    expect(performance.now() - began).toBeGreaterThanOrEqual(1_500)
    expect((await pending).shows).toEqual([ANSWER])

    // A cancel ends the pause at once, and the handler with it.
    const abort = new AbortController()
    const cancelled = asked(w, { feature: nextCommandFeature({ pauseMs: 3_000 }), signal: abort.signal })
    await sleep(100)
    const abortedAt = performance.now()
    abort.abort()
    expect((await cancelled).shows).toEqual([])
    expect(performance.now() - abortedAt).toBeLessThan(1_000)
    // An ask cancelled before the handler got it does not wait at all.
    const late = new AbortController()
    late.abort()
    const lateAt = performance.now()
    expect((await asked(w, { feature: nextCommandFeature({ pauseMs: 3_000 }), signal: late.signal })).shows).toEqual([])
    expect(performance.now() - lateAt).toBeLessThan(1_000)
    expect(w.claims()).toBe(1)
    expect(w.requests()).toHaveLength(1)
  })

  it(`main's own pause is ${NEXT_COMMAND_PAUSE_MS} ms`, async () => {
    expect(NEXT_COMMAND_PAUSE_MS).toBe(800)
    const w = world()
    w.answers([{ feature: 'next', answer: ANSWER }])
    const load = featureModules[NEXT_MODULE]
    const began = performance.now()
    const pending = asked(w, { feature: (await load?.()) as ShellFeature })
    await vi.waitFor(() => expect(w.claims()).toBe(1), WAIT)
    expect(performance.now() - began).toBeGreaterThanOrEqual(NEXT_COMMAND_PAUSE_MS)
    expect((await pending).shows).toEqual([ANSWER])
  })

  it('a cancel while the model answers closes the request and shows nothing', async () => {
    const w = world()
    // Well within the 8 s of Next command: only the cancel stops it.
    w.answers([{ feature: 'next', answer: ANSWER, delayMs: 1_500 }])
    const abort = new AbortController()
    const pending = asked(w, { signal: abort.signal })
    await vi.waitFor(() => expect(w.claims()).toBe(1), WAIT)
    abort.abort()
    expect((await pending).shows).toEqual([])
    expect(w.requests()).toMatchObject([{ feature: 'next', cancelled: true }])
  })

  it('asks nothing for a line that is not empty, while a command runs, on the alternate screen, and without a folder', async () => {
    const w = world()
    w.answers([{ feature: 'next', answer: ANSWER }])
    expect((await asked(w, { line: 'git' })).shows).toEqual([])
    expect((await asked(w, { state: { ...STATE, commandRunning: true } })).shows).toEqual([])
    expect((await asked(w, { state: { ...STATE, altScreen: true } })).shows).toEqual([])
    expect((await asked(w, { state: { ...STATE, cwd: null } })).shows).toEqual([])
    expect((await asked(w, { state: null })).shows).toEqual([])
    expect(w.requests()).toEqual([])
    expect((await asked(w)).shows).toEqual([ANSWER])
  })

  it('Haiku in the settings asks Haiku; Next command off, or the Limits at allowed_warning, ask nothing; an empty answer shows nothing', async () => {
    const w = world({ settings: { nextCommandModel: 'haiku' } })
    w.answers([{ feature: 'next', answer: ANSWER }])
    expect((await asked(w)).shows).toEqual([ANSWER])
    expect(w.requests()).toMatchObject([{ feature: 'next', model: 'haiku' }])
    w.service.setSettings({ nextCommand: false })
    expect((await asked(w)).shows).toEqual([])
    w.service.setSettings({ nextCommand: true })
    w.limits.record([{ window: 'five_hour', state: warning() }])
    expect((await asked(w)).shows).toEqual([])
    expect(w.requests()).toHaveLength(1)
    w.limits.record([{ window: 'five_hour', state: { ...warning(), status: 'allowed' } }])
    w.answers([])
    expect((await asked(w)).shows).toEqual([])
    expect(w.requests()).toHaveLength(2)
  })

  it('the commands, the answer and the history are in no log line and in no error, also when the assist process fails', async () => {
    const logged: unknown[][] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args))
    }
    const state: ShellState = { ...STATE, commands: ['echo history-marker-zz'] }
    const w = world()
    w.answers([{ feature: 'next', answer: 'echo answer-marker-zz' }])
    expect((await asked(w, { state })).shows).toEqual(['echo answer-marker-zz'])
    const broken = world({ backend: () => Promise.reject(new Error('cannot start for echo history-marker-zz answer-marker-zz')) })
    expect((await asked(broken, { state })).shows).toEqual([])
    // What the link catches: a handler whose service could not be had.
    const reply: ShellReply = { show: () => true, status: () => true, insert: () => true }
    const failing = nextCommandFeature({ pauseMs: 0 }).ask({ terminal: KEY, id: 1, line: '', signal: new AbortController().signal }, reply, {
      shellState: () => state,
      assist: () => Promise.reject(new Error('no service for echo history-marker-zz')),
    })
    await expect(Promise.resolve(failing)).rejects.toThrow()
    expect(logged.length).toBeGreaterThan(0)
    const text = JSON.stringify(logged.map((call) => call.map((each) => (each instanceof Error ? `${each.name} ${each.message} ${each.stack}` : each))))
    expect(text).not.toContain('marker-zz')
    expect(sdkModule.loaded).toBe(0)
  })
})

// ---- a real zsh ----------------------------------------------------------------------------------------

/** One ask of a shell as main got it, and what the handler answered. */
interface SeenAsk {
  ask: ShellAsk
  shows: string[]
  finished: boolean
}

interface StartOptions {
  world?: World
  pauseMs?: number
  /** False: the shell gets no socket, as when it could not be opened. */
  link?: boolean
}

/** A registry of Terminals with the shell integration over the temporary HOME, the link to their shells and the assist service. */
async function start(options: StartOptions = {}) {
  const w = options.world ?? world()
  const integration = new ShellIntegration()
  integrations.push(integration)
  const base: Env = { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8', SHELL: zshPath() }
  const asks: SeenAsk[] = []
  const feature = nextCommandFeature({ pauseMs: options.pauseMs ?? PAUSE_MS })
  /** The handler, with every ask and every answer seen by the test. */
  const watched: FeatureLoader = () =>
    Promise.resolve({
      feature: feature.feature,
      ask: async (ask, reply, context) => {
        const seen: SeenAsk = { ask, shows: [], finished: false }
        asks.push(seen)
        try {
          await feature.ask(ask, { ...reply, show: (text) => (seen.shows.push(text), reply.show(text)) }, context)
        } finally {
          seen.finished = true
        }
      },
    } satisfies ShellFeature)
  const link = new ShellLink({
    settings: () => Promise.resolve({ current: () => w.service.state().settings, subscribe: (listener) => w.service.subscribe(() => listener()) }),
    context: { shellState: (terminal) => registry.shellState(terminal), assist: () => Promise.resolve(w.service) },
    features: { [NEXT_MODULE]: watched },
  })
  links.push(link)
  const spawn: SpawnPty = (file, args, spawnOptions) => spawnShellPty(file, args, spawnOptions)
  const registry: TerminalRegistry = new TerminalRegistry({
    env: () => Promise.resolve(base),
    killGraceMs: 1000,
    integration,
    spawn,
    ...(options.link === false ? {} : { assist: link }),
  })
  registries.push(registry)
  const events: { key: string; event: ShellEvent }[] = []
  registry.onShellEvent((key, event) => events.push({ key, event }))
  const t = await openTerminal(registry, events)
  if (options.link === false) await t.prompt()
  else {
    await t.prompt()
    await vi.waitFor(() => expect(link.connected(KEY)).toBe(true), WAIT)
  }
  /** Waits for the ask number `count` (1 for the first), once main has it. */
  const askNumber = async (count: number) => {
    await vi.waitFor(() => expect(asks.length).toBeGreaterThanOrEqual(count), WAIT)
    return asks[count - 1] as SeenAsk
  }
  return { ...w, registry, link, asks, askNumber, t }
}

async function openTerminal(registry: TerminalRegistry, allEvents: { key: string; event: ShellEvent }[]) {
  const chunks: string[] = []
  const sink: TerminalSink = { output: (data) => chunks.push(data), exit: () => undefined, started: () => undefined }
  const client = {}
  await registry.open(KEY, { cwd: root, cols: 120, rows: 30 }, client, sink)
  const count = (type: ShellEvent['type']) => allEvents.filter((each) => each.key === KEY && each.event.type === type).length
  const text = () => chunks.join('')
  const type = (data: string) => registry.write(KEY, data, client)
  /** Waits until the shell has printed nothing for `quietMs`. */
  const settle = async (quietMs = 150) => {
    let length = -1
    let since = Date.now()
    await vi.waitFor(() => {
      if (text().length !== length) {
        length = text().length
        since = Date.now()
      }
      expect(Date.now() - since).toBeGreaterThanOrEqual(quietMs)
    }, WAIT)
  }
  /** What zsh draws when it draws the line anew (Ctrl+L): the prompt, the line and the grey text after it. */
  const redrawn = async () => {
    await settle()
    const from = text().length
    type(CTRL_L)
    // eslint-disable-next-line no-control-regex -- the clear-screen sequence starts with ESC.
    await vi.waitFor(() => expect(text().slice(from)).toMatch(/\x1b\[2J[\s\S]*zle[%#] /), WAIT)
    await settle()
    const after = text().slice(from)
    // eslint-disable-next-line no-control-regex -- cursor movements start with ESC.
    return shown(after.slice(after.lastIndexOf('\x1b[2J'))).replace(/(?:\x1b\[\d*D|\x08)+$/, '')
  }
  const prompts = () => count('prompt')
  return {
    text,
    type,
    settle,
    redrawn,
    prompts,
    state: () => registry.shellState(KEY),
    prompt: async (atLeast = 1) => {
      await vi.waitFor(() => expect(prompts(), `prompts in ${JSON.stringify(text().slice(-2000))}`).toBeGreaterThanOrEqual(atLeast), WAIT)
    },
    /** Types one command line and waits until it finished and the next prompt is shown. */
    run: async (line: string) => {
      const finished = count('command-finished')
      const before = prompts()
      type(`${line}\r`)
      await vi.waitFor(() => {
        expect(count('command-finished')).toBe(finished + 1)
        expect(prompts()).toBeGreaterThan(before)
      }, WAIT)
      return registry.shellState(KEY)?.lastOutput ?? ''
    },
    /** Waits until zsh has drawn `grey` in grey, then answers the line drawn anew. */
    greyShown: async (grey: string) => {
      await vi.waitFor(() => expect(text()).toMatch(new RegExp(`${GREY}${escapeRegExp(grey)}`)), WAIT)
      return redrawn()
    },
  }
}

describe('Next command on a real zsh', () => {
  beforeEach(needsZsh)

  it('after `git status` in a repository the answer of the model is grey on the empty line; the request has the command, its exit code, the branch and the folder, and no output', async () => {
    const { t, answers, requests, requestsText, askNumber, asks } = await start()
    answers([{ feature: 'next', answer: 'git add -A', delayMs: 300 }])
    // The first prompt of a shell follows no command: nothing is asked.
    await sleep(SEVERAL_PAUSES_MS)
    expect(asks).toEqual([])
    const output = await t.run('git status')
    expect(output).toContain(BRANCH)
    const ask = await askNumber(1)
    expect(ask.ask.line).toBe('')
    expect(await t.greyShown('git add -A')).toMatch(lineWithGrey('', 'git add -A'))
    expect(ask.shows).toEqual(['git add -A'])
    expect(requests()).toEqual([
      {
        feature: 'next',
        model: 'sonnet',
        context: { line: '', request: null, cwd: root, commands: ['git status'], branch: BRANCH, exitCode: 0, output: null },
        cancelled: false,
        cold: false,
      },
    ])
    // What `git status` printed did not go to the model.
    expect(requestsText()).not.toContain('No commits yet')
    expect(output).toContain('No commits yet')
    expect(asks).toHaveLength(1)
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('Enter on the empty line with the grey answer runs nothing, and the next prompt asks nothing', async () => {
    const { t, answers, asks, askNumber } = await start()
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run('echo worfy-next-1')
    await askNumber(1)
    await t.greyShown(ANSWER)
    const prompts = t.prompts()
    t.type('\r')
    await t.prompt(prompts + 1)
    await sleep(SEVERAL_PAUSES_MS)
    expect(shown(t.text())).not.toMatch(RAN_OUTPUT)
    expect(t.state()?.commands).toEqual(['echo worfy-next-1'])
    // An empty line ran no command: the prompt after it is not one to ask on.
    expect(asks).toHaveLength(1)
    expect(await t.redrawn()).toMatch(lineAlone(''))
  })

  it('→ takes the answer into the line and nothing runs until Enter', async () => {
    const { t, answers, askNumber, asks } = await start()
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run('echo worfy-next-1')
    await askNumber(1)
    await t.greyShown(ANSWER)
    t.type(RIGHT)
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone(ANSWER))
    expect(line).not.toMatch(ANY_GREY)
    await sleep(SEVERAL_PAUSES_MS)
    expect(shown(t.text())).not.toMatch(RAN_OUTPUT)
    expect(await t.run('')).toContain(RAN)
    expect(shown(t.text())).toMatch(RAN_OUTPUT)
    // That was a command: the prompt after it asks again.
    await askNumber(2)
    expect(asks).toHaveLength(2)
  })

  it('typing `x` hides the grey text; typing the start of the answer keeps the rest of it grey; neither asks again', async () => {
    const { t, answers, askNumber, asks } = await start()
    answers([{ feature: 'next', answer: 'npm test --watch' }])
    await t.run('echo worfy-next-1')
    await askNumber(1)
    await t.greyShown('npm test --watch')
    t.type('npm')
    expect(await t.redrawn()).toMatch(lineWithGrey('npm', ' test --watch'))
    t.type(' x')
    const other = await t.redrawn()
    expect(other).toMatch(lineAlone('npm x'))
    expect(other).not.toMatch(ANY_GREY)

    // Back to the empty line: that is not a new prompt, and nothing is asked again.
    t.type(BACKSPACE.repeat(5))
    await sleep(SEVERAL_PAUSES_MS)
    const empty = await t.redrawn()
    expect(empty).toMatch(lineAlone(''))
    expect(empty).not.toMatch(ANY_GREY)
    expect(asks).toHaveLength(1)

    // A first key that is not the answer's at all hides it as well.
    await t.run('echo worfy-next-2')
    await askNumber(2)
    await t.greyShown('npm test --watch')
    t.type('x')
    const hidden = await t.redrawn()
    expect(hidden).toMatch(lineAlone('x'))
    expect(hidden).not.toMatch(ANY_GREY)
    expect(asks).toHaveLength(2)
  })

  it('a key before the answer cancels the ask: the request is closed and its answer is not shown', async () => {
    const { t, answers, askNumber, claims, requests } = await start()
    answers([{ feature: 'next', answer: ANSWER, delayMs: 1_500 }])
    await t.run('echo worfy-next-1')
    const ask = await askNumber(1)
    // The request is with the model, which takes 1.5 s to answer.
    await vi.waitFor(() => expect(claims()).toBe(1), WAIT)
    const from = t.text().length
    t.type('l')
    await vi.waitFor(() => expect(ask.ask.signal.aborted).toBe(true), WAIT)
    await vi.waitFor(() => expect(ask.finished).toBe(true), WAIT)
    await sleep(1_500)
    expect(await t.redrawn()).toMatch(lineAlone('l'))
    expect(shown(t.text().slice(from))).not.toContain(RAN)
    expect(ask.shows).toEqual([])
    expect(requests()).toMatchObject([{ feature: 'next', cancelled: true }])
  })

  it('a key during the pause cancels the ask before the model is asked', async () => {
    const { t, answers, askNumber, claims, requests } = await start({ pauseMs: 1_000 })
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run('echo worfy-next-1')
    const ask = await askNumber(1)
    t.type('l')
    await vi.waitFor(() => expect(ask.finished).toBe(true), WAIT)
    await sleep(1_200)
    expect(claims()).toBe(0)
    expect(requests()).toEqual([])
  })

  it('Esc hides the grey answer and asks nothing again', async () => {
    const { t, answers, askNumber, asks } = await start()
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run('echo worfy-next-1')
    await askNumber(1)
    await t.greyShown(ANSWER)
    t.type(ESC)
    // zsh waits KEYTIMEOUT (0.4 s) for the rest of a longer sequence.
    await sleep(600)
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone(''))
    expect(line).not.toMatch(ANY_GREY)
    await sleep(SEVERAL_PAUSES_MS)
    expect(asks).toHaveLength(1)
  })

  it('with Haiku in the settings the request goes to Haiku', async () => {
    const { t, answers, askNumber, requests } = await start({ world: world({ settings: { nextCommandModel: 'haiku' } }) })
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run('echo worfy-next-1')
    await askNumber(1)
    await t.greyShown(ANSWER)
    expect(requests()).toMatchObject([{ feature: 'next', model: 'haiku', cancelled: false }])
  })

  it('with Next command off the shell asks nothing; with the Limits at allowed_warning the model is not asked and nothing is shown', async () => {
    const off = world({ settings: { nextCommand: false } })
    const { t, answers, asks, requests } = await start({ world: off })
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run('echo worfy-next-1')
    await sleep(SEVERAL_PAUSES_MS)
    expect(asks).toEqual([])
    expect(requests()).toEqual([])

    // On again: the next command is followed by an ask, which the Limits stop in main.
    off.service.setSettings({ nextCommand: true })
    off.limits.record([{ window: 'five_hour', state: warning() }])
    await t.settle()
    await t.run('echo worfy-next-2')
    await vi.waitFor(() => expect(asks.length === 1 && asks[0]?.finished).toBe(true), WAIT)
    await sleep(SEVERAL_PAUSES_MS)
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone(''))
    expect(line).not.toMatch(ANY_GREY)
    expect(requests()).toEqual([])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('after a command that starts with a space nothing is asked; Ctrl+C on an empty line asks nothing', async () => {
    const { t, answers, asks, askNumber } = await start()
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run(' echo worfy-next-private')
    await sleep(SEVERAL_PAUSES_MS)
    expect(asks).toEqual([])
    const prompts = t.prompts()
    t.type(CTRL_C)
    await t.prompt(prompts + 1)
    await sleep(SEVERAL_PAUSES_MS)
    expect(asks).toEqual([])
    // A command without the space is followed by an ask.
    await t.run('echo worfy-next-1')
    await askNumber(1)
  })

  it('a prompt that comes with a line already in it (print -z) asks nothing', async () => {
    const { t, answers, asks, askNumber } = await start()
    answers([{ feature: 'next', answer: ANSWER }])
    await t.run('print -z echo worfy-next-pushed')
    await sleep(SEVERAL_PAUSES_MS)
    expect(await t.redrawn()).toMatch(lineAlone('echo worfy-next-pushed'))
    expect(asks).toEqual([])
    // Run, it is a command like any other: the empty prompt after it asks.
    t.type('\r')
    await askNumber(1)
  })

  it('a command that failed carries its exit code; the Suggestion from history still works after the grey answer', async () => {
    const { t, answers, askNumber, requests } = await start()
    answers([{ feature: 'next', answer: 'ls -la' }])
    await t.run('echo worfy-next-hist')
    await askNumber(1)
    await t.greyShown('ls -la')
    await t.run('false')
    await askNumber(2)
    await vi.waitFor(() => expect(requests()).toHaveLength(2), WAIT)
    expect(requests()[1]).toMatchObject({ feature: 'next', context: { commands: ['echo worfy-next-hist', 'false'], exitCode: 1 } })
    await t.greyShown('ls -la')
    // The history goes first: what is typed is its Suggestion, not the model's.
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-next-hist'))
  })

  it('without a socket the script is silent: commands run, the history works, zsh prints no error', async () => {
    const { t, asks } = await start({ link: false })
    await t.run('echo worfy-next-1')
    await sleep(SEVERAL_PAUSES_MS)
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-next-1'))
    expect(asks).toEqual([])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('a zsh that edits no line reads the script after the widget of rc.d/10-assist.zsh and sets nothing up, without an error', () => {
    const scripts = join(import.meta.dirname, '../../src/main/terminal/zsh/rc.d')
    const read = spawnSync(
      zshPath(),
      ['-f', '-c', `source '${scripts}/10-assist.zsh'; source '${scripts}/30-next-command.zsh'; print -r -- "set-up:\${+functions[_worfy_next_line]}:\${#__worfy_assist_line_hooks}"`],
      { encoding: 'utf8', env: { PATH: SYSTEM_PATH, HOME: home } },
    )
    expect(read.stderr).toBe('')
    expect(read.stdout).toBe('set-up:0:0\n')
    expect(read.status).toBe(0)
  })
})
