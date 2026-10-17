// The Suggestion of Terminal AI in zsh, on a real zsh in a real pseudo-terminal (node-pty under
// Electron's Node) with worfy's shell integration: the grey text from the history of commands, the
// keys that take and hide it, and the socket between the shell and main with its messages.
//
// HOME and the user's files are in a temporary folder: the real ~/.zshrc and ~/.zsh_history of the
// machine running the tests are never read or written.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_PATH, type Env } from '../../src/main/agent/env'
import type { ShellEvent } from '../../src/main/terminal/osc'
import { spawnShellPty, TerminalRegistry, type SpawnPty, type TerminalSink } from '../../src/main/terminal/pty'
import { ShellIntegration, SOCKET_PATH_MAX, socketPath, type AssistDoor } from '../../src/main/terminal/shell-integration'
import { encodeMessage, parseShellMessage } from '../../src/main/terminal-ai/protocol'
import { HISTORY_FEATURE, ShellLink, type FeatureLoader, type ShellAsk, type ShellFeature, type ShellReply } from '../../src/main/terminal-ai/shell-link'
import { DEFAULT_TERMINAL_AI_SETTINGS, type TerminalAiSettings } from '../../src/shared/terminal-ai/settings'
import { removeTestTree } from '../remove'

/** The zsh of the machine: /bin/zsh on macOS, /usr/bin/zsh on Linux CI (.github/workflows/ci.yml). */
const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()
/**
 * Runs a script as a program the shell starts: a zsh without startup files. Not /bin/sh: dash, which
 * is /bin/sh on Linux, stops the whole script with "Bad fd number" at a redirect to a descriptor above
 * 9, and the shell holds its connection above 9.
 */
const PROGRAM = `${ZSH} -fc`
const KEY = 'terminal-1'
const WAIT = { timeout: 10_000, interval: 20 }
/** Ubuntu's /etc/zsh/zshrc runs compinit unless this is set, and on the CI runner compinit waits for a key. */
const QUIET_ZSH: Env = { skip_global_compinit: '1' }

/** The keys as xterm.js 6.0.0 sends them (node_modules/@xterm/xterm/src/common/input/Keyboard.ts). */
const RIGHT = '\x1b[C'
const LEFT = '\x1b[D'
const ALT_RIGHT = '\x1b[1;3C'
const ESC = '\x1b'
const CTRL_L = '\x0c'

let home: string
let root: string
const registries: TerminalRegistry[] = []
const integrations: ShellIntegration[] = []
const links: ShellLink[] = []
const sockets: Socket[] = []
/** Programs a test's widget left running in the background. */
const holders: number[] = []
const folders: string[] = []

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-zle-home-')))
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-zle-project-')))
  // A prompt without colours and a history that is kept: what a user's .zshrc usually sets.
  await userZshrc()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const pid of holders.splice(0)) {
    try {
      process.kill(pid)
    } catch {
      // Gone already.
    }
  }
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
  for (const link of links.splice(0)) link.closeSync()
  for (const integration of integrations.splice(0)) integration.disposeSync()
  for (const folder of folders.splice(0)) removeTestTree(folder)
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const USER_ZSHRC = "PS1='zle%# '\nHISTSIZE=1000\nSAVEHIST=1000\n"
const userZshrc = (more = '') => writeFile(join(home, '.zshrc'), `${USER_ZSHRC}${more}\n`)

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

/** The settings of Terminal AI, as a test changes them. */
function settingsSource(initial: Partial<TerminalAiSettings> = {}) {
  let settings: TerminalAiSettings = { ...DEFAULT_TERMINAL_AI_SETTINGS, ...initial }
  const listeners = new Set<() => void>()
  return {
    current: () => settings,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (patch: Partial<TerminalAiSettings>) => {
      settings = { ...settings, ...patch }
      for (const listener of listeners) listener()
    },
    /** A change of the assist service's state that is not a change of the settings. */
    poke: () => {
      for (const listener of listeners) listener()
    },
  }
}

/** A feature whose asks the test sees and answers itself. */
function recordingFeature(feature = 'suggest') {
  const asks: { ask: ShellAsk; reply: ShellReply }[] = []
  const module: ShellFeature = { feature, ask: (ask, reply) => void asks.push({ ask, reply }) }
  return { asks, loader: (() => Promise.resolve(module)) satisfies FeatureLoader, lines: () => asks.map((each) => each.ask.line) }
}

interface StartOptions {
  env?: Env
  /** False: no socket, as when it could not be opened. */
  link?: boolean
  features?: Record<string, FeatureLoader>
  settings?: ReturnType<typeof settingsSource>
  helloTimeoutMs?: number
  integration?: ShellIntegration
  /** Instead of the link: what the registry asks for the socket and the token. */
  door?: AssistDoor
}

/** A registry of Terminals with the shell integration over the temporary HOME, and the link to their shells. */
function start(options: StartOptions = {}) {
  const integration = options.integration ?? new ShellIntegration()
  integrations.push(integration)
  const base: Env = { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8', SHELL: ZSH, ...options.env }
  const settings = options.settings ?? settingsSource()
  const link = new ShellLink({
    settings: () => Promise.resolve(settings),
    context: { shellState: (terminal) => registry.shellState(terminal), assist: () => Promise.reject(new Error('no assist service in this test')) },
    features: options.features ?? {},
    ...(options.helloTimeoutMs === undefined ? {} : { helloTimeoutMs: options.helloTimeoutMs }),
  })
  links.push(link)
  /** The environment each shell was started with, and what main wrote into each pty. */
  const envs: Env[] = []
  const written: string[] = []
  const spawn: SpawnPty = (file, args, spawnOptions) => {
    envs.push(spawnOptions.env)
    const pty = spawnShellPty(file, args, spawnOptions)
    const write = pty.write.bind(pty)
    pty.write = (data: string) => {
      written.push(data)
      write(data)
    }
    return pty
  }
  const door = options.door ?? (options.link === false ? undefined : link)
  const registry: TerminalRegistry = new TerminalRegistry({
    env: () => Promise.resolve(base),
    killGraceMs: 1000,
    integration,
    spawn,
    ...(door === undefined ? {} : { assist: door }),
  })
  registries.push(registry)
  const events: { key: string; event: ShellEvent }[] = []
  registry.onShellEvent((key, event) => events.push({ key, event }))
  return { registry, integration, link, settings, envs, written, open: (key = KEY) => openTerminal(registry, link, events, key) }
}

async function openTerminal(registry: TerminalRegistry, link: ShellLink, allEvents: { key: string; event: ShellEvent }[], key: string) {
  const chunks: string[] = []
  const typed: string[] = []
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
  const type = (data: string) => {
    typed.push(data)
    registry.write(key, data, client)
  }
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
  return {
    key,
    text,
    type,
    typed,
    settle,
    events,
    state: () => registry.shellState(key),
    exited: () => exit,
    /** Waits for the shell's prompt (B with its nonce). */
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
    /**
     * What zsh draws when it draws the line anew (Ctrl+L, clear-screen): the prompt, the typed text
     * and the grey text after it, as one piece. While typing zsh repaints only the cells that
     * changed, so the grey text is in the output in parts.
     */
    redrawn: async () => {
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
    },
    /** Types `exit` and waits for the shell to end. */
    exit: async () => {
      type('exit\r')
      await vi.waitFor(() => expect(exit).not.toBeNull(), WAIT)
    },
  }
}

/** A connection to the socket that is not a shell of worfy's. */
function stranger(path: string, firstLine?: string) {
  const socket = createConnection(path)
  sockets.push(socket)
  let closed = false
  let received = ''
  socket.on('data', (chunk: Buffer) => (received += chunk.toString('utf8')))
  socket.on('error', () => undefined)
  socket.on('close', () => (closed = true))
  if (firstLine !== undefined) socket.write(`${firstLine}\n`)
  return {
    socket,
    received: () => received,
    closed: () => closed,
    /** Waits for main to close the connection. */
    untilClosed: (timeout = 3000) => vi.waitFor(() => expect(closed).toBe(true), { timeout, interval: 10 }),
  }
}

/**
 * The name the tests' own script asks under. It is no feature of Terminal AI, so the scripts of the
 * real features (rc.d/20-suggest-ai.zsh and later) never ask under it, and the tests below see the
 * asks of their own script alone.
 */
const PROBE = 'probe'

/** What a feature's own script does (rc.d/20-… and later): asks main when the history has nothing. */
const ASKING_SCRIPT = [
  `__test_ask_when_silent() { [[ -z $1 ]] && _worfy_assist_ask ${PROBE} "$BUFFER" }`,
  '__worfy_assist_line_hooks+=(__test_ask_when_silent)',
].join('\n')

/** Puts the tests' own script into rc.d/ of the integration's folder, after 10-assist.zsh. */
async function testScript(integration: ShellIntegration, script: string) {
  const dir = await integration.prepare()
  await mkdir(join(dir, 'rc.d'), { recursive: true })
  await writeFile(join(dir, 'rc.d', '20-test.zsh'), `${script}\n`)
}

/** Ctrl+X z: a key of the tests' own script; zsh runs its widget while it waits for a key, as it runs any widget. */
const WIDGET_KEY = '\x18z'

/** A widget of the tests' own script on WIDGET_KEY that runs `body`. */
const widgetScript = (body: string) => ['__test_widget() {', body, '}', 'zle -N __test_widget', "bindkey '^Xz' __test_widget"].join('\n')

/**
 * A program that looks at every descriptor from 3 to 255 it was given: `open:<n>` for one that is
 * open, `socket:<n>` for one that is a socket, then `checked`.
 */
const DESCRIPTORS = `${PROGRAM} 'n=3; while [ $n -le 255 ]; do if ( : >&$n ) 2>/dev/null; then echo "open:$n"; fi; if [ -S /dev/fd/$n ]; then echo "socket:$n"; fi; n=$((n + 1)); done; echo checked'`

/** A message with an id the shell never asked under: the shell drops it, and main sends it only while it holds a connection. */
const STALE = { type: 'show', id: 99_999, text: ' STALE' } as const

async function withAskingScript(options: StartOptions = {}, more = '') {
  const feature = recordingFeature(PROBE)
  // Of the real features only the Suggestion from history is on: their own scripts, which are in
  // this shell too, ask nothing and cancel no ask of the test's script.
  const settings = settingsSource({ suggestionAsksModel: false, nextCommand: false, commandRequest: false, fix: false })
  const started = start({ features: { [`./features/${PROBE}.ts`]: feature.loader }, settings, ...options })
  await testScript(started.integration, `${ASKING_SCRIPT}\n${more}`)
  const t = await started.open()
  await t.connected()
  /**
   * The settings name the probe to the shell, as they name a real feature that is on. The `config`
   * of the greeting went out when the shell said hello: this one is read after it. The shell says
   * hello again after every command, and the greeting names the real features alone.
   */
  const probeOn = async () => {
    await vi.waitFor(() => expect(started.link.push(KEY, STALE)).toBe(true), WAIT)
    expect(started.link.push(KEY, { type: 'config', features: [HISTORY_FEATURE, PROBE] })).toBe(true)
  }
  await probeOn()
  /** The ask about `line`, once main has it. */
  const askAbout = async (line: string) => {
    await vi.waitFor(() => expect(feature.lines()).toContain(line), WAIT)
    const found = feature.asks.findLast((each) => each.ask.line === line)
    if (found === undefined) throw new Error('unreachable')
    return found
  }
  return { ...started, feature, t, askAbout, probeOn }
}

describe('the Suggestion from the history of commands', () => {
  it('after `echo worfy-zle-1`, typing `echo wo` shows the rest of it in grey', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
  })

  it('→ at the end of the line takes it whole, and Enter runs the line', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    await t.settle()
    t.type(RIGHT)
    expect(await t.redrawn()).toMatch(lineAlone('echo worfy-zle-1'))
    const before = t.events().length
    expect(await t.run('')).toContain('worfy-zle-1\r\n')
    expect(t.events().slice(before)).toContainEqual({ type: 'command-started', command: 'echo worfy-zle-1' })
  })

  it('→ inside the line moves the cursor as before and takes nothing', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    await t.settle()
    t.type(`${LEFT}${LEFT}${RIGHT}`)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    // The cursor is one character before the end: the X lands there.
    t.type('X')
    expect(await t.run('')).toContain('wXo\r\n')
  })

  it('Alt+→ (ESC [1;3C, as xterm.js sends it) takes one word at a time', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1 second third')
    t.type('echo wo')
    await t.settle()
    t.type(ALT_RIGHT)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo worfy-zle-1', ' second third'))
    t.type(ALT_RIGHT)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo worfy-zle-1 second', ' third'))
    expect(await t.run('')).toContain('worfy-zle-1 second\r\n')
  })

  it('Esc wipes the grey text, and it stays away until the line changes; the time it takes is printed', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    const from = t.text().length
    const pressed = performance.now()
    t.type(ESC)
    // zsh repaints the line without the grey text once it knows Esc starts no longer sequence (KEYTIMEOUT).
    await vi.waitFor(() => expect(t.text().length).toBeGreaterThan(from), { timeout: 5000, interval: 5 })
    const ms = Math.round(performance.now() - pressed)
    console.log(`terminal ai, zsh: Esc hid the grey text after ${ms} ms (KEYTIMEOUT of zsh is 400 ms by default)`)
    expect(ms).toBeLessThan(2000)
    expect(await t.redrawn()).toMatch(lineAlone('echo wo'))
    // → has nothing to take now.
    t.type(RIGHT)
    expect(await t.redrawn()).toMatch(lineAlone('echo wo'))
    // The next character brings the Suggestion back.
    t.type('r')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wor', 'fy-zle-1'))
  })

  it('a line that starts with a space gets no grey text', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    await t.run(' echo worfy-zle-2')
    t.type(' echo wo')
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone(' echo wo'))
    expect(line).not.toMatch(ANY_GREY)
  })

  it('Enter leaves no grey text on the line that was run', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    const from = t.text().length
    t.type('echo wo')
    await t.settle()
    const before = t.events().length
    expect(await t.run('')).toContain('wo\r\n')
    expect(t.events().slice(before)).toContainEqual({ type: 'command-started', command: 'echo wo' })
    // Between the grey text and the start of the command zsh wiped what was after the cursor.
    const typing = t.text().slice(from)
    const drawn = typing.slice(typing.search(ANY_GREY), typing.indexOf('\x1b]633;C;'))
    // eslint-disable-next-line no-control-regex -- the sequences start with ESC.
    expect(drawn).toMatch(/\x1b\[(?:K|J)|(?:(?:\x1b\[39m)? ){9}/)
  })

  it('characters that mean something in a pattern are read as they are', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run(": '[a*b] (c|d) #e'")
    await t.run(': zzz')
    t.type(": '[a*")
    expect(await t.redrawn()).toMatch(lineWithGrey(": '[a*", "b] (c|d) #e'"))
    // As a pattern `: '[a?` would match that line; it is not how the line starts.
    t.type("\x15: '[a?")
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone(": '[a?"))
    expect(shown(t.text())).not.toMatch(/zsh: |bad pattern|no matches/)
  })

  it('Alt+→ without a Suggestion to take moves a word forward', async () => {
    const { open } = start()
    const t = await open()
    await t.prompt()
    t.type('echo aa bb')
    await t.settle()
    // Ctrl+A, then Alt+→: the cursor is at the start of `aa`, where the X lands.
    t.type(`\x01${ALT_RIGHT}X`)
    expect(await t.run('')).toContain('Xaa bb\r\n')
  })

  it('a key the user bound to a string, not to a widget, prints no error: Alt+→ moves a word forward, Esc hides', async () => {
    await userZshrc("bindkey -s '^[[1;3C' 'typed by a macro'\nbindkey -s '^[' 'typed by a macro'")
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    const from = t.text().length
    t.type(ESC)
    await vi.waitFor(() => expect(t.text().length).toBeGreaterThan(from), { timeout: 5000, interval: 5 })
    expect(await t.redrawn()).toMatch(lineAlone('echo wo'))
    // Ctrl+A, then Alt+→ with nothing to take: the cursor is at the start of `wo`, where the X lands.
    t.type(`\x01${ALT_RIGHT}X`)
    expect(await t.run('')).toContain('Xwo\r\n')
    expect(shown(t.text())).not.toMatch(/zsh: |No such widget|no such widget|macro/)
  })

  it('in the vi keymap → takes the Suggestion too, and Esc hides it and still leaves insert mode', async () => {
    await userZshrc('bindkey -v')
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    t.type(RIGHT)
    await t.settle()
    expect(await t.run('')).toContain('worfy-zle-1\r\n')

    t.type('echo wo')
    await t.settle()
    const from = t.text().length
    t.type(ESC)
    await vi.waitFor(() => expect(t.text().length).toBeGreaterThan(from), { timeout: 5000, interval: 5 })
    await t.settle()
    // Command mode: the cursor went back onto the `o`, and `x` deletes it. The grey text is not in the line.
    t.type('x')
    const before = t.events().length
    expect(await t.run('')).toContain('w\r\n')
    expect(t.events().slice(before)).toContainEqual({ type: 'command-started', command: 'echo w' })
  })

  it('a widget the user already put on forward-char still runs where there is nothing to take', async () => {
    await userZshrc('my-forward() { zle .forward-char; (( ++MY_FORWARD )) }\nzle -N forward-char my-forward')
    const { open } = start()
    const t = await open()
    await t.prompt()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    await t.settle()
    t.type(`${LEFT}${RIGHT}`)
    await t.settle()
    t.type(RIGHT)
    expect(await t.redrawn()).toMatch(lineAlone('echo worfy-zle-1'))
    expect(await t.run('')).toContain('worfy-zle-1\r\n')
    // Once: for the → inside the line. The → that took the Suggestion did not move the cursor.
    expect(await t.run('print -r -- "forward:$MY_FORWARD"')).toContain('forward:1\r\n')
  })

  it('the history of an earlier Terminal (the user\'s .zsh_history) suggests too', async () => {
    await writeFile(join(home, '.zsh_history'), 'echo from-the-past --flag\n')
    const { open } = start()
    const t = await open()
    await t.prompt()
    t.type('echo fr')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo fr', 'om-the-past --flag'))
  })
})

describe('the socket', () => {
  it('the file is 0600 in a folder of 0700, and the shell says hello over it', async () => {
    const { open, integration, link } = start()
    const t = await open()
    await t.connected()
    const dir = integration.path ?? ''
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    const file = statSync(socketPath(dir))
    expect(file.isSocket()).toBe(true)
    expect(file.mode & 0o777).toBe(0o600)
    expect(link.connected(KEY)).toBe(true)
    // The shell is gone: so is its connection.
    await t.exit()
    await vi.waitFor(() => expect(link.connected(KEY)).toBe(false), WAIT)
  })

  it('zsh connects to a socket whose path is 103 bytes, the longest zsocket takes', async () => {
    // /tmp/<name>/worfy-XXXXXX/assist.sock is 103 bytes when /tmp/<name> is 78.
    const base = `/tmp/worfy-zle-${process.pid}-`.padEnd(78, 'x')
    folders.push(base)
    const integration = new ShellIntegration({ tmpdir: () => base })
    const { open, link } = start({ integration })
    const t = await open()
    await t.connected()
    const dir = integration.path ?? ''
    expect(dir.startsWith(`${base}/worfy-`)).toBe(true)
    expect(Buffer.byteLength(socketPath(dir))).toBe(SOCKET_PATH_MAX)
    expect(link.push(KEY, { type: 'insert', text: 'echo long-path' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo long-path'))
  })

  it('a connection without hello, with a token nobody was given, with a token in use and with the token of a shell that is gone is closed', async () => {
    const { open, integration, link, envs } = start({ helloTimeoutMs: 300 })
    const t = await open()
    await t.connected()
    const path = socketPath(integration.path ?? '')
    const token = envs[0]?.WORFY_ASSIST_TOKEN ?? ''
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(envs[0]?.WORFY_ASSIST_SOCKET).toBe(path)

    // Something else first, and a hello only after it.
    const noHello = stranger(path, 'ask\t1\tsuggest\techo')
    await noHello.untilClosed()
    const wrongToken = stranger(path, `hello\t${'0'.repeat(32)}`)
    await wrongToken.untilClosed()
    // The shell's own token, while the shell is connected with it: one connection per token.
    const second = stranger(path, `hello\t${token}`)
    await second.untilClosed()
    // Not a line at all, and nothing at all: closed once the time for the hello is over.
    const silent = stranger(path)
    const started = Date.now()
    await silent.untilClosed()
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    for (const each of [noHello, wrongToken, second, silent]) expect(each.received()).toBe('')
    // The shell's own connection lived through all of it.
    expect(link.connected(KEY)).toBe(true)
    expect(link.push(KEY, { type: 'insert', text: 'echo still-here' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo still-here'))

    // The shell exits: its token dies with it.
    t.type('\x15')
    await t.exit()
    await vi.waitFor(() => expect(link.connected(KEY)).toBe(false), WAIT)
    const afterExit = stranger(path, `hello\t${token}`)
    await afterExit.untilClosed()
    expect(link.connected(KEY)).toBe(false)
    expect(afterExit.received()).toBe('')
  })

  it('a Terminal started again gets a new token; the old one opens nothing', async () => {
    const { open, registry, integration, link, envs } = start()
    const first = await open()
    await first.connected()
    await registry.close(KEY)
    const second = await open()
    await second.connected()
    const [oldToken, newToken] = envs.map((env) => env.WORFY_ASSIST_TOKEN)
    expect(newToken).toMatch(/^[0-9a-f]{32}$/)
    expect(newToken).not.toBe(oldToken)
    const old = stranger(socketPath(integration.path ?? ''), `hello\t${oldToken}`)
    await old.untilClosed()
    expect(link.push(KEY, { type: 'insert', text: 'echo second-shell' })).toBe(true)
    expect(await second.redrawn()).toMatch(lineAlone('echo second-shell'))
  })

  it('the file of the socket was removed: the next Terminal connects, and the first stays connected', async () => {
    const { open, integration, link } = start()
    const first = await open('first')
    await first.connected()
    const path = socketPath(integration.path ?? '')
    unlinkSync(path)
    expect(existsSync(path)).toBe(false)

    const second = await open('second')
    await second.connected()
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(link.push('first', { type: 'insert', text: 'echo first-shell' })).toBe(true)
    expect(link.push('second', { type: 'insert', text: 'echo second-shell' })).toBe(true)
    expect(await first.redrawn()).toMatch(lineAlone('echo first-shell'))
    expect(await second.redrawn()).toMatch(lineAlone('echo second-shell'))

    // The whole folder gone, as macOS may clean it: the same.
    removeTestTree(integration.path ?? '')
    const third = await open('third')
    await third.connected()
    expect(link.push('third', { type: 'insert', text: 'echo third-shell' })).toBe(true)
    expect(await third.redrawn()).toMatch(lineAlone('echo third-shell'))
  })

  it('without the socket the shell starts all the same, with the Suggestion from history', async () => {
    const door: AssistDoor = { admit: () => Promise.reject(new Error('no socket')), revoke: () => undefined }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { open, envs } = start({ door })
    const t = await open()
    await t.prompt()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(envs[0]).not.toHaveProperty('WORFY_ASSIST_TOKEN')
    expect(envs[0]).not.toHaveProperty('WORFY_ASSIST_SOCKET')
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    expect(shown(t.text())).not.toMatch(/zsh: |zsocket|sysread|No such file|not found/)
  })

  it('a shell that is not zsh gets no socket and no token', async () => {
    const admitted: string[] = []
    const door: AssistDoor = {
      admit: (key) => {
        admitted.push(key)
        return Promise.resolve({ socket: '/nowhere', token: 'never' })
      },
      revoke: () => undefined,
    }
    const { open, envs } = start({ door, env: { SHELL: '/bin/sh', PS1: '$ ' } })
    const t = await open()
    t.type('echo "assist:${WORFY_ASSIST_SOCKET-none}:${WORFY_ASSIST_TOKEN-none}:"\r')
    await vi.waitFor(() => expect(t.text()).toContain('assist:none:none:'), WAIT)
    expect(admitted).toEqual([])
    expect(Object.keys(envs[0] ?? {}).filter((name) => name.startsWith('WORFY_'))).toEqual([])
  })
})

describe('the connection while a command runs', () => {
  it('a program the shell starts finds no connection to the socket on any descriptor', async () => {
    const { open, link } = start()
    const t = await open()
    await t.connected()
    const found = await t.run(`${DESCRIPTORS}; (${DESCRIPTORS}) & wait`)
    expect(found.match(/checked/g)).toHaveLength(2)
    expect(found).not.toMatch(/socket:\d|open:[3-9]\r/)
    // The shell is connected again at the prompt after it.
    expect(link.connected(KEY)).toBe(true)
    await vi.waitFor(() => expect(link.push(KEY, { type: 'insert', text: 'echo linked-again' })).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo linked-again'))
  })

  it('an ask a program writes into every descriptor it was given does not reach main', async () => {
    const { t, feature, askAbout, probeOn } = await withAskingScript()
    const written = await t.run(
      `${PROGRAM} 'n=3; while [ $n -le 255 ]; do (printf "ask\\t999\\t${PROBE}\\tworfy-leaked-ask\\n" >&$n) 2>/dev/null; n=$((n + 1)); done; echo written'`,
    )
    expect(written).toContain('written')
    await probeOn()
    // The shell's own asks still reach main, after the ones the program could have sent.
    t.type('echo zz')
    await askAbout('echo zz')
    expect(feature.lines()).not.toContain('worfy-leaked-ask')
    expect(feature.asks.map((each) => each.ask.id)).not.toContain(999)
  })

  it('the shell closes its connection while a command runs and says hello again at the next prompt, after every command', async () => {
    const { open, link } = start()
    const hellos: boolean[] = []
    link.onConnection((key, connected) => {
      if (key === KEY) hellos.push(connected)
    })
    const t = await open()
    await t.connected()
    await vi.waitFor(() => expect(hellos).toEqual([true]), WAIT)

    t.type('sleep 1\r')
    await vi.waitFor(() => expect(t.state()?.commandRunning).toBe(true), WAIT)
    // Main has no connection to write to while the command runs; the shell counts as connected all the same.
    await vi.waitFor(() => expect(link.push(KEY, STALE)).toBe(false), WAIT)
    expect(link.connected(KEY)).toBe(true)
    await vi.waitFor(() => expect(hellos).toEqual([true, true]), WAIT)

    // Commands one after another, builtins among them: each next prompt says hello again.
    for (let index = 0; index < 20; index++) await t.run(index % 2 === 0 ? 'true' : ':')
    await vi.waitFor(() => expect(hellos).toEqual(Array<boolean>(22).fill(true)), WAIT)
    expect(link.push(KEY, { type: 'insert', text: 'echo after-twenty' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo after-twenty'))
    // `exit` closes the connection as any command does; the shell is gone only when its token dies.
    t.type('\x15')
    await t.exit()
    await vi.waitFor(() => expect(hellos).toEqual([...Array<boolean>(22).fill(true), false]), WAIT)
    expect(link.connected(KEY)).toBe(false)
  })

  it('the token says hello again once its connection is closed; while that one is open, a second hello is refused', async () => {
    const { open, integration, link, envs } = start()
    const t = await open()
    await t.connected()
    const path = socketPath(integration.path ?? '')
    const token = envs[0]?.WORFY_ASSIST_TOKEN ?? ''
    // At the prompt the shell holds its connection: the token opens no second one.
    await stranger(path, `hello\t${token}`).untilClosed()

    // While a command runs the shell holds none: the same token opens one again.
    t.type('sleep 1.5\r')
    await vi.waitFor(() => expect(link.push(KEY, STALE)).toBe(false), WAIT)
    const again = stranger(path, `hello\t${token}`)
    await vi.waitFor(() => expect(again.received()).toMatch(/^config\t/), WAIT)
    expect(again.closed()).toBe(false)
    // And while that one is open, a second one is refused.
    const third = stranger(path, `hello\t${token}`)
    await third.untilClosed()
    expect(third.received()).toBe('')
    again.socket.end()
    await again.untilClosed()

    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: false, awaitingInput: true }), WAIT)
    await vi.waitFor(() => expect(link.push(KEY, { type: 'insert', text: 'echo shell-again' })).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo shell-again'))
  })

  it('a connection that closes gives the ask it had open up: its answer is dropped in main, also once the token is connected again', async () => {
    const feature = recordingFeature(PROBE)
    const { link, integration } = start({ features: { [`./features/${PROBE}.ts`]: feature.loader } })
    // A shell played by the test: it sees exactly what main sends.
    const admission = await link.admit('played', await integration.prepare())
    const shell = stranger(admission.socket, `hello\t${admission.token}`)
    await vi.waitFor(() => expect(shell.received()).toMatch(/^config\t/), WAIT)
    shell.socket.write(`ask\t7\t${PROBE}\tbefore the command\n`)
    await vi.waitFor(() => expect(feature.lines()).toEqual(['before the command']), WAIT)
    const [before] = feature.asks
    if (before === undefined) throw new Error('unreachable')

    // The shell closes its connection, as before a command, without a cancel.
    shell.socket.end()
    await vi.waitFor(() => expect(before.ask.signal.aborted).toBe(true), WAIT)
    expect(before.reply.show(' LATE')).toBe(false)
    expect(link.connected('played')).toBe(true)

    const back = stranger(admission.socket, `hello\t${admission.token}`)
    await vi.waitFor(() => expect(back.received()).toMatch(/^config\t/), WAIT)
    expect(before.reply.insert('LATE')).toBe(false)
    expect(before.reply.status('LATE')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(back.received()).not.toContain('LATE')
    expect(back.closed()).toBe(false)
    // The token dies with its shell: so does the connection, and the Terminal counts as gone.
    link.revoke(admission.token)
    await back.untilClosed()
    expect(link.connected('played')).toBe(false)
  })

  it('the line editor inside a command (vared) does not open the connection: what the command starts after it finds none', async () => {
    const { open, link } = start()
    const t = await open()
    await t.connected()
    t.type(`vared -c __test_typed; print -r -- "typed:$__test_typed"; ${DESCRIPTORS}\r`)
    await vi.waitFor(() => expect(t.state()?.commandRunning).toBe(true), WAIT)
    await t.settle()
    expect(link.push(KEY, STALE)).toBe(false)
    const finished = t.events().filter((event) => event.type === 'command-finished').length
    t.type('in-vared\r')
    await vi.waitFor(() => expect(t.events().filter((event) => event.type === 'command-finished')).toHaveLength(finished + 1), WAIT)
    const found = t.state()?.lastOutput ?? ''
    expect(found).toContain('typed:in-vared')
    expect(found).toContain('checked')
    expect(found).not.toMatch(/socket:\d/)
    await vi.waitFor(() => expect(link.push(KEY, { type: 'insert', text: 'echo after-vared' })).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo after-vared'))
  })

  it('a program zshaddhistory starts finds no connection to the socket: the line editor gave the link up before it', async () => {
    const started = start()
    const file = join(root, 'addhistory.txt')
    // zsh 5.9 runs zle-line-finish, then zshaddhistory, then preexec and its hooks, then the command.
    await testScript(started.integration, `zshaddhistory() { ${DESCRIPTORS} >| ${file}; builtin return 0 }`)
    const t = await started.open()
    await t.connected()
    await t.run('echo worfy-history-hook')
    const found = readFileSync(file, 'utf8')
    expect(found).toContain('checked')
    expect(found).not.toMatch(/socket:\d/)
    // A command over three lines: the link opens again for each next line (PS2) and goes after the last.
    removeTestTree(file)
    expect(await t.run('if true; then\recho worfy-three-lines\rfi')).toContain('worfy-three-lines')
    const three = readFileSync(file, 'utf8')
    expect(three).toContain('checked')
    expect(three).not.toMatch(/socket:\d/)
    await vi.waitFor(() => expect(started.link.push(KEY, { type: 'insert', text: 'echo after-history-hook' })).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo after-history-hook'))
  })

  it('with zle-line-finish taken over by another widget, preexec still gives the link up before the command', async () => {
    const started = start()
    await testScript(started.integration, '__test_finish() { : }\nzle -N zle-line-finish __test_finish')
    const t = await started.open()
    await t.connected()
    const found = await t.run(DESCRIPTORS)
    expect(found).toContain('checked')
    expect(found).not.toMatch(/socket:\d/)
    await vi.waitFor(() => expect(started.link.push(KEY, { type: 'insert', text: 'echo finish-replaced' })).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo finish-replaced'))
  })

  it('a program a widget started at the prompt keeps a copy of the descriptor: after the next command the shell is connected again, and the copy reaches main no more', async () => {
    const pidFile = join(root, 'holder.pid')
    const wroteFile = join(root, 'holder.wrote')
    // The program waits, writes an ask into its copy of the connection (a closed one does not kill it), and stays.
    const { t, link, feature, probeOn, askAbout } = await withAskingScript(
      {},
      widgetScript(
        [
          `  ${PROGRAM} "trap '' PIPE; sleep 3; printf 'ask\\t998\\t${PROBE}\\tworfy-holder-ask\\n' >&$__worfy_assist_fd 2>/dev/null; : > ${wroteFile}; exec sleep 30" &!`,
          `  print -r -- $! >| ${pidFile}`,
        ].join('\n'),
      ),
    )
    t.type(WIDGET_KEY)
    await vi.waitFor(() => expect(existsSync(pidFile) && readFileSync(pidFile, 'utf8')).toMatch(/^\d+\n$/), WAIT)
    holders.push(Number(readFileSync(pidFile, 'utf8')))

    await t.run('true')
    // The ask of the program comes after the command: else this test proves nothing.
    expect(existsSync(wroteFile)).toBe(false)
    await vi.waitFor(() => expect(link.push(KEY, { type: 'insert', text: 'echo past-the-holder' })).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo past-the-holder'))
    await vi.waitFor(() => expect(existsSync(wroteFile)).toBe(true), WAIT)
    await probeOn()
    t.type('\x15echo zz')
    await askAbout('echo zz')
    expect(feature.lines()).not.toContain('worfy-holder-ask')
    expect(feature.asks.map((each) => each.ask.id)).not.toContain(998)
  })

  it('bye frees the token at once and closes the connection; what came after it on that connection does not count', async () => {
    expect(parseShellMessage('bye')).toEqual({ type: 'bye' })
    expect(encodeMessage({ type: 'bye' })).toBe('bye')
    expect(parseShellMessage('bye\tnow')).toBeNull()
    const feature = recordingFeature(PROBE)
    const { link, integration } = start({ features: { [`./features/${PROBE}.ts`]: feature.loader } })
    const admission = await link.admit('played', await integration.prepare())
    const first = stranger(admission.socket, `hello\t${admission.token}`)
    await vi.waitFor(() => expect(first.received()).toMatch(/^config\t/), WAIT)
    first.socket.write(`ask\t3\t${PROBE}\tbefore bye\n`)
    await vi.waitFor(() => expect(feature.lines()).toEqual(['before bye']), WAIT)
    // bye gives the open ask up, as a cancel does, and the ask behind it in the same chunk is not read.
    first.socket.write(`bye\nask\t4\t${PROBE}\tafter bye\n`)
    await first.untilClosed()
    await vi.waitFor(() => expect(feature.asks[0]?.ask.signal.aborted).toBe(true), WAIT)
    expect(link.connected('played')).toBe(true)
    const second = stranger(admission.socket, `hello\t${admission.token}`)
    await vi.waitFor(() => expect(second.received()).toMatch(/^config\t/), WAIT)
    expect(second.closed()).toBe(false)
    expect(feature.lines()).toEqual(['before bye'])
  })

  it('the hello of a new connection is taken once the old one ended, before main could close the old one', async () => {
    const { link, integration } = start()
    const admission = await link.admit('played', await integration.prepare())
    const old = stranger(admission.socket, `hello\t${admission.token}`)
    await vi.waitFor(() => expect(old.received()).toMatch(/^config\t/), WAIT)
    // The old connection reads no more, and main writes more than the socket holds: main's own end of
    // it waits behind that, so its `close` cannot come while the test runs.
    old.socket.pause()
    const note = { type: 'status', id: 0, text: 'x'.repeat(60_000) } as const
    for (let sent = 0; sent < 5; sent++) expect(link.push('played', note)).toBe(true)
    old.socket.end()
    const next = stranger(admission.socket, `hello\t${admission.token}`)
    await vi.waitFor(() => expect(next.received()).toMatch(/^config\t/), WAIT)
    expect(next.closed()).toBe(false)
    expect(old.closed()).toBe(false)
  })

  it('the file of the socket was removed: a shell that ran a command is connected again after it', async () => {
    const { open, integration, link } = start()
    const t = await open()
    await t.connected()
    const path = socketPath(integration.path ?? '')
    unlinkSync(path)
    await t.run('sleep 0.5')
    expect(statSync(path).isSocket()).toBe(true)
    await vi.waitFor(() => expect(link.push(KEY, { type: 'insert', text: 'echo file-back' })).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo file-back'))
  })
})

describe('the messages of main', () => {
  it('insert replaces the line and runs nothing: main writes nothing into the pty, Enter is the user\'s', async () => {
    const { open, link, written } = start()
    const t = await open()
    await t.connected()
    t.type('something half typed')
    await t.settle()
    const before = t.events().length
    expect(link.push(KEY, { type: 'insert', text: 'echo worfy-ins-$(( 6 * 7 ))' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo worfy-ins-$(( 6 * 7 ))'))
    await t.settle(400)
    // No command started, and its output is nowhere.
    expect(t.events().slice(before).filter((event) => event.type !== 'prompt')).toEqual([])
    expect(t.text()).not.toContain('worfy-ins-42')
    // Everything the pty was given is what the test typed: no Enter of main's.
    expect(written).toEqual(t.typed)
    expect(t.typed.join('')).not.toMatch(/[\r\n]/)

    expect(await t.run('')).toContain('worfy-ins-42\r\n')
    expect(t.events().slice(before)).toContainEqual({ type: 'command-started', command: 'echo worfy-ins-$(( 6 * 7 ))' })
  })

  it('insert carries a TAB, a backslash, quotes and Cyrillic as they are', async () => {
    const { open, link } = start()
    const t = await open()
    await t.connected()
    const text = "print -r -- 'a\\tb' 'c\\\\d' 'привет 🚀'"
    expect(link.push(KEY, { type: 'insert', text })).toBe(true)
    await t.settle()
    expect(await t.run('')).toContain('a\\tb c\\\\d привет 🚀\r\n')
    expect(t.state()?.commands.at(-1)).toBe(text)
  })

  it('show is drawn in grey for the ask that is open, taken with →; a show for an older ask is not drawn', async () => {
    const { t, link, askAbout, feature } = await withAskingScript()
    t.type('echo zz')
    const current = await askAbout('echo zz')
    const older = feature.asks.find((each) => each.ask.id !== current.ask.id)
    // Every keystroke asked; the asks before the last one were cancelled.
    if (older !== undefined) {
      await vi.waitFor(() => expect(older.ask.signal.aborted).toBe(true), WAIT)
      expect(older.reply.show(' LATE')).toBe(false)
    }
    // An answer that was on its way when the line changed: its id is not the open one.
    expect(link.push(KEY, { type: 'show', id: current.ask.id + 100, text: ' STALE' })).toBe(true)
    if (current.ask.id > 1) expect(link.push(KEY, { type: 'show', id: current.ask.id - 1, text: ' STALE' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo zz'))

    expect(current.ask.signal.aborted).toBe(false)
    expect(current.reply.show(' worfy-shown more')).toBe(true)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo zz', ' worfy-shown more'))
    // Typing the start of the grey text keeps the rest of it.
    t.type(' w')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo zz w', 'orfy-shown more'))
    t.type(ALT_RIGHT)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo zz worfy-shown', ' more'))
    t.type(RIGHT)
    expect(await t.redrawn()).toMatch(lineAlone('echo zz worfy-shown more'))
    expect(await t.run('')).toContain('zz worfy-shown more\r\n')
  })

  it('a changed line cancels the ask, and its answer is dropped in main', async () => {
    const { t, askAbout } = await withAskingScript()
    t.type('echo aa')
    const first = await askAbout('echo aa')
    t.type('b')
    const second = await askAbout('echo aab')
    await vi.waitFor(() => expect(first.ask.signal.aborted).toBe(true), WAIT)
    expect(first.reply.show('LATE')).toBe(false)
    expect(first.reply.insert('LATE')).toBe(false)
    expect(second.ask.signal.aborted).toBe(false)
    expect(second.ask.id).toBeGreaterThan(first.ask.id)
    // Esc gives the open ask up as well.
    t.type(ESC)
    await vi.waitFor(() => expect(second.ask.signal.aborted).toBe(true), WAIT)
    expect(await t.redrawn()).toMatch(lineAlone('echo aab'))
  })

  it('a line changed into one nobody asks about gives the open ask up too', async () => {
    const { t, link, askAbout } = await withAskingScript()
    t.type('echo cc')
    const open = await askAbout('echo cc')
    expect(open.ask.signal.aborted).toBe(false)
    // Ctrl+A and a space: the line now starts with a space, so the script asks nothing new.
    t.type('\x01 ')
    await vi.waitFor(() => expect(open.ask.signal.aborted).toBe(true), WAIT)
    // An answer that left main before the cancel reached it is not drawn on the new line.
    expect(link.push(KEY, { type: 'show', id: open.ask.id, text: ' LATE' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone(' echo cc'))
  })

  it('a line that starts with a space is never sent to main', async () => {
    const { t, feature, askAbout } = await withAskingScript()
    t.type(' echo secret-zz')
    await t.settle(300)
    t.type('\x15echo public-zz')
    await askAbout('echo public-zz')
    expect(feature.lines().filter((line) => line.startsWith(' ') || line.includes('secret'))).toEqual([])
  })

  it('status is a grey note that → does not take; one for an older ask is not drawn', async () => {
    const { t, link, askAbout } = await withAskingScript()
    t.type('echo zz')
    const current = await askAbout('echo zz')
    expect(link.push(KEY, { type: 'status', id: current.ask.id + 100, text: 'STALE' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo zz'))
    expect(current.reply.status('asking Claude…')).toBe(true)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo zz', '  asking Claude…'))
    t.type(`${RIGHT}${ALT_RIGHT}`)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo zz', '  asking Claude…'))
    // An empty note takes it away; a note about no ask (id 0) is drawn whatever is open.
    expect(current.reply.status('')).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo zz'))
    expect(link.push(KEY, { type: 'status', id: 0, text: 'Limits until 14:20' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo zz', '  Limits until 14:20'))
    expect(await t.run('')).toContain('zz\r\n')
  })

  it('an ask for a feature nobody handles, and a handler that throws, leave the shell and the socket as they were', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing: ShellFeature = {
      feature: 'suggest',
      ask: (ask) => {
        throw new Error(`cannot answer ${ask.line}`)
      },
    }
    const started = start({ features: { './features/suggest.ts': () => Promise.resolve(failing) } })
    const dir = await started.integration.prepare()
    await mkdir(join(dir, 'rc.d'), { recursive: true })
    await writeFile(
      join(dir, 'rc.d', '20-test.zsh'),
      '__test_ask() { [[ $BUFFER == *!! ]] && _worfy_assist_ask ${${BUFFER%%:*}:-suggest} "$BUFFER" }\n__worfy_assist_line_hooks+=(__test_ask)\n',
    )
    const t = await started.open()
    await t.connected()
    t.type('suggest: worfy-line-marker !!')
    await vi.waitFor(() => expect(warn.mock.calls.flat().join(' ')).toContain('the feature suggest failed'), WAIT)
    t.type('\x15next: worfy-line-marker !!')
    await t.settle(300)
    expect(started.link.connected(KEY)).toBe(true)
    expect(started.link.push(KEY, { type: 'insert', text: 'echo alive' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo alive'))
    // The line the user typed is in no warning.
    expect(JSON.stringify(warn.mock.calls.map((call) => call.map((each) => (each instanceof Error ? `${each.message} ${each.stack}` : each))))).not.toContain('worfy-line-marker')
  })
})

describe('the settings', () => {
  it('config without the Suggestion: no grey text, from history either; turned back on, it shows again', async () => {
    const settings = settingsSource({ suggestion: false })
    const { open } = start({ settings })
    const t = await open()
    await t.connected()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    const off = await t.redrawn()
    expect(off).toMatch(lineAlone('echo wo'))
    expect(off).not.toMatch(ANY_GREY)

    settings.set({ suggestion: true })
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    // Only the model behind the Suggestion off: the history still suggests.
    settings.set({ suggestionAsksModel: false })
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    settings.set({ enabled: false })
    expect(await t.redrawn()).toMatch(lineAlone('echo wo'))
  })

  it('the same config again (main sends one after every hello) keeps the open ask; a changed one gives it up', async () => {
    const { t, link, askAbout } = await withAskingScript()
    t.type('echo zz')
    const open = await askAbout('echo zz')
    expect(link.push(KEY, { type: 'config', features: [PROBE, HISTORY_FEATURE] })).toBe(true)
    await t.settle(300)
    expect(open.ask.signal.aborted).toBe(false)
    expect(open.reply.show(' kept')).toBe(true)
    expect(await t.redrawn()).toMatch(lineWithGrey('echo zz', ' kept'))
    expect(link.push(KEY, { type: 'config', features: [PROBE] })).toBe(true)
    await vi.waitFor(() => expect(open.ask.signal.aborted).toBe(true), WAIT)
  })

  it('a config goes to every connected shell, once per change of the features', async () => {
    const settings = settingsSource()
    const { open, integration, link } = start({ settings })
    const t = await open()
    await t.connected()
    // A second shell, played by the test: it sees exactly what main sends.
    const admission = await link.admit('listener', integration.path ?? '')
    const listener = stranger(admission.socket, `hello\t${admission.token}`)
    await vi.waitFor(() => expect(listener.received()).toBe('config\thistory suggest next request fix\n'), WAIT)
    // The assist service reports a change that is not one of the settings: nothing is sent.
    settings.poke()
    settings.set({ fix: false })
    settings.poke()
    settings.set({ suggestion: false })
    await vi.waitFor(() => expect(listener.received().split('\n').slice(1, -1)).toEqual(['config\thistory suggest next request', 'config\tnext request']), WAIT)
    expect(listener.closed()).toBe(false)
  })
})

describe('what does not leak and where the widget is not', () => {
  it('the environment of the shell has neither the token nor the socket, also under `setopt allexport`', async () => {
    await userZshrc('setopt allexport')
    const { open, envs, integration } = start()
    const t = await open()
    await t.connected()
    const env = await t.run('env')
    const token = envs[0]?.WORFY_ASSIST_TOKEN ?? 'no token'
    expect(env).toMatch(/HOME=/)
    expect(env).not.toMatch(/WORFY_/)
    expect(env).not.toMatch(/__worfy_/)
    expect(env).not.toContain(token)
    expect(env).not.toContain(socketPath(integration.path ?? 'no folder'))
    // The shell keeps the token to say hello again after every command, in a variable it does not export.
    const kinds = await t.run('print -r -- "kinds:${(t)__worfy_assist_token}:${(t)__worfy_assist_socket}:${(t)__worfy_assist_fd}"')
    expect(kinds).toContain('kinds:scalar:scalar:scalar')
    expect(shown(t.text())).not.toContain(token)
  })

  it('the connection is not on a descriptor programs use by convention: what a widget starts at the prompt finds 3 to 9 closed', async () => {
    const started = start()
    const file = join(root, 'descriptors.txt')
    // zsh has no way to keep a descriptor it opened from the programs it starts. A command finds the
    // connection closed (the tests above); a program a widget starts while zsh waits for a key gets
    // it, above 9, where zsh keeps its own.
    await testScript(started.integration, widgetScript(`  { print -r -- "shell-fd:$__worfy_assist_fd"; ${DESCRIPTORS} } >| ${file}`))
    const t = await started.open()
    await t.connected()
    t.type(WIDGET_KEY)
    await vi.waitFor(() => expect(existsSync(file) && readFileSync(file, 'utf8')).toContain('checked'), WAIT)
    const fds = readFileSync(file, 'utf8')
    const fd = Number(/shell-fd:(\d+)/.exec(fds)?.[1])
    expect(fd).toBeGreaterThanOrEqual(10)
    expect(fds).not.toMatch(/open:[3-9]\n/)
    expect(fds).toContain(`socket:${fd}`)
  })

  it('a zsh started in the Terminal has no widget and no socket', async () => {
    const { open } = start()
    const t = await open()
    await t.connected()
    await t.run('echo worfy-zle-1')
    const from = t.text().length
    t.type('zsh -i\r')
    await vi.waitFor(() => expect(t.state()?.commandRunning).toBe(true), WAIT)
    // What zsh ends a prompt with: CSI sequences, and on Debian the keypad mode its /etc/zsh/zshrc turns on (ESC =).
    // eslint-disable-next-line no-control-regex -- those sequences start with ESC.
    await vi.waitFor(() => expect(shown(t.text().slice(from))).toMatch(/zle[%#] (?:\x1b\[[0-9;?]*[A-Za-z]|\x1b[=>])*$/), WAIT)
    t.type('print -r -- "nested:${+functions[_worfy_assist_ask]}:${+widgets[_worfy_assist_receive]}:${WORFY_ASSIST_TOKEN-none}:${+__worfy_assist_fd}"\r')
    await vi.waitFor(() => expect(t.text().slice(from)).toContain('nested:0:0:none:0'), WAIT)
    // The same history, and no grey text: the nested shell is the user's own zsh.
    t.type('echo wo')
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone('echo wo'))
    expect(line).not.toMatch(ANY_GREY)
    t.type('\x15exit\r')
    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: false, awaitingInput: true }), WAIT)
  })

  it('with zsh-autosuggestions (its _zsh_autosuggest_start is defined) worfy suggests nothing of its own; the messages of main work', async () => {
    await userZshrc('_zsh_autosuggest_start() { : }')
    const { open, link } = start()
    const t = await open()
    await t.connected()
    await t.run('echo worfy-zle-1')
    t.type('echo wo')
    const line = await t.redrawn()
    expect(line).toMatch(lineAlone('echo wo'))
    expect(line).not.toMatch(ANY_GREY)
    expect(link.push(KEY, { type: 'insert', text: 'echo worfy-ins-$(( 6 * 7 ))' })).toBe(true)
    expect(await t.redrawn()).toMatch(lineAlone('echo worfy-ins-$(( 6 * 7 ))'))
    expect(await t.run('')).toContain('worfy-ins-42\r\n')
  })

  it('the socket closed: the Suggestion from history goes on and zsh prints no error, also when it asks with no socket to connect to', async () => {
    const feature = recordingFeature()
    const started = start({ features: { './features/suggest.ts': feature.loader } })
    const dir = await started.integration.prepare()
    await mkdir(join(dir, 'rc.d'), { recursive: true })
    // Asks at the start of every line: once the socket is gone, the ask finds no link to write to.
    await writeFile(
      join(dir, 'rc.d', '20-test.zsh'),
      '__test_ask_at_once() { _worfy_assist_ask suggest "at-line-init"; __test_asked=$? }\nzle -N __test_ask_at_once\nadd-zle-hook-widget line-init __test_ask_at_once\n',
    )
    const t = await started.open()
    await t.connected()
    // zsh reads the socket only while no key waits: the settings reach it once the typing pauses.
    await t.settle(300)
    await t.run('echo worfy-zle-1')
    await vi.waitFor(() => expect(feature.lines()).toContain('at-line-init'), WAIT)

    t.type('sleep 0.6\r')
    await vi.waitFor(() => expect(t.state()?.commandRunning).toBe(true), WAIT)
    started.link.closeSync()
    expect(existsSync(socketPath(dir))).toBe(false)
    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: false, awaitingInput: true }), WAIT)

    t.type('echo wo')
    expect(await t.redrawn()).toMatch(lineWithGrey('echo wo', 'rfy-zle-1'))
    t.type(RIGHT)
    expect(await t.run('')).toContain('worfy-zle-1\r\n')
    // The ask at that prompt failed quietly, and the shell dropped the link.
    expect(await t.run('print -r -- "asked:$__test_asked fd:[$__worfy_assist_fd]"')).toContain('asked:1 fd:[]')
    // Closing the link did not take the shell's own error output with it.
    expect(await t.run('print -r -u2 -- "stderr-$(( 6 * 7 ))"')).toContain('stderr-42\r\n')
    expect(shown(t.text())).not.toMatch(/zsh: |write error|broken pipe|bad file|sysread|zsocket/i)
    expect(t.exited()).toBeNull()
  })

  it('the token, the nonce and the lines of the shell are in no log line and in no error', async () => {
    const logged: unknown[][] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args))
    }
    const { t, envs, integration, askAbout, link } = await withAskingScript(
      { helloTimeoutMs: 300 },
      widgetScript('  print -r -u $__worfy_assist_fd -- "garbage worfy-line-marker"'),
    )
    const token = envs[0]?.WORFY_ASSIST_TOKEN ?? ''
    const nonce = envs[0]?.WORFY_SHELL_NONCE ?? ''
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    const path = socketPath(integration.path ?? '')

    t.type('echo worfy-line-marker')
    await askAbout('echo worfy-line-marker')
    // Strangers: a wrong token, the right token a second time, a line that is no message.
    await stranger(path, `hello\t${'f'.repeat(32)}`).untilClosed()
    await stranger(path, `hello\t${token}`).untilClosed()
    await stranger(path, `worfy-line-marker ${token}`).untilClosed()
    // The shell itself sends a line that is no message (a widget: it holds the connection at the prompt).
    t.type(`\x15${WIDGET_KEY}`)
    await vi.waitFor(() => expect(logged.flat().join(' ')).toContain('sent a line that is not a message'), WAIT)
    await t.exit()
    await vi.waitFor(() => expect(link.connected(KEY)).toBe(false), WAIT)

    const text = JSON.stringify(logged.map((call) => call.map((each) => (each instanceof Error ? `${each.name} ${each.message} ${each.stack}` : each))))
    expect(text).not.toContain(token)
    expect(text).not.toContain(nonce)
    expect(text).not.toContain('worfy-line-marker')
  })
})
