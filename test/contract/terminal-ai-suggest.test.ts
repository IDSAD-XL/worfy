// The Suggestion of Terminal AI from the model, when the history of commands has nothing: the
// widget of rc.d/20-suggest-ai.zsh on a real zsh in a real pseudo-terminal (node-pty under
// Electron's Node), the handler of src/main/terminal-ai/features/suggest.ts and the assist service
// between them.
//
// The assist process is the fake of fake-backend.ts, given to the service as its backend: answers
// come from a file the test writes, and every request is one line of a log the test reads. Claude
// Code is never started and the subscription is never spent. HOME and the user's files are in a
// temporary folder: the real ~/.zshrc and ~/.zsh_history are never read or written.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
import { suggestionRest } from '../../src/main/terminal-ai/features/suggest'
import { featureModules, ShellLink, type FeatureLoader, type ShellAsk, type ShellFeature, type ShellReply } from '../../src/main/terminal-ai/shell-link'
import { TerminalAiSettingsStore } from '../../src/main/terminal-ai/settings'
import { REDACTED } from '../../src/shared/terminal-ai/redact'
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
const SUGGEST_MODULE = './features/suggest.ts'
/** The pause of the widget in these tests; the widget's own is 600 ms. */
const PAUSE_MS = 150
/** Long enough for a timer of PAUSE_MS to have fired and its ask to have reached main. */
const SEVERAL_PAUSES_MS = PAUSE_MS * 4
const BRANCH = 'worfy-suggest-branch'

/** The keys as xterm.js 6.0.0 sends them (node_modules/@xterm/xterm/src/common/input/Keyboard.ts). */
const RIGHT = '\x1b[C'
const ALT_RIGHT = '\x1b[1;3C'
const ESC = '\x1b'
const CTRL_L = '\x0c'
const CTRL_U = '\x15'

let home: string
let root: string
let scratch: string
const registries: TerminalRegistry[] = []
const integrations: ShellIntegration[] = []
const links: ShellLink[] = []
const services: AssistService[] = []

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-suggest-home-')))
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-suggest-project-')))
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-suggest-data-')))
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
/** The line of the prompt with `typed` in the default colour and `grey` after it in grey. */
const lineWithGrey = (typed: string, grey: string) => new RegExp(`zle[%#] ${escapeRegExp(typed)}${GREY}${escapeRegExp(grey)}\\x1b\\[39m`)
/** The line of the prompt with `typed` and nothing after it. */
const lineAlone = (typed: string) => new RegExp(`zle[%#] ${escapeRegExp(typed)}(?:\\x1b\\[K|\\x1b\\[J)*$`)
/** What zsh prints when something of the scripts went wrong. */
const ZSH_ERROR = /zsh: |command not found|bad file descriptor|no such|not found|write error|broken pipe|zselect|sysread|parse error/i

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

/** The assist service of one test. Only Suggestion is on: no other feature of Terminal AI asks anything here. */
function world(options: { backend?: () => Promise<AssistBackend>; settings?: TerminalAiSettingsPatch } = {}): World {
  const dataDir = join(scratch, 'data')
  const answersFile = join(scratch, 'answers.json')
  const logFile = join(scratch, 'requests.jsonl')
  const limits = new LimitsTracker({ dataDir })
  const fake = fakeAssistBackend({ answersFile, logFile })
  let claims = 0
  /** The fake, counting the requests it is given. */
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
  service.setSettings({ nextCommand: false, commandRequest: false, fix: false, ...options.settings })
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

/** The handler of the feature, loaded as main loads it. */
async function suggestFeature(): Promise<ShellFeature> {
  const load = featureModules[SUGGEST_MODULE]
  if (load === undefined) throw new Error(`${SUGGEST_MODULE} is not among the modules of the features`)
  return (await load()) as ShellFeature
}

/** One ask of a shell as main got it, and what the handler answered. */
interface SeenAsk {
  ask: ShellAsk
  shows: string[]
  /** True once the handler is through with the ask. */
  finished: boolean
}

// ---- a real zsh ----------------------------------------------------------------------------------------

interface StartOptions {
  world?: World
  /** The pause of the widget; null leaves the widget's own. */
  pauseMs?: number | null
  env?: Env
}

/** Ctrl+X g and Ctrl+X p: the keys of the tests' own script (TEST_KEYS). */
const PROBE_KEY = '\x18g'
const PUT_KEY = '\x18p'
const PUT_LINE = 'ls -la put-by-a-script'

/**
 * A script of the tests' own, read after the widget's. Ctrl+X g writes what the widget holds into
 * `file`, without changing the line: the line it holds as given, and the pipe and the subshell of
 * its timer. Ctrl+X p puts a line the way the widget's header tells a script of another feature to.
 * Their names start with _worfy_, as worfy's own: rc.d/10-assist.zsh does not give the link up around them.
 */
const testKeys = (file: string) =>
  [
    `_worfy_test_probe() { builtin print -r -- "given:[$__worfy_suggest_given] timer:[$__worfy_suggest_fd] pid:[$__worfy_suggest_pid]" >| ${file} }`,
    'zle -N _worfy_test_probe',
    "bindkey '^Xg' _worfy_test_probe",
    `_worfy_test_put() { BUFFER='${PUT_LINE}'; CURSOR=$#BUFFER; __worfy_suggest_given=$BUFFER; _worfy_assist_changed }`,
    'zle -N _worfy_test_put',
    "bindkey '^Xp' _worfy_test_put",
  ].join('\n')

/** A registry of Terminals with the shell integration over the temporary HOME, the link to their shells and the assist service. */
async function start(options: StartOptions = {}) {
  const w = options.world ?? world()
  const integration = new ShellIntegration()
  integrations.push(integration)
  const base: Env = { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8', SHELL: zshPath(), ...options.env }
  const asks: SeenAsk[] = []
  const real = suggestFeature()
  /** The real handler, with every ask and every answer seen by the test. */
  const watched: FeatureLoader = async () => {
    const feature = await real
    const module: ShellFeature = {
      feature: feature.feature,
      ask: async (ask, reply, context) => {
        const seen: SeenAsk = { ask, shows: [], finished: false }
        asks.push(seen)
        const seeing: ShellReply = {
          ...reply,
          show: (text) => {
            seen.shows.push(text)
            return reply.show(text)
          },
        }
        try {
          await feature.ask(ask, seeing, context)
        } finally {
          seen.finished = true
        }
      },
    }
    return module
  }
  const link = new ShellLink({
    settings: () => Promise.resolve({ current: () => w.service.state().settings, subscribe: (listener) => w.service.subscribe(() => listener()) }),
    context: { shellState: (terminal) => registry.shellState(terminal), assist: () => Promise.resolve(w.service) },
    features: { [SUGGEST_MODULE]: watched },
  })
  links.push(link)
  const spawn: SpawnPty = (file, args, spawnOptions) => spawnShellPty(file, args, spawnOptions)
  const registry: TerminalRegistry = new TerminalRegistry({ env: () => Promise.resolve(base), killGraceMs: 1000, integration, spawn, assist: link })
  registries.push(registry)
  const events: { key: string; event: ShellEvent }[] = []
  registry.onShellEvent((key, event) => events.push({ key, event }))

  // A script read before the widget's own sets its pause, as the widget's header says a test may.
  const pauseMs = options.pauseMs === undefined ? PAUSE_MS : options.pauseMs
  const dir = await integration.prepare()
  await mkdir(join(dir, 'rc.d'), { recursive: true })
  if (pauseMs !== null) await writeFile(join(dir, 'rc.d', '15-test-pause.zsh'), `__worfy_suggest_pause_ms=${pauseMs}\n`)
  const probeFile = join(scratch, 'probe.txt')
  await writeFile(join(dir, 'rc.d', '90-test.zsh'), `${testKeys(probeFile)}\n`)

  const t = await openTerminal(registry, link, events)
  await t.connected()
  /** What the widget holds right now: the line it has as given, the pipe of its timer and the timer's subshell. */
  const probe = async () => {
    removeTestTree(probeFile)
    t.type(PROBE_KEY)
    await vi.waitFor(() => expect(existsSync(probeFile) && readFileSync(probeFile, 'utf8').endsWith(']\n')).toBe(true), WAIT)
    const found = /^given:\[(.*)\] timer:\[(\d*)\] pid:\[(\d*)\]\n$/s.exec(readFileSync(probeFile, 'utf8'))
    if (found === null) throw new Error(`the probe wrote ${JSON.stringify(readFileSync(probeFile, 'utf8'))}`)
    return { given: found[1] ?? '', timer: found[2] ?? '', pid: found[3] ?? '' }
  }
  /** The ask about `line`, once main has it. */
  const askAbout = async (line: string) => {
    await vi.waitFor(() => expect(asks.map((each) => each.ask.line)).toContain(line), WAIT)
    const found = asks.findLast((each) => each.ask.line === line)
    if (found === undefined) throw new Error('unreachable')
    return found
  }
  return { ...w, registry, integration, link, asks, lines: () => asks.map((each) => each.ask.line), askAbout, probe, t }
}

async function openTerminal(registry: TerminalRegistry, link: ShellLink, allEvents: { key: string; event: ShellEvent }[], key = KEY) {
  const chunks: string[] = []
  let exit: number | null = null
  const sink: TerminalSink = {
    output: (data) => chunks.push(data),
    exit: (exitCode) => (exit = exitCode),
    started: () => undefined,
  }
  const client = {}
  await registry.open(key, { cwd: root, cols: 120, rows: 30 }, client, sink)
  const events = () => allEvents.filter((each) => each.key === key).map((each) => each.event)
  const count = (type: ShellEvent['type']) => events().filter((event) => event.type === type).length
  const text = () => chunks.join('')
  const type = (data: string) => registry.write(key, data, client)
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
  const prompt = async (prompts = 1) => {
    await vi.waitFor(() => expect(count('prompt'), `prompts in ${JSON.stringify(text().slice(-2000))}`).toBeGreaterThanOrEqual(prompts), WAIT)
  }
  /**
   * What zsh draws when it draws the line anew (Ctrl+L, clear-screen): the prompt, the typed text
   * and the grey text after it, as one piece. Drawing anew does not change the line: no timer of
   * the widget starts over.
   */
  const redrawn = async () => {
    await settle()
    const from = text().length
    type(CTRL_L)
    // eslint-disable-next-line no-control-regex -- the clear-screen sequence starts with ESC.
    await vi.waitFor(() => expect(text().slice(from)).toMatch(/\x1b\[2J[\s\S]*zle[%#] /), WAIT)
    await settle()
    const after = text().slice(from)
    // The cursor goes back over the grey text at the end: that is not part of the line.
    // eslint-disable-next-line no-control-regex -- cursor movements start with ESC.
    return shown(after.slice(after.lastIndexOf('\x1b[2J'))).replace(/(?:\x1b\[\d*D|\x08)+$/, '')
  }
  return {
    key,
    text,
    type,
    settle,
    events,
    redrawn,
    state: () => registry.shellState(key),
    exited: () => exit,
    prompt,
    /** Waits for the prompt and for the shell's hello on the socket. */
    connected: async () => {
      await prompt()
      await vi.waitFor(() => expect(link.connected(key)).toBe(true), WAIT)
    },
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
    /** Waits until zsh has drawn `grey` in grey after what was typed, then answers the line drawn anew. */
    greyShown: async (grey: string) => {
      const pattern = new RegExp(`${GREY}${escapeRegExp(grey)}`)
      await vi.waitFor(() => expect(text()).toMatch(pattern), WAIT)
      return redrawn()
    },
  }
}

const TYPED = 'docker run --rm -it ub'
const ANSWER = 'docker run --rm -it ubuntu bash'

// ---- the rest of the answer ----------------------------------------------------------------------------

describe('what is shown of an answer', () => {
  it('is the answer without what was typed: the lines of the spike keep the space before a new word', () => {
    expect(suggestionRest('npm run', 'npm run dev')).toBe(' dev')
    expect(suggestionRest('grep -rn "TODO" --include', 'grep -rn "TODO" --include="*.ts"')).toBe('="*.ts"')
    expect(suggestionRest('git log --one', 'git log --oneline')).toBe('line')
    expect(suggestionRest(TYPED, ANSWER)).toBe('untu bash')
    expect(suggestionRest('kubectl get pods -n', 'kubectl get pods -n default')).toBe(' default')
  })

  it('is nothing for an answer that does not start with what was typed: a tail alone is never glued to the line', () => {
    // What the spike got when it asked for the tail: glued to the line it would be `npm rundev`.
    expect(suggestionRest('npm run', 'dev')).toBeNull()
    expect(suggestionRest('npm run', ' dev')).toBeNull()
    expect(suggestionRest('tar -czf backup.tar.gz', '.')).toBeNull()
    expect(suggestionRest('git log --one', 'git log --graph')).toBeNull()
    expect(suggestionRest('Npm run', 'npm run dev')).toBeNull()
  })

  it('is nothing for an answer that adds nothing', () => {
    expect(suggestionRest('npm run', 'npm run')).toBeNull()
    expect(suggestionRest('npm run dev', 'npm run')).toBeNull()
    expect(suggestionRest('npm run', '')).toBeNull()
  })

  it('an answer `npm rundev` to `npm run` is shown as `dev`: a whole line that starts with what was typed', () => {
    // The acceptance of the ticket wanted this answer dropped. Nothing in the two strings tells it
    // from `docker run --rm -it ub` → `docker run --rm -it ubuntu bash` or `git log --one` →
    // `git log --oneline`, where a letter goes on after a letter as well and the answer is right; a
    // rule that dropped this one would drop those. The model is asked for the whole line and no tail
    // is ever glued to what was typed, so `npm rundev` here is the model's own line. One function,
    // suggestionRest, holds the rule: this is the place to change it.
    expect(suggestionRest('npm run', 'npm rundev')).toBe('dev')
  })
})

// ---- the handler, without a shell ----------------------------------------------------------------------

const STATE: ShellState = { cwd: '/Users/me/work', awaitingInput: true, commandRunning: false, altScreen: false, exitCode: 0, commands: ['ls -la'], lastOutput: null }

/** Calls the handler as the link does, with a shell whose state the test gives. */
async function asked(w: World, line: string, state: ShellState | null = STATE, signal: AbortSignal = new AbortController().signal) {
  const feature = await suggestFeature()
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
  await feature.ask({ terminal: KEY, id: 1, line, signal }, reply, { shellState: () => state, assist: () => Promise.resolve(w.service) })
  return { shows, others }
}

describe('the handler of the feature', () => {
  it('is found by main under the name suggest', async () => {
    expect(Object.keys(featureModules)).toContain(SUGGEST_MODULE)
    expect((await suggestFeature()).feature).toBe('suggest')
  })

  it('asks Haiku with the line, the folder, the last commands, the branch and the exit code, and shows the rest of the answer', async () => {
    const w = world()
    w.answers([{ feature: 'suggest', match: 'npm run', answer: 'npm run dev' }])
    const state: ShellState = { ...STATE, cwd: root, exitCode: 2, commands: ['npm install', 'npm test'], lastOutput: 'output-of-the-last-command' }
    const { shows, others } = await asked(w, 'npm run', state)
    expect(shows).toEqual([' dev'])
    // Nothing is put into the line and no note is shown: the Suggestion is grey text or nothing.
    expect(others).toEqual([])
    expect(w.requests()).toEqual([
      {
        feature: 'suggest',
        model: 'haiku',
        context: { line: 'npm run', request: null, cwd: root, commands: ['npm install', 'npm test'], branch: BRANCH, exitCode: 2, output: null },
        cancelled: false,
        cold: false,
      },
    ])
    expect(w.requestsText()).not.toContain('output-of-the-last-command')
  })

  it('shows nothing for an answer that does not start with the line, for an empty answer and for an answer equal to the line', async () => {
    const w = world()
    w.answers([
      { match: 'tail-only', answer: 'dev' },
      { match: 'same', answer: 'echo same' },
      { match: 'wrapped', answer: '`echo wrapped up`' },
    ])
    expect((await asked(w, 'npm run tail-only')).shows).toEqual([])
    expect((await asked(w, 'echo same')).shows).toEqual([])
    // No entry of the answers file matches: the fake answers with nothing.
    expect((await asked(w, 'echo nobody-knows')).shows).toEqual([])
    // The backticks a model puts around a command are not part of it.
    expect((await asked(w, 'echo wrapped')).shows).toEqual([' up'])
    expect(w.requests()).toHaveLength(4)
  })

  it('sends nothing while a command runs, on the alternate screen, without a shell state and without a folder', async () => {
    const w = world()
    w.answers([{ answer: 'echo anything at all' }])
    expect((await asked(w, 'echo anything', { ...STATE, commandRunning: true })).shows).toEqual([])
    expect((await asked(w, 'echo anything', { ...STATE, altScreen: true })).shows).toEqual([])
    expect((await asked(w, 'echo anything', null)).shows).toEqual([])
    expect((await asked(w, 'echo anything', { ...STATE, cwd: null })).shows).toEqual([])
    expect(w.requests()).toEqual([])
    // The same line from a shell at its prompt is answered.
    expect((await asked(w, 'echo anything')).shows).toEqual([' at all'])
  })

  it('sends nothing for an empty line, a line of several lines and a line that starts with a space', async () => {
    const w = world()
    w.answers([{ answer: 'echo first\necho second and more' }, { answer: ' echo secret and more' }])
    expect((await asked(w, '')).shows).toEqual([])
    expect((await asked(w, 'echo first\necho second')).shows).toEqual([])
    expect((await asked(w, ' echo secret')).shows).toEqual([])
    expect(w.requests()).toEqual([])
  })

  it('sends nothing above 80 % of the 5 hour window and with "Ask Claude when history has nothing" off', async () => {
    const w = world()
    w.answers([{ answer: 'echo anything at all' }])
    w.limits.record([{ window: 'five_hour', state: { utilization: 0.85, resetsAt: Date.now() / 1000 + 3600, status: 'allowed', receivedAt: Date.now(), source: 'sdk' } }])
    expect((await asked(w, 'echo anything')).shows).toEqual([])
    w.limits.record([{ window: 'five_hour', state: { utilization: 0.1, resetsAt: Date.now() / 1000 + 3600, status: 'allowed', receivedAt: Date.now(), source: 'sdk' } }])
    w.service.setSettings({ suggestionAsksModel: false })
    expect((await asked(w, 'echo anything')).shows).toEqual([])
    expect(w.requests()).toEqual([])
    w.service.setSettings({ suggestionAsksModel: true })
    expect((await asked(w, 'echo anything')).shows).toEqual([' at all'])
  })

  it('keeps at most 20 commands, redacts a token in them, and sends neither the output of commands nor the environment', async () => {
    const w = world()
    w.answers([{ answer: 'echo anything at all' }])
    const token = `ghp_${'Zz90'.repeat(9)}`
    vi.stubEnv('WORFY_SUGGEST_TEST_SECRET', 'environment-marker-zz')
    const commands = [...Array.from({ length: 24 }, (_, index) => `: step-${index + 1}`), `export GITHUB_TOKEN=${token}`]
    await asked(w, 'echo anything', { ...STATE, cwd: root, commands, lastOutput: 'output-marker-zz' })
    const [request] = w.requests()
    expect(request?.context.commands).toEqual([...commands.slice(-20, -1), `export GITHUB_TOKEN=${REDACTED}`])
    expect(w.requestsText()).not.toContain(token)
    expect(w.requestsText()).not.toContain('output-marker-zz')
    expect(w.requestsText()).not.toContain('environment-marker-zz')
    expect(Object.keys(request?.context ?? {}).sort()).toEqual(['branch', 'commands', 'cwd', 'exitCode', 'line', 'output', 'request'])
    vi.unstubAllEnvs()
  })

  it('an ask the shell cancelled closes its request and shows nothing', async () => {
    const w = world()
    // The answer would come well within the 5 s a Suggestion may take: only the cancel stops it.
    w.answers([{ answer: 'echo anything at all', delayMs: 1_500 }])
    const abort = new AbortController()
    const pending = asked(w, 'echo anything', STATE, abort.signal)
    // The prompt went out: the cancel meets a request in flight.
    await vi.waitFor(() => expect(w.claims()).toBe(1), WAIT)
    abort.abort()
    expect((await pending).shows).toEqual([])
    expect(w.requests()).toMatchObject([{ feature: 'suggest', cancelled: true }])
  })

  it('the line, the history and the answer are in no log line and in no error, also when the assist process fails', async () => {
    const logged: unknown[][] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args))
    }
    const state: ShellState = { ...STATE, commands: ['echo history-marker-zz'] }
    const w = world()
    w.answers([{ match: 'line-marker-zz', answer: 'echo line-marker-zz answer-marker-zz' }])
    expect((await asked(w, 'echo line-marker-zz', state)).shows).toEqual([' answer-marker-zz'])
    // An answer that is dropped, and a refusal.
    expect((await asked(w, 'echo line-marker-zz', { ...state, commandRunning: true })).shows).toEqual([])
    w.answers([{ answer: 'answer-marker-zz' }])
    expect((await asked(w, 'echo line-marker-zz', state)).shows).toEqual([])

    // A backend that cannot be made, with an error that quotes everything.
    const broken = world({ backend: () => Promise.reject(new Error('cannot start for echo line-marker-zz history-marker-zz answer-marker-zz')) })
    expect((await asked(broken, 'echo line-marker-zz', state)).shows).toEqual([])
    // The same through the link, which catches what a handler throws.
    const feature = await suggestFeature()
    const reply: ShellReply = { show: () => true, status: () => true, insert: () => true }
    const failing = feature.ask({ terminal: KEY, id: 1, line: 'echo line-marker-zz', signal: new AbortController().signal }, reply, {
      shellState: () => state,
      assist: () => Promise.reject(new Error('no service for echo line-marker-zz')),
    })
    await expect(Promise.resolve(failing)).rejects.toThrow()

    expect(logged.length).toBeGreaterThan(0)
    const text = JSON.stringify(logged.map((call) => call.map((each) => (each instanceof Error ? `${each.name} ${each.message} ${each.stack}` : each))))
    expect(text).not.toContain('marker-zz')
    expect(sdkModule.loaded).toBe(0)
  })
})

// ---- the widget on a real zsh ----------------------------------------------------------------------------

describe('the Suggestion from the model on a real zsh', () => {
  beforeEach(needsZsh)

  it('without history, after the pause, the answer of the model is shown in grey; → takes it', async () => {
    const { t, answers, requests, askAbout, lines } = await start()
    // The model takes its time, as Haiku does (a second or two in the spike).
    answers([{ feature: 'suggest', match: TYPED, answer: ANSWER, delayMs: 1500 }])
    t.type(TYPED)
    const ask = await askAbout(TYPED)
    // While the answer is awaited nothing is shown: no grey text and no note.
    const waiting = await t.redrawn()
    expect(ask.finished).toBe(false)
    expect(waiting).toMatch(lineAlone(TYPED))
    expect(waiting).not.toMatch(ANY_GREY)

    expect(await t.greyShown('untu bash')).toMatch(lineWithGrey(TYPED, 'untu bash'))
    expect(ask.shows).toEqual(['untu bash'])
    expect(requests()).toMatchObject([{ feature: 'suggest', model: 'haiku', cancelled: false, context: { line: TYPED, cwd: root, branch: BRANCH } }])

    t.type(RIGHT)
    expect(await t.redrawn()).toMatch(lineAlone(ANSWER))
    // The line that was taken is the model's own answer: it is not asked about again.
    await sleep(SEVERAL_PAUSES_MS)
    expect(lines()).toEqual([TYPED])
    expect(requests()).toHaveLength(1)
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('typing while the answer is awaited cancels the ask, and the old answer is not shown', async () => {
    const { t, answers, requests, askAbout, claims } = await start()
    answers([
      { feature: 'suggest', match: `${TYPED}x`, answer: '', delayMs: 0 },
      { feature: 'suggest', match: TYPED, answer: ANSWER, delayMs: 400 },
    ])
    t.type(TYPED)
    const first = await askAbout(TYPED)
    // The request is with the model, which takes 400 ms to answer.
    await vi.waitFor(() => expect(claims()).toBe(1), WAIT)
    expect(first.ask.signal.aborted).toBe(false)
    const from = t.text().length
    t.type('x')
    await vi.waitFor(() => expect(first.ask.signal.aborted).toBe(true), WAIT)
    // The new line is asked about after its own pause; the fake has no answer for it.
    const second = await askAbout(`${TYPED}x`)
    await vi.waitFor(() => expect(first.finished && second.finished).toBe(true), WAIT)
    expect(second.ask.id).toBeGreaterThan(first.ask.id)
    await sleep(400 + SEVERAL_PAUSES_MS)
    expect(await t.redrawn()).toMatch(lineAlone(`${TYPED}x`))
    expect(shown(t.text().slice(from))).not.toContain('untu bash')
    expect(first.shows).toEqual([])
    expect(requests()).toMatchObject([
      { context: { line: TYPED }, cancelled: true },
      { context: { line: `${TYPED}x` }, cancelled: false },
    ])
  })

  it('typing the start of the answer keeps the rest of it grey and asks nothing new', async () => {
    const { t, answers, requests, askAbout, lines } = await start()
    answers([{ feature: 'suggest', match: TYPED, answer: ANSWER, delayMs: 50 }])
    t.type(TYPED)
    await askAbout(TYPED)
    expect(await t.greyShown('untu bash')).toMatch(lineWithGrey(TYPED, 'untu bash'))
    t.type('un')
    expect(await t.redrawn()).toMatch(lineWithGrey(`${TYPED}un`, 'tu bash'))
    await sleep(SEVERAL_PAUSES_MS)
    expect(await t.redrawn()).toMatch(lineWithGrey(`${TYPED}un`, 'tu bash'))
    expect(lines()).toEqual([TYPED])
    // A character that is not the answer's: the grey text goes, and the new line is asked about.
    t.type('!')
    await askAbout(`${TYPED}un!`)
    expect(await t.redrawn()).toMatch(lineAlone(`${TYPED}un!`))
    expect(requests().map((request) => request.context.line)).toEqual([TYPED, `${TYPED}un!`])
  })

  it("with the widget's own pause the model is asked 600 ms after the last key, once; typing faster than that asks nothing", async () => {
    const { t, answers, lines, askAbout } = await start({ pauseMs: null })
    answers([])
    const typedAt: number[] = []
    for (const part of ['doc', 'ker', ' p', 's']) {
      typedAt.push(performance.now())
      t.type(part)
      await sleep(120)
    }
    await askAbout('docker ps')
    const waited = performance.now() - (typedAt.at(-1) ?? 0)
    // Not sooner than the pause after the last key was sent; later is the machine's business.
    expect(waited).toBeGreaterThanOrEqual(600)
    expect(lines()).toEqual(['docker ps'])

    // Keys 120 ms apart for well over the pause, then the line is wiped: nothing is asked.
    for (const part of [' -', '-a', 'l', 'l']) {
      t.type(part)
      await sleep(120)
    }
    t.type(CTRL_U)
    await sleep(1000)
    expect(lines()).toEqual(['docker ps'])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('the request carries the line, the folder, the last 20 commands, the branch and the exit code; no output, no environment, a token redacted', async () => {
    const token = `ghp_${'Zz90'.repeat(9)}`
    const { t, answers, requests, requestsText, askAbout } = await start({ env: { WORFY_SUGGEST_TEST_SECRET: 'environment-marker-zz' } })
    answers([])
    expect(await t.run('print -r -- "$WORFY_SUGGEST_TEST_SECRET"')).toContain('environment-marker-zz')
    // 21 commands, then a private one, then one with a token, then one that prints and fails.
    const steps = Array.from({ length: 21 }, (_, index) => `: step-${index + 1}`)
    for (const step of steps) await t.run(step)
    await t.run(' : private-step')
    await t.run(`export GITHUB_TOKEN=${token}`)
    expect(await t.run('print -r -- "output-$(( 6 * 7 ))-marker"; false')).toContain('output-42-marker')
    t.type('docker ps')
    const ask = await askAbout('docker ps')
    await vi.waitFor(() => expect(ask.finished).toBe(true), WAIT)
    const [request, ...more] = requests()
    expect(more).toEqual([])
    expect(request).toEqual({
      feature: 'suggest',
      model: 'haiku',
      context: {
        line: 'docker ps',
        request: null,
        cwd: root,
        commands: [...steps.slice(-18), `export GITHUB_TOKEN=${REDACTED}`, 'print -r -- "output-$(( 6 * 7 ))-marker"; false'],
        branch: BRANCH,
        exitCode: 1,
        output: null,
      },
      cancelled: false,
      cold: false,
    })
    expect(requestsText()).not.toContain(token)
    expect(requestsText()).not.toContain('output-42-marker')
    expect(requestsText()).not.toContain('environment-marker-zz')
    expect(requestsText()).not.toContain('private-step')
  })

  it('above 80 % of the 5 hour window the model is not asked, and the Suggestion from history goes on', async () => {
    const { t, answers, requests, limits, askAbout } = await start()
    answers([{ answer: 'docker ps --all' }])
    limits.record([{ window: 'five_hour', state: { utilization: 0.85, resetsAt: Date.now() / 1000 + 3600, status: 'allowed', receivedAt: Date.now(), source: 'sdk' } }])
    await t.run('echo worfy-sg-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-sg-1'))
    t.type(`${CTRL_U}docker ps`)
    const ask = await askAbout('docker ps')
    await vi.waitFor(() => expect(ask.finished).toBe(true), WAIT)
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone('docker ps'))
    // Nothing is printed into the Terminal about it: no note, no error.
    expect(line).not.toMatch(ANY_GREY)
    expect(ask.shows).toEqual([])
    expect(requests()).toEqual([])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('with "Ask Claude when history has nothing" off the shell asks nothing; turned on, it asks about the line that stands', async () => {
    const w = world({ settings: { suggestionAsksModel: false } })
    const { t, answers, requests, lines, askAbout, service, probe } = await start({ world: w, pauseMs: 2000 })
    answers([{ answer: 'docker ps --all' }])
    await t.run('echo worfy-sg-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-sg-1'))
    t.type(`${CTRL_U}docker ps`)
    await t.settle()
    // No timer waits for a pause nobody will ask after.
    expect(await probe()).toMatchObject({ timer: '', pid: '' })
    await sleep(2500)
    expect(lines()).toEqual([])
    expect(requests()).toEqual([])
    service.setSettings({ suggestionAsksModel: true })
    await askAbout('docker ps')
    expect(await t.greyShown(' --all')).toMatch(lineWithGrey('docker ps', ' --all'))
    expect(lines()).toEqual(['docker ps'])
  })

  it('a line that starts with a space and a line that starts with `# ` are not asked about', async () => {
    const { t, answers, lines, askAbout, probe } = await start({ pauseMs: 1000 })
    answers([])
    // For neither a timer is started; a line that is asked about has one while its pause lasts.
    t.type(' docker ps')
    await t.settle()
    expect(await probe()).toMatchObject({ timer: '', pid: '' })
    t.type(`${CTRL_U}# list the containers`)
    await t.settle()
    expect(await probe()).toMatchObject({ timer: '', pid: '' })
    await sleep(1500)
    expect(lines()).toEqual([])
    // A `#` that is not the mark of a Command request is a line like any other.
    t.type(`${CTRL_U}#!docker`)
    await t.settle()
    const waiting = await probe()
    expect(waiting.timer).toMatch(/^\d{2,}$/)
    expect(Number(waiting.pid)).toBeGreaterThan(1)
    await askAbout('#!docker')
    expect(await probe()).toMatchObject({ timer: '', pid: '' })
    expect(lines()).toEqual(['#!docker'])
  })

  it('a line main put there with insert is not asked about until the user changes it', async () => {
    const { t, answers, lines, askAbout, link, service, probe } = await start()
    answers([])
    expect(link.push(KEY, { type: 'insert', text: 'git status --short' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('git status --short'))
    // The widget holds the line as given, and no timer waits for it.
    expect(await probe()).toEqual({ given: 'git status --short', timer: '', pid: '' })
    await sleep(SEVERAL_PAUSES_MS)
    expect(lines()).toEqual([])
    // The settings come again while the line stands: it is still the line main put there.
    service.setSettings({ suggestionAsksModel: false })
    service.setSettings({ suggestionAsksModel: true })
    await t.settle()
    await sleep(SEVERAL_PAUSES_MS)
    expect(lines()).toEqual([])
    // What the user adds to it is the user's line.
    t.type(' --branch')
    await askAbout('git status --short --branch')
    expect((await probe()).given).toBe('')
    // So is the same text typed by hand.
    t.type(`${CTRL_U}git status --short`)
    await askAbout('git status --short')
    expect(lines()).toEqual(['git status --short --branch', 'git status --short'])

    // A script of another feature that puts a line itself names it in __worfy_suggest_given.
    t.type(PUT_KEY)
    expect(await t.redrawn()).toMatch(lineAlone(PUT_LINE))
    expect(await probe()).toEqual({ given: PUT_LINE, timer: '', pid: '' })
    await sleep(SEVERAL_PAUSES_MS)
    expect(lines()).toEqual(['git status --short --branch', 'git status --short'])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('while a command runs (`cat` waits for input) what is typed is not asked about', async () => {
    const { t, answers, lines, requests, askAbout } = await start()
    answers([])
    t.type('cat\r')
    await vi.waitFor(() => expect(t.state()?.commandRunning).toBe(true), WAIT)
    await sleep(SEVERAL_PAUSES_MS)
    t.type('ab')
    await sleep(SEVERAL_PAUSES_MS)
    expect(lines()).toEqual([])
    expect(requests()).toEqual([])
    // Enter gives `ab` to cat, Ctrl+D ends it.
    t.type('\r')
    await vi.waitFor(() => expect(shown(t.text())).toMatch(/ab\r\nab\r\n/), WAIT)
    t.type('\x04')
    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: false, awaitingInput: true }), WAIT)
    t.type('docker ps')
    await askAbout('docker ps')
    expect(lines()).toEqual(['docker ps'])
  })

  it('a line the history answers is not asked about; Enter before the pause is over ends the timer', async () => {
    const { t, answers, lines, askAbout } = await start({ pauseMs: 400 })
    answers([])
    await t.run('echo worfy-sg-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-sg-1'))
    await sleep(1200)
    expect(lines()).toEqual([])

    // A line nothing answers, changed within its pause into one the history answers: its timer is ended.
    t.type(`${CTRL_U}zz`)
    await t.settle(50)
    t.type(`${CTRL_U}echo wo`)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-sg-1'))
    await sleep(1200)
    expect(lines()).toEqual([])

    // Typed and run at once, sooner than the pause: nothing is asked at the next prompt.
    await t.run(`${CTRL_U}: typed-and-run-at-once`)
    await sleep(1200)
    expect(lines()).toEqual([])
    t.type('docker ps')
    await askAbout('docker ps')
    expect(lines()).toEqual(['docker ps'])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('there is one timer however many keys are pressed, and Enter ends it and its subshell at once: the command that runs gets nothing of it', async () => {
    const { t, answers, lines, probe } = await start({ pauseMs: 3000 })
    answers([])
    // The processes whose parent is the shell, counted by a command of the shell. Which of the
    // command's own processes pgrep counts in differs between macOS and Linux; the same command
    // counts the same ones each time.
    const COUNT = 'print -r -- "children:$(( $(pgrep -P $$ | wc -l) ))"'
    const children = (output: string) => Number(/children:(\d+)/.exec(output)?.[1] ?? Number.NaN)
    const before = children(await t.run(COUNT))
    expect(Number.isInteger(before)).toBe(true)

    // A line that waits for its pause, typed key by key: one timer, whose subshell is a child of the shell.
    for (const part of [':', ' ', 'w', 'a', 'i', 't']) {
      t.type(part)
      await t.settle(30)
    }
    const waiting = await probe()
    expect(waiting.timer).toMatch(/^\d{2,}$/)
    expect(Number(waiting.pid)).toBeGreaterThan(1)
    // The line wiped: there is nothing to ask about, and the timer and its subshell are ended at once.
    t.type(CTRL_U)
    await t.settle()
    expect(await probe()).toMatchObject({ timer: '', pid: '' })
    expect(await t.run(`kill -0 ${waiting.pid} 2>/dev/null && print -r -- alive || print -r -- gone`)).toContain('gone')

    // The same again, and Enter instead of wiping the line: the command that runs finds the pipe of
    // the timer closed and no subshell left, at once and not when the 3 s are over. The subshell is
    // looked for first, before the command starts a program: gone means the shell has reaped it,
    // so its SIGCHLD came before the command and cannot cut short a write of the next prompt.
    for (const part of [':', ' ', 'w', 'a', 'i', 't']) {
      t.type(part)
      await t.settle(30)
    }
    const again = await probe()
    expect(again.timer).toMatch(/^\d{2,}$/)
    t.type(`; kill -0 ${again.pid} 2>/dev/null && print -r -- alive || print -r -- gone; /bin/sh -c '( : <&${again.timer} ) 2>/dev/null && echo pipe-open; echo pipe-checked'; ${COUNT}`)
    await t.settle(30)
    const output = await t.run('')
    expect(output).toContain('pipe-checked')
    expect(output).not.toContain('pipe-open')
    expect(output).toContain('gone')
    expect(children(output)).toBe(before)
    expect(lines()).toEqual([])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('a timer that ran out leaves no open pipe behind; left alone, a line is asked about when its pause is over, not sooner', async () => {
    const { t, answers, askAbout, probe } = await start({ pauseMs: 1500 })
    answers([])
    const from = performance.now()
    t.type('docker ps')
    await t.settle()
    const first = await probe()
    expect(first.timer).toMatch(/^\d{2,}$/)
    await askAbout('docker ps')
    expect(performance.now() - from).toBeGreaterThanOrEqual(1500)
    expect(await probe()).toMatchObject({ timer: '', pid: '' })
    // The next line gets a timer of its own. Its number is not the first one's, even when nothing is
    // left open: `{fd}` takes the lowest free descriptor from 10, and zsh holds descriptors of its own
    // in a key's widget that it does not hold in the handler of a pipe, where a timer that ended
    // before a later key's moment is started again. So the pipes are checked by their own numbers:
    // once both timers ran out, a command finds neither open.
    t.type(' -a')
    await t.settle()
    const second = await probe()
    expect(second.timer).toMatch(/^\d{2,}$/)
    await askAbout('docker ps -a')
    const open = (fd: string) => `( : <&${fd} ) 2>/dev/null && echo pipe-open-${fd};`
    expect(await t.run(`${CTRL_U}/bin/sh -c '${open(first.timer)} ${open(second.timer)} echo pipe-checked'`)).toMatch(/^pipe-checked\r\n/)
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('Ctrl+C on a line that waits for its pause asks nothing, and the next line is asked about', async () => {
    const { t, answers, lines, askAbout } = await start({ pauseMs: 400 })
    answers([])
    t.type('docker ps')
    await sleep(100)
    t.type('\x03')
    await t.prompt(2)
    await sleep(1200)
    expect(lines()).toEqual([])
    t.type('docker images')
    await askAbout('docker images')
    expect(lines()).toEqual(['docker images'])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  // zsh runs the Esc widget only once it knows no longer sequence follows: KEYTIMEOUT, 400 ms by
  // default. No key is typed sooner than that after Esc, or zsh reads both as one sequence.
  const AFTER_ESC_MS = 700

  it('Esc while the line waits for its pause ends the timer: the model is not asked and nothing grey is shown', async () => {
    const { t, answers, lines, probe, askAbout } = await start({ pauseMs: 1500 })
    answers([{ feature: 'suggest', match: TYPED, answer: ANSWER, delayMs: 0 }])
    t.type(TYPED)
    await sleep(100)
    t.type(ESC)
    await sleep(AFTER_ESC_MS)
    // The pause is not over yet, and no timer runs.
    expect(await probe()).toMatchObject({ timer: '', pid: '' })
    await sleep(1500)
    expect(lines()).toEqual([])
    expect(await t.redrawn()).toMatch(lineAlone(TYPED))
    expect(shown(t.text())).not.toContain('untu bash')
    // A key that changes the line starts the pause over, and that line is asked about.
    t.type('!')
    await askAbout(`${TYPED}!`)
    expect(lines()).toEqual([`${TYPED}!`])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
  })

  it('Esc in the vi keymap while the line waits for its pause asks nothing and still leaves insert mode', async () => {
    await writeFile(join(home, '.zshrc'), "PS1='zle%# '\nHISTSIZE=1000\nSAVEHIST=1000\nbindkey -v\n")
    const { t, answers, lines } = await start({ pauseMs: 1500 })
    answers([{ feature: 'suggest', match: 'echo worfy-vi-esc', answer: 'echo worfy-vi-esc-from-model', delayMs: 0 }])
    t.type('echo worfy-vi-esc')
    await sleep(50)
    t.type(ESC)
    await sleep(AFTER_ESC_MS + 1500)
    expect(lines()).toEqual([])
    expect(await t.redrawn()).toMatch(lineAlone('echo worfy-vi-esc'))
    expect(shown(t.text())).not.toContain('-from-model')
    // Command mode: the cursor went back onto the last `c`, and `x` deletes it.
    t.type('x')
    const before = t.events().length
    expect(await t.run('')).toContain('worfy-vi-es\r\n')
    expect(t.events().slice(before)).toContainEqual({ type: 'command-started', command: 'echo worfy-vi-es' })
    expect(lines()).toEqual([])
  })

  it('Esc once the grey answer is shown hides it, as before, and asks nothing new', async () => {
    const { t, answers, lines, requests, askAbout } = await start()
    answers([{ feature: 'suggest', match: TYPED, answer: ANSWER, delayMs: 50 }])
    t.type(TYPED)
    await askAbout(TYPED)
    expect(await t.greyShown('untu bash')).toMatch(lineWithGrey(TYPED, 'untu bash'))
    t.type(ESC)
    await sleep(AFTER_ESC_MS)
    expect(await t.redrawn()).toMatch(lineAlone(TYPED))
    await sleep(SEVERAL_PAUSES_MS)
    expect(lines()).toEqual([TYPED])
    expect(requests()).toMatchObject([{ context: { line: TYPED }, cancelled: false }])
  })

  it('Esc after the pause, while the model answers, cancels the ask, and the answer that comes later is not shown', async () => {
    const { t, answers, requests, askAbout, claims, lines } = await start()
    answers([{ feature: 'suggest', match: TYPED, answer: ANSWER, delayMs: 1500 }])
    t.type(TYPED)
    const ask = await askAbout(TYPED)
    await vi.waitFor(() => expect(claims()).toBe(1), WAIT)
    const from = t.text().length
    t.type(ESC)
    await vi.waitFor(() => expect(ask.ask.signal.aborted).toBe(true), WAIT)
    await vi.waitFor(() => expect(ask.finished).toBe(true), WAIT)
    await sleep(1500 + SEVERAL_PAUSES_MS)
    expect(await t.redrawn()).toMatch(lineAlone(TYPED))
    expect(shown(t.text().slice(from))).not.toContain('untu bash')
    expect(ask.shows).toEqual([])
    expect(lines()).toEqual([TYPED])
    expect(requests()).toMatchObject([{ context: { line: TYPED }, cancelled: true }])
  })

  it('Alt+→ word by word to the end of the answer asks nothing new', async () => {
    const { t, answers, lines, askAbout } = await start()
    answers([{ feature: 'suggest', match: TYPED, answer: ANSWER, delayMs: 50 }])
    t.type(TYPED)
    await askAbout(TYPED)
    expect(await t.greyShown('untu bash')).toMatch(lineWithGrey(TYPED, 'untu bash'))
    t.type(ALT_RIGHT)
    expect(await t.redrawn()).toMatch(lineWithGrey('docker run --rm -it ubuntu', ' bash'))
    t.type(ALT_RIGHT)
    expect(await t.redrawn()).toMatch(lineAlone(ANSWER))
    await sleep(SEVERAL_PAUSES_MS)
    expect(lines()).toEqual([TYPED])
    // What the user types after it is asked about again.
    t.type(' -c')
    await askAbout(`${ANSWER} -c`)
  })

  it('the socket closed: typing goes on, the timer runs out and zsh prints no error', async () => {
    const { t, answers, link, lines } = await start()
    answers([])
    await t.run('echo worfy-sg-1')
    link.closeSync()
    t.type('docker ps')
    await sleep(SEVERAL_PAUSES_MS)
    expect(await t.redrawn()).toMatch(lineAlone('docker ps'))
    t.type(`${CTRL_U}echo wo`)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-sg-1'))
    t.type(RIGHT)
    expect(await t.run('')).toContain('worfy-sg-1\r\n')
    expect(lines()).toEqual([])
    expect(shown(t.text())).not.toMatch(ZSH_ERROR)
    expect(t.exited()).toBeNull()
  })

  it('a zsh that edits no line reads the script after the widget of rc.d/10-assist.zsh and sets nothing up, without an error', () => {
    const scripts = join(import.meta.dirname, '../../src/main/terminal/zsh/rc.d')
    const read = spawnSync(
      zshPath(),
      ['-f', '-c', `source '${scripts}/10-assist.zsh'; source '${scripts}/20-suggest-ai.zsh'; print -r -- "set-up:\${+functions[_worfy_suggest_line]}:\${+__worfy_suggest_pause_ms}:\${#__worfy_assist_line_hooks}"`],
      { encoding: 'utf8', env: { PATH: SYSTEM_PATH, HOME: home } },
    )
    expect(read.stderr).toBe('')
    expect(read.stdout).toBe('set-up:0:0:0\n')
    expect(read.status).toBe(0)
  })

  it('with zsh-autosuggestions (its _zsh_autosuggest_start is defined) the model is not asked', async () => {
    await writeFile(join(home, '.zshrc'), "PS1='zle%# '\nHISTSIZE=1000\nSAVEHIST=1000\n_zsh_autosuggest_start() { : }\n")
    const { t, answers, lines, requests } = await start()
    answers([{ answer: 'docker ps --all' }])
    t.type('docker ps')
    await sleep(SEVERAL_PAUSES_MS)
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone('docker ps'))
    expect(line).not.toMatch(ANY_GREY)
    expect(lines()).toEqual([])
    expect(requests()).toEqual([])
  })
})
