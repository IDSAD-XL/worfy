// Fix of Terminal AI: the channels of the "Fix" button (src/main/ipc/terminal-ai-fix.ts) and the
// request behind it (src/main/terminal-ai/fix.ts), on a real zsh in a real pseudo-terminal (node-pty
// under Electron's Node) with the shell integration and the link of Terminal AI.
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
import { terminalAiFixHandlers } from '../../src/main/ipc/terminal-ai-fix'
import type { ShellEvent, ShellState } from '../../src/main/terminal/osc'
import { spawnShellPty, TerminalRegistry, type SpawnPty, type TerminalSink } from '../../src/main/terminal/pty'
import { ShellIntegration } from '../../src/main/terminal/shell-integration'
import { AssistService, type AssistBackend } from '../../src/main/terminal-ai/assist'
import { fakeAssistBackend, type FakeAnswer, type FakeLogEntry } from '../../src/main/terminal-ai/fake-backend'
import { clockText } from '../../src/main/terminal-ai/features/command-request'
import { FailedCommands, runFix } from '../../src/main/terminal-ai/fix'
import { ShellLink } from '../../src/main/terminal-ai/shell-link'
import { TerminalAiSettingsStore } from '../../src/main/terminal-ai/settings'
import type { LimitWindowState } from '../../src/shared/agent/limits'
import { accessOf, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { TerminalAiSettingsPatch } from '../../src/shared/terminal-ai/settings'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

// The real SDK module, replaced: a test that reached it would fail here instead of starting Claude Code.
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
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
const KEY = terminalKey(PROJECT, NODE)
const WAIT = { timeout: 10_000, interval: 20 }
/** Ubuntu's /etc/zsh/zshrc runs compinit unless this is set, and on the CI runner compinit waits for a key. */
const QUIET_ZSH: Env = { skip_global_compinit: '1' }

const FAILING = 'ls /nonexistent-worfy'
/** The answer of the fake: it would leave a file behind if it ran. */
const MARK_FILE = 'fixed.txt'
const ANSWER = `ls / > ${MARK_FILE}`
/** A token of the shape redact.ts knows; the test prints it, the model must never get it. */
const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4)}`

let home: string
let root: string
let scratch: string
const registries: TerminalRegistry[] = []
const integrations: ShellIntegration[] = []
const links: ShellLink[] = []
const services: AssistService[] = []

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-fix-home-')))
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-fix-project-')))
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-fix-data-')))
  // A prompt without colours and a history that is kept: what a user's .zshrc usually sets.
  await writeFile(join(home, '.zshrc'), "PS1='fix%# '\nHISTSIZE=1000\nSAVEHIST=1000\n")
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

const limitWindow = (over: Partial<LimitWindowState>): LimitWindowState => ({
  utilization: 0.1,
  resetsAt: Math.round(Date.now() / 1000) + 3600,
  status: 'allowed',
  receivedAt: Date.now(),
  source: 'sdk',
  ...over,
})

// ---- the assist service over the fake backend --------------------------------------------------------

/** The assist service of one test. Of the features that ask the model, only Fix is on unless `settings` says otherwise. */
function world(settings: TerminalAiSettingsPatch = {}) {
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
  service.setSettings({ suggestionAsksModel: false, nextCommand: false, commandRequest: false, fix: true, ...settings })
  return {
    service,
    limits,
    logged,
    answers: (answers: FakeAnswer[]) => writeFileSync(answersFile, JSON.stringify(answers)),
    requests: () =>
      (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as FakeLogEntry),
  }
}
type World = ReturnType<typeof world>

/** The answer of the fake to every Fix, after `delayMs`, in backticks as a model writes it. */
const answering = (delayMs = 200): FakeAnswer[] => [{ feature: 'fix', answer: `\`${ANSWER}\``, delayMs }]

// ---- a real zsh, and the channels of the button --------------------------------------------------------

/** Ctrl+X g: the key of the tests' own script, which writes the line zsh holds into a file. */
const PROBE_KEY = '\x18g'

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
  /** The payloads of `terminalAi.fix.changed`. */
  changes(): unknown[] {
    return this.sent.filter((entry) => entry.channel === `${IPC_CHANNEL_PREFIX}terminalAi.fix.changed`).map((entry) => entry.payload)
  }
}

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

/**
 * A registry with the shell integration over the temporary HOME, the link of Terminal AI with no
 * feature of its own, the assist service of `w`, one zsh Terminal connected to the link, a Terminal
 * on /bin/sh beside it, and the channels of the button over both.
 */
async function start(w: World = world()) {
  const integration = new ShellIntegration()
  integrations.push(integration)
  const link = new ShellLink({
    settings: () => Promise.resolve({ current: () => w.service.state().settings, subscribe: (listener) => w.service.subscribe(() => listener()) }),
    context: { shellState: (terminal) => registry.shellState(terminal), assist: () => Promise.resolve(w.service) },
    features: {},
  })
  links.push(link)
  /** What anything wrote into a pty. */
  const written: string[] = []
  const spawn: SpawnPty = (file, args, options) => {
    const pty = spawnShellPty(file, args, options)
    const write = pty.write.bind(pty)
    pty.write = (data: string) => {
      written.push(data)
      write(data)
    }
    return pty
  }
  const base: Env = { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8' }
  const registry: TerminalRegistry = new TerminalRegistry({ env: () => Promise.resolve({ ...base, SHELL: ZSH }), killGraceMs: 1000, integration, spawn, assist: link })
  registries.push(registry)
  const sh = new TerminalRegistry({ env: () => Promise.resolve({ ...base, SHELL: '/bin/sh' }), killGraceMs: 1000, integration, assist: link })
  registries.push(sh)
  const events: ShellEvent[] = []
  registry.onShellEvent((key, event) => {
    if (key === KEY) events.push(event)
  })

  const dir = await integration.prepare()
  await mkdir(join(dir, 'rc.d'), { recursive: true })
  const probeFile = join(scratch, 'probe.txt')
  await writeFile(
    join(dir, 'rc.d', '90-test.zsh'),
    ['__test_probe() {', `  builtin print -r -- "line:[$BUFFER]" >| ${probeFile}`, '}', 'zle -N __test_probe', "bindkey '^Xg' __test_probe", ''].join('\n'),
  )

  // The channels, as main registers them; the Node asks for the state when it mounts, before its shell runs anything.
  const shells = {
    shellState: (key: string) => registry.shellState(key) ?? sh.shellState(key),
    onShellEvent: (listener: (key: string, event: ShellEvent) => void) => {
      const offs = [registry.onShellEvent(listener), sh.onShellEvent(listener)]
      return () => offs.forEach((off) => off())
    },
  }
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './terminal-ai-fix.ts': async () => terminalAiFixHandlers({ registry: () => shells, link: () => link, assist: () => Promise.resolve(w.service) }) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  const window = new FakeWindow()
  const call = async (channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: APP_URL }, sender: window } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  const state = (nodeId = NODE) => call('terminalAi.fix.state', { projectId: PROJECT, nodeId })
  const fix = (nodeId = NODE) => call('terminalAi.fix.run', { projectId: PROJECT, nodeId })
  expect(await state()).toEqual({ ok: true, value: { available: false } })

  // The zsh Terminal.
  const chunks: string[] = []
  const typed: string[] = []
  const client = {}
  const sink: TerminalSink = { output: (data) => chunks.push(data), exit: () => undefined, started: () => undefined }
  await registry.open(KEY, { cwd: root, cols: 120, rows: 30 }, client, sink)
  const count = (type: ShellEvent['type']) => events.filter((event) => event.type === type).length
  const type = (data: string) => {
    typed.push(data)
    registry.write(KEY, data, client)
  }
  await vi.waitFor(() => expect(count('prompt'), JSON.stringify(chunks.join('').slice(-2000))).toBeGreaterThanOrEqual(1), WAIT)
  await vi.waitFor(() => expect(link.connected(KEY)).toBe(true), WAIT)
  await sh.open(terminalKey(PROJECT, SH_NODE), { cwd: root, cols: 80, rows: 24 }, {}, { output: () => undefined, exit: () => undefined, started: () => undefined })

  /** Types one command line and waits until it finished and the next prompt is shown. */
  const run = async (line: string) => {
    const finished = count('command-finished')
    const prompts = count('prompt')
    type(`${line}\r`)
    await vi.waitFor(() => {
      expect(count('command-finished')).toBe(finished + 1)
      expect(count('prompt')).toBeGreaterThan(prompts)
    }, WAIT)
  }
  /** The line zsh holds right now. */
  const line = async (): Promise<string> => {
    removeTestTree(probeFile)
    type(PROBE_KEY)
    await vi.waitFor(() => expect(existsSync(probeFile) && readFileSync(probeFile, 'utf8').endsWith(']\n')).toBe(true), WAIT)
    return /^line:\[(.*)\]\n$/s.exec(readFileSync(probeFile, 'utf8'))?.[1] ?? '<no probe>'
  }
  return { ...w, registry, link, window, state, fix, run, type, typed, written, line, count }
}

const last = (window: FakeWindow) => window.changes().at(-1)

// ---- the failed command --------------------------------------------------------------------------------

describe('FailedCommands', () => {
  it('keeps a known command that failed, until the next command starts; a command with a space, or one that succeeded, is none', () => {
    const failed = new FailedCommands()
    failed.event('t', { type: 'command-finished', command: 'ls /x', exitCode: 1 })
    expect(failed.get('t')).toEqual({ command: 'ls /x', exitCode: 1 })
    failed.event('t', { type: 'prompt' })
    expect(failed.get('t')).toEqual({ command: 'ls /x', exitCode: 1 })
    failed.event('t', { type: 'command-started', command: 'ls' })
    expect(failed.get('t')).toBeUndefined()
    failed.event('t', { type: 'command-finished', command: null, exitCode: 2 })
    expect(failed.get('t')).toBeUndefined()
    failed.event('t', { type: 'command-finished', command: 'true', exitCode: 0 })
    expect(failed.get('t')).toBeUndefined()
    failed.event('t', { type: 'command-finished', command: 'false', exitCode: 1 })
    const one = failed.get('t')
    expect(one).toBeDefined()
    if (one === undefined) return
    failed.event('t', { type: 'command-finished', command: 'false', exitCode: 1 })
    expect(failed.done('t', one)).toBe(false)
    expect(failed.forget('t')).toBe(true)
    expect(failed.get('t')).toBeUndefined()
  })
})

describe('runFix', () => {
  const state: ShellState = { cwd: '/Users/me/work', awaitingInput: true, commandRunning: false, altScreen: false, exitCode: 1, commands: ['ls /x'], lastOutput: 'ls: /x: No such file or directory\r\n' }

  it('an answer that comes after the failed command stopped being the last one is not pushed, even without a signal', async () => {
    const failed = new FailedCommands()
    failed.event('t', { type: 'command-finished', command: 'ls /x', exitCode: 1 })
    const push = vi.fn(() => true)
    const result = await runFix(
      {
        shellState: () => state,
        push,
        failed,
        assist: () =>
          Promise.resolve({
            request: () => {
              // A new command started while the model was answering.
              failed.event('t', { type: 'command-started', command: 'echo next' })
              return Promise.resolve({ ok: true as const, command: 'ls /', model: 'sonnet' })
            },
          }),
      },
      't',
    )
    expect(result).toEqual({ ok: false, message: 'Cancelled' })
    expect(push).not.toHaveBeenCalled()
  })

  it('a shell that does not wait for input, or a full-screen program, is busy: the model is not asked', async () => {
    const failed = new FailedCommands()
    failed.event('t', { type: 'command-finished', command: 'ls /x', exitCode: 1 })
    const request = vi.fn()
    for (const over of [{ awaitingInput: false }, { altScreen: true }, { commandRunning: true }]) {
      const result = await runFix({ shellState: () => ({ ...state, ...over }), push: () => true, failed, assist: () => Promise.resolve({ request }) }, 't')
      expect(result, JSON.stringify(over)).toEqual({ ok: false, message: 'Terminal is busy' })
    }
    expect(request).not.toHaveBeenCalled()
  })
})

// ---- the channels --------------------------------------------------------------------------------------

describe('the channels of the Fix button', () => {
  it('are marked `project`: Fix works with a Terminal of the Project', () => {
    for (const channel of ['terminalAi.fix.state', 'terminalAi.fix.changed', 'terminalAi.fix.run']) expect(accessOf(channel), channel).toBe('project')
  })

  it('`ls /nonexistent-worfy` makes the button available: the event and the state say so; a Terminal on /bin/sh never has it', async () => {
    const s = await start()
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toEqual({ projectId: PROJECT, nodeId: NODE, available: true }), WAIT)
    expect(await s.state()).toEqual({ ok: true, value: { available: true } })
    // /bin/sh has no integration and no link: no button, whatever it ran.
    expect(await s.state(SH_NODE)).toEqual({ ok: true, value: { available: false } })
  })

  it('Fix asks Sonnet with the command, its exit code and the tail of its output; the answer is the line of the zsh, and nothing runs', async () => {
    const s = await start()
    s.answers(answering())
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    const prompts = s.count('prompt')
    expect(await s.fix()).toEqual({ ok: true, value: { ok: true } })
    await vi.waitFor(async () => expect(await s.line()).toBe(ANSWER), WAIT)

    const [request, ...more] = s.requests()
    expect(more).toEqual([])
    expect(request).toMatchObject({ feature: 'fix', model: 'sonnet', cancelled: false, context: { cwd: root, line: '' } })
    expect(request?.context.commands.at(-1)).toBe(FAILING)
    expect(request?.context.exitCode).not.toBe(0)
    expect(request?.context.exitCode).not.toBeNull()
    // The tail as plain lines: one line, without the `\r\n` of the pty or any escape sequence.
    expect(request?.context.output).toEqual([expect.stringMatching(/^ls: .*No such file or directory$/)])

    // Nothing ran: main wrote into the pty only what the test typed — no Enter of its own — and no prompt came.
    await sleep(300)
    expect(s.written).toEqual(s.typed)
    expect(s.count('prompt')).toBe(prompts)
    expect(existsSync(join(root, MARK_FILE))).toBe(false)
    // The answer is in the line: the button goes until the next failure.
    expect(last(s.window)).toMatchObject({ available: false })
    expect(await s.state()).toEqual({ ok: true, value: { available: false } })
  })

  it('a secret the failed command printed reaches the model as [redacted]', async () => {
    const s = await start()
    s.answers(answering())
    // The token is assembled by the shell: the command line holds only its halves.
    await s.run(`a=ghp_; b=${TOKEN.slice(4)}; echo "token $a$b"; false`)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    expect(await s.fix()).toEqual({ ok: true, value: { ok: true } })
    const text = JSON.stringify(s.requests())
    expect(text).toContain('token [redacted]')
    expect(text).not.toContain(TOKEN)
  })

  it('a new command takes the button away; a failed command that started with a space never brings it', async () => {
    const s = await start()
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    // A new command: the button goes as it starts, and stays away after it succeeded.
    s.type('sleep 1\r')
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: false }), WAIT)
    await vi.waitFor(() => expect(s.registry.shellState(KEY)?.commandRunning).toBe(false), WAIT)
    expect(await s.state()).toEqual({ ok: true, value: { available: false } })

    // A command that starts with a space stays out of worfy: it failed, but there is nothing to fix.
    await s.run(` ${FAILING}`)
    expect(s.registry.shellState(KEY)?.exitCode).not.toBe(0)
    await sleep(200)
    expect(await s.state()).toEqual({ ok: true, value: { available: false } })
    expect(s.window.changes().filter((change) => (change as { available: boolean }).available)).toHaveLength(1)
  })

  it('with Fix off in Settings the button goes, and comes back when it is on', async () => {
    const s = await start()
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    s.service.setSettings({ fix: false })
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: false }), WAIT)
    expect(await s.state()).toEqual({ ok: true, value: { available: false } })
    // A Fix asked anyway is refused by the service: the model is not asked.
    s.answers(answering())
    expect(await s.fix()).toEqual({ ok: true, value: { ok: false, message: 'Terminal AI is off' } })
    expect(s.requests()).toEqual([])
    s.service.setSettings({ fix: true })
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
  })

  it('the zsh leaving takes the button away', async () => {
    const s = await start()
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    await s.registry.close(KEY)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: false }), WAIT)
  })

  it('Limits rejected: a refusal with the time they reset, and no request', async () => {
    const w = world()
    w.answers(answering())
    const resetsAt = Math.round(Date.now() / 1000) + 2 * 3600
    w.limits.record([{ window: 'five_hour', state: limitWindow({ status: 'rejected', utilization: 1, resetsAt }) }])
    const s = await start(w)
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    expect(await s.fix()).toEqual({ ok: true, value: { ok: false, message: `Limits reached until ${clockText(resetsAt * 1000, Date.now())}` } })
    await sleep(300)
    expect(s.requests()).toEqual([])
    expect(await s.line()).toBe('')
    // Nothing went into the line: the button stays for a later try.
    expect(await s.state()).toEqual({ ok: true, value: { available: true } })
  })

  it('while a command runs Fix says the Terminal is busy, and the model is not asked', async () => {
    const s = await start()
    s.answers(answering())
    await s.run(FAILING)
    s.type('sleep 2\r')
    await vi.waitFor(() => expect(s.registry.shellState(KEY)?.commandRunning).toBe(true), WAIT)
    expect(await s.fix()).toEqual({ ok: true, value: { ok: false, message: 'Terminal is busy' } })
    expect(s.requests()).toEqual([])
  })

  it('an answer that comes after a new command started is not put into the line', async () => {
    const s = await start()
    s.answers(answering(1500))
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    const pending = s.fix()
    await sleep(300)
    await s.run('echo typed-by-the-user')
    expect(await pending).toEqual({ ok: true, value: { ok: false, message: 'Cancelled' } })
    await sleep(1500)
    expect(await s.line()).toBe('')
    expect(s.requests().filter((entry) => !entry.cancelled)).toEqual([])
  })

  it('the log of main and of the service holds neither the command, nor its output, nor the answer', async () => {
    const printed: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : String(arg))).join(' ')))
    }
    const s = await start()
    s.answers(answering())
    await s.run(FAILING)
    await vi.waitFor(() => expect(last(s.window)).toMatchObject({ available: true }), WAIT)
    expect(await s.fix()).toEqual({ ok: true, value: { ok: true } })
    expect(await s.fix()).toEqual({ ok: true, value: { ok: false, message: 'Nothing to fix' } })
    const everything = [...printed, ...s.logged].join('\n')
    expect(s.logged.length).toBeGreaterThan(0)
    for (const secret of [FAILING, 'nonexistent-worfy', 'No such file', ANSWER]) expect(everything).not.toContain(secret)
  })
})
