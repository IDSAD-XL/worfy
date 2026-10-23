// The connection of a Terminal's zsh to worfy's main process while zsh waits at the prompt, on a
// real zsh in a real pseudo-terminal (node-pty under Electron's Node) with worfy's shell
// integration. zsh has no close-on-exec for a descriptor it opened, so every program the shell
// starts inherits what the shell holds. The line editor gives the link up before a command
// (terminal-ai-zle.test.ts); here it is what runs at the prompt: the widgets, `zle -F` handlers
// and completion functions worfy did not write, the subshell of Suggest AI's timer, the startup
// files under `allexport`, and main keeping an ask whose connection ended for the shell to ask again.
//
// HOME and the user's files are in a temporary folder: the real ~/.zshrc and ~/.zsh_history of the
// machine running the tests are never read or written.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_PATH, type Env } from '../../src/main/agent/env'
import type { ShellEvent } from '../../src/main/terminal/osc'
import { spawnShellPty, TerminalRegistry, type SpawnPty, type TerminalSink } from '../../src/main/terminal/pty'
import { ShellIntegration } from '../../src/main/terminal/shell-integration'
import { ASK_KEPT_MS, HISTORY_FEATURE, ShellLink, type FeatureLoader, type ShellAsk, type ShellFeature, type ShellReply } from '../../src/main/terminal-ai/shell-link'
import { DEFAULT_TERMINAL_AI_SETTINGS, type TerminalAiSettings } from '../../src/shared/terminal-ai/settings'
import { needsZsh, zshPath } from '../zsh'

const KEY = 'terminal-1'
const WAIT = { timeout: 10_000, interval: 20 }
/** Ubuntu's /etc/zsh/zshrc runs compinit unless this is set, and on the CI runner compinit waits for a key. */
const QUIET_ZSH: Env = { skip_global_compinit: '1' }
/** The name the tests' asks go under: no feature of Terminal AI, so the real features' scripts never ask under it. */
const PROBE = 'probe'
/** Ctrl+X z and Ctrl+X c: keys of the tests' own script. */
const WIDGET_KEY = '\x18z'
const COMPLETE_KEY = '\x18c'

let home: string
let root: string
const registries: TerminalRegistry[] = []
const integrations: ShellIntegration[] = []
const links: ShellLink[] = []
const sockets: Socket[] = []

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-zle-prompt-home-')))
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-zle-prompt-project-')))
  await userZshrc()
})

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
  for (const link of links.splice(0)) link.closeSync()
  for (const integration of integrations.splice(0)) integration.disposeSync()
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const USER_ZSHRC = "PS1='zle%# '\nHISTSIZE=1000\nSAVEHIST=1000\n"
const userZshrc = (more = '') => writeFile(join(home, '.zshrc'), `${USER_ZSHRC}${more}\n`)

/** Runs a script as a program the shell starts: a zsh without startup files (dash stops at a redirect above 9). */
const program = (): string => `${zshPath()} -fc`

/**
 * A program that looks at every descriptor from 3 to 255 it was given and writes `socket:<n>` for one
 * that is a socket, then `checked`, into `file` (appended).
 */
const descriptorsInto = (file: string): string =>
  `${program()} 'n=3; while [ $n -le 255 ]; do if [ -S /dev/fd/$n ]; then echo "socket:$n"; fi; n=$((n + 1)); done; echo checked' >> ${file}`

/** The Unix sockets process `pid` holds open, by descriptor: /proc on Linux, lsof on macOS. */
function socketsOf(pid: number): number[] {
  if (process.platform === 'linux') {
    const dir = `/proc/${pid}/fd`
    return readdirSync(dir)
      .filter((fd) => {
        try {
          return readlinkSync(join(dir, fd)).startsWith('socket:')
        } catch {
          return false
        }
      })
      .map(Number)
  }
  // -F f: one line `f<descriptor>` per open file; -U: Unix sockets only. lsof exits 1 when it found none.
  let out: string
  try {
    out = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-U', '-F', 'f'], { encoding: 'utf8' })
  } catch (error) {
    out = String((error as { stdout?: unknown }).stdout ?? '')
  }
  return [...out.matchAll(/^f(\d+)$/gm)].map((match) => Number(match[1]))
}

/** The settings of Terminal AI, as a test changes them. */
function settingsSource(initial: Partial<TerminalAiSettings> = {}) {
  const settings: TerminalAiSettings = { ...DEFAULT_TERMINAL_AI_SETTINGS, ...initial }
  return { current: () => settings, subscribe: () => () => undefined }
}

/** A feature whose asks the test sees and answers itself. */
function recordingFeature(feature: string) {
  const asks: { ask: ShellAsk; reply: ShellReply }[] = []
  const module: ShellFeature = { feature, ask: (ask, reply) => void asks.push({ ask, reply }) }
  return { asks, loader: (() => Promise.resolve(module)) satisfies FeatureLoader, lines: () => asks.map((each) => each.ask.line) }
}

interface StartOptions {
  env?: Env
  /** The settings as a new install has them (Next command on), instead of the Suggestion from history alone. */
  defaults?: boolean
  settings?: Partial<TerminalAiSettings>
  /** The tests' own script, read after rc.d/10-assist.zsh and 20-suggest-ai.zsh. */
  script?: string
  /** Read before every script of rc.d/ (rc.d/00-test.zsh): what the tests set for the real features. */
  before?: string
  /** main reads the settings once this is resolved: until then no shell is sent a config. */
  settingsRead?: Promise<void>
}

/** One Terminal of a registry with the shell integration over the temporary HOME and the link to its shell. */
async function start(options: StartOptions = {}) {
  const integration = new ShellIntegration()
  integrations.push(integration)
  const feature = recordingFeature(PROBE)
  // Next command's and Command request's asks come to the test, not to a model.
  const next = recordingFeature('next')
  const request = recordingFeature('request')
  // Of the real features only the Suggestion from history is on unless a test says otherwise.
  const off: Partial<TerminalAiSettings> = options.defaults === true ? {} : { suggestionAsksModel: false, nextCommand: false, commandRequest: false, fix: false }
  const link = new ShellLink({
    settings: () => (options.settingsRead ?? Promise.resolve()).then(() => settingsSource({ ...off, ...options.settings })),
    context: { shellState: (terminal) => registry.shellState(terminal), assist: () => Promise.reject(new Error('no assist service in this test')) },
    features: { [`./features/${PROBE}.ts`]: feature.loader, './features/next.ts': next.loader, './features/request.ts': request.loader },
  })
  links.push(link)
  const envs: Env[] = []
  const spawn: SpawnPty = (file, args, spawnOptions) => {
    envs.push(spawnOptions.env)
    return spawnShellPty(file, args, spawnOptions)
  }
  const base: Env = { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8', SHELL: zshPath(), ...options.env }
  const registry: TerminalRegistry = new TerminalRegistry({ env: () => Promise.resolve(base), killGraceMs: 1000, integration, spawn, assist: link })
  registries.push(registry)
  const dir = await integration.prepare()
  await mkdir(join(dir, 'rc.d'), { recursive: true })
  if (options.before !== undefined) await writeFile(join(dir, 'rc.d', '00-test.zsh'), `${options.before}\n`)
  if (options.script !== undefined) await writeFile(join(dir, 'rc.d', '20-test.zsh'), `${options.script}\n`)

  const events: ShellEvent[] = []
  registry.onShellEvent((key, event) => key === KEY && events.push(event))
  const chunks: string[] = []
  const client = {}
  const sink: TerminalSink = { output: (data) => chunks.push(data), exit: () => undefined, started: () => undefined }
  await registry.open(KEY, { cwd: root, cols: 120, rows: 30 }, client, sink)
  const count = (type: ShellEvent['type']) => events.filter((event) => event.type === type).length
  const text = () => chunks.join('')
  const type = (data: string) => registry.write(KEY, data, client)
  await vi.waitFor(() => expect(count('prompt'), `prompts in ${JSON.stringify(text().slice(-2000))}`).toBeGreaterThanOrEqual(1), WAIT)
  await vi.waitFor(() => expect(link.connected(KEY)).toBe(true), WAIT)
  /** The settings name the probe, as they name a real feature that is on; read once the shell holds its link. */
  const probeOn = async () => {
    await vi.waitFor(() => expect(link.push(KEY, { type: 'config', features: [HISTORY_FEATURE, PROBE] })).toBe(true), WAIT)
  }
  return {
    link,
    feature,
    next,
    request,
    envs,
    text,
    type,
    probeOn,
    /** Types one command line and waits for the prompt after it; answers its output. */
    run: async (line: string) => {
      const finished = count('command-finished')
      const prompts = count('prompt')
      type(`${line}\r`)
      await vi.waitFor(() => {
        expect(count('command-finished')).toBe(finished + 1)
        expect(count('prompt')).toBeGreaterThan(prompts)
      }, WAIT)
      return registry.shellState(KEY)?.lastOutput ?? ''
    },
    /** The ask about `line`, once main has it. */
    askAbout: async (line: string) => {
      await vi.waitFor(() => expect(feature.lines()).toContain(line), WAIT)
      const found = feature.asks.findLast((each) => each.ask.line === line)
      if (found === undefined) throw new Error('unreachable')
      return found
    },
  }
}

/** Waits until the shell has read the settings main sent it: the features they turn on can ask then. */
async function configured(t: { run: (line: string) => Promise<string> }): Promise<void> {
  await vi.waitFor(async () => expect(await t.run('print -r -- configured=$__worfy_assist_configured')).toContain('configured=1'), WAIT)
}

/** Waits until `file` holds `checked` `times` times, and answers it. */
async function checkedIn(file: string, times = 1): Promise<string> {
  await vi.waitFor(() => expect(existsSync(file) ? (readFileSync(file, 'utf8').match(/checked/g) ?? []).length : 0).toBeGreaterThanOrEqual(times), WAIT)
  return readFileSync(file, 'utf8')
}

/** A widget of the tests' own script on Ctrl+X z that runs `body`. */
const widgetScript = (body: string) => ['__test_widget() {', body, '}', 'zle -N __test_widget', "bindkey '^Xz' __test_widget"].join('\n')

describe('what runs at the prompt does not get the connection', () => {
  beforeEach(needsZsh)

  it('a program a widget of the user starts at the prompt finds no socket; after the widget main reaches the shell again', async () => {
    const file = join(root, 'widget.txt')
    const t = await start({ script: widgetScript(`  ${descriptorsInto(file)}`) })
    t.type(WIDGET_KEY)
    expect(await checkedIn(file)).not.toMatch(/socket:\d/)
    // The link is back after the widget: an insert of main's (Fix, the ⌘I panel) lands in the line.
    await vi.waitFor(() => expect(t.link.push(KEY, { type: 'insert', text: 'echo after-the-widget' })).toBe(true), WAIT)
    await vi.waitFor(() => expect(t.text()).toContain('echo after-the-widget'), WAIT)
    expect(await t.run('')).toContain('after-the-widget')
  })

  it('a widget that its plugin defines again before every prompt is wrapped again, once, and its program finds no socket after every command', async () => {
    const file = join(root, 'again.txt')
    // As zsh-autosuggestions does: precmd defines the widget's function anew.
    const define = `__test_original() { ${descriptorsInto(file)} }\n__test_define() { builtin functions -c __test_original __test_widget }`
    const t = await start({ script: [define, '__test_define', 'zle -N __test_widget', "bindkey '^Xz' __test_widget", 'precmd_functions+=(__test_define)'].join('\n') })
    for (let round = 1; round <= 3; round++) {
      t.type(WIDGET_KEY)
      expect(await checkedIn(file, round)).not.toMatch(/socket:\d/)
      await t.run('true')
    }
    const body = await t.run('print -r -- "${functions[__test_widget]}"')
    expect(body.match(/_worfy_assist_guard_enter/g)).toHaveLength(1)
  })

  it('a `zle -F` handler of the user starts its program with no socket', async () => {
    const file = join(root, 'handler.txt')
    const fifo = join(root, 'handler.fifo')
    execFileSync('/usr/bin/mkfifo', [fifo])
    // Opened for reading and writing, so neither side waits for the other.
    const t = await start({
      script: [
        `exec {__test_fd}<>${fifo}`,
        `__test_handler() { builtin read -r -u $1 __test_line; ${descriptorsInto(file)} }`,
        'zle -F $__test_fd __test_handler',
      ].join('\n'),
    })
    await t.run('true')
    await writeFile(fifo, 'go\n')
    expect(await checkedIn(file)).not.toMatch(/socket:\d/)
  })

  it('a completion function starts its program with no socket, and completes as before', async () => {
    const file = join(root, 'complete.txt')
    const t = await start({
      script: [
        `__test_completer() { ${descriptorsInto(file)}; compadd worfy-completed }`,
        'zle -C __test_complete complete-word __test_completer',
        "bindkey '^Xc' __test_complete",
      ].join('\n'),
    })
    t.type(`echo `)
    // A grey note of main's is on the line while the completion function runs: it stays, as with no link given up.
    await vi.waitFor(() => expect(t.link.push(KEY, { type: 'status', id: 0, text: 'worfy-note' })).toBe(true), WAIT)
    await vi.waitFor(() => expect(t.text()).toContain('worfy-note'), WAIT)
    t.type(COMPLETE_KEY)
    expect(await checkedIn(file)).not.toMatch(/socket:\d/)
    expect(await t.run('')).toContain('worfy-completed')
    expect(t.text()).not.toMatch(/zsh: |read-only|bad file|zle: /i)
  })

  it('a zle-line-finish hook the user added before worfy, and a prompt substitution on `zle reset-prompt`, start their programs with no socket', async () => {
    const file = join(root, 'hooks.txt')
    await userZshrc(
      [
        'autoload -Uz add-zle-hook-widget',
        `__test_look() { ${descriptorsInto(file)} }`,
        '__test_finish() { __test_look }',
        'zle -N __test_finish',
        'add-zle-hook-widget line-finish __test_finish',
        'setopt prompt_subst',
        "PS1='$(__test_look)zle%# '",
      ].join('\n'),
    )
    const t = await start({ script: widgetScript('  zle reset-prompt') })
    const before = (await checkedIn(file)).match(/checked/g)?.length ?? 0
    t.type(WIDGET_KEY)
    await checkedIn(file, before + 1)
    await t.run('true')
    expect(await checkedIn(file, before + 3)).not.toMatch(/socket:\d/)
  })

  it('with the settings of a new install (Next command on) a widget that leaves the line as it is, pressed five times (as zsh-autosuggestions wraps ← and Ctrl+L), keeps the one ask that waits: main asks the feature once and does not abort it; its answer is drawn', async () => {
    const file = join(root, 'next.txt')
    const t = await start({ defaults: true, script: widgetScript(`  ${descriptorsInto(file)}`) })
    // Next command asks at the first prompt after a command, and waits.
    await t.run('true')
    await vi.waitFor(() => expect(t.next.asks).toHaveLength(1), WAIT)
    const first = t.next.asks[0]
    for (let press = 1; press <= 5; press++) {
      t.type(WIDGET_KEY)
      expect(await checkedIn(file, press)).not.toMatch(/socket:\d/)
    }
    // main sends what the feature answers once the shell asked the same again over its new link.
    expect(first?.reply.show('echo worfy-next-answer')).toBe(true)
    await vi.waitFor(() => expect(t.text()).toContain('echo worfy-next-answer'), WAIT)
    expect(t.next.asks).toHaveLength(1)
    expect(first?.ask.signal.aborted).toBe(false)
  })

  it('a widget that changes the line while an ask waits gives that ask up in main, and asks nothing again', async () => {
    const t = await start({ defaults: true, script: widgetScript('  BUFFER=changed-by-the-widget') })
    await t.run('true')
    await vi.waitFor(() => expect(t.next.asks).toHaveLength(1), WAIT)
    t.type(WIDGET_KEY)
    await vi.waitFor(() => expect(t.next.asks[0]?.ask.signal.aborted).toBe(true), { timeout: ASK_KEPT_MS / 2, interval: 20 })
    expect(t.next.asks).toHaveLength(1)
  })

  it('worfy\'s own widget that cancels the ask inside a widget of the user (Esc under a plugin\'s wrapper) gives it up in main at once, and the ask does not go again', async () => {
    const t = await start({
      defaults: true,
      script: ['_worfy_test_cancel() { _worfy_assist_cancel }', 'zle -N _worfy_test_cancel', widgetScript('  zle _worfy_test_cancel')].join('\n'),
    })
    await t.run('true')
    await vi.waitFor(() => expect(t.next.asks).toHaveLength(1), WAIT)
    t.type(WIDGET_KEY)
    await vi.waitFor(() => expect(t.next.asks[0]?.ask.signal.aborted).toBe(true), { timeout: ASK_KEPT_MS / 2, interval: 20 })
    expect(t.next.asks).toHaveLength(1)
  })

  it('a `zle -F` handler of the user that runs while an ask about a typed line waits: the ask goes again for that line, main keeps it, and its answer is drawn', async () => {
    const file = join(root, 'handler-ask.txt')
    const fifo = join(root, 'handler-ask.fifo')
    execFileSync('/usr/bin/mkfifo', [fifo])
    const t = await start({
      settings: { nextCommand: true },
      script: [
        `exec {__test_fd}<>${fifo}`,
        `__test_handler() { builtin read -r -u $1 __test_line; ${descriptorsInto(file)} }`,
        'zle -F $__test_fd __test_handler',
        // An ask about the line as it is typed, as Suggest AI makes one; a widget named as worfy's, so not wrapped.
        '_worfy_test_ask() { _worfy_assist_ask next "$BUFFER" }',
        'zle -N _worfy_test_ask',
        "bindkey '^Xa' _worfy_test_ask",
      ].join('\n'),
    })
    await configured(t)
    t.type('git sta\x18a')
    await vi.waitFor(() => expect(t.next.lines()).toContain('git sta'), WAIT)
    const asks = t.next.asks.length
    const asked = t.next.asks.at(-1)
    await writeFile(fifo, 'go\n')
    expect(await checkedIn(file)).not.toMatch(/socket:\d/)
    expect(asked?.reply.show(' worfy-handler-answer')).toBe(true)
    await vi.waitFor(() => expect(t.text()).toContain('worfy-handler-answer'), WAIT)
    expect(t.next.asks).toHaveLength(asks)
    expect(asked?.ask.signal.aborted).toBe(false)
  })

  it('Enter on a Command request inside a widget that wraps accept-line (as zsh-autosuggestions binds it) asks main and shows the note; the answer becomes the line', async () => {
    const file = join(root, 'line.txt')
    const t = await start({
      settings: { commandRequest: true },
      script: [
        // zsh-autosuggestions binds its widgets at the first prompt, over what the scripts of worfy put there.
        '__test_bound_accept_line() { zle __test_orig-accept-line -- "$@" }',
        '__test_bind() {',
        '  precmd_functions=(${precmd_functions:#__test_bind})',
        '  zle -N __test_orig-accept-line ${widgets[accept-line]#user:}',
        '  zle -N accept-line __test_bound_accept_line',
        '}',
        'precmd_functions+=(__test_bind)',
        // Ctrl+X l writes the line into the file; to Command request it is the redraw of Enter, not a key of the user's.
        `_worfy_test_line() { __worfy_request_fresh=1; builtin print -r -- "line:[$BUFFER]" >| ${file} }`,
        'zle -N _worfy_test_line',
        "bindkey '^Xl' _worfy_test_line",
      ].join('\n'),
    })
    await configured(t)
    expect(await t.run('print -r -- ${widgets[accept-line]} ${functions[__test_bound_accept_line]}')).toMatch(/user:__test_bound_accept_line[\s\S]*_worfy_assist_guard_enter/)
    t.type('# list big files\r')
    await vi.waitFor(() => expect(t.request.lines()).toEqual(['# list big files']), WAIT)
    await vi.waitFor(() => expect(t.text()).toContain('asking Claude…'), WAIT)
    const asked = t.request.asks[0]
    expect(asked?.ask.signal.aborted).toBe(false)
    expect(asked?.reply.status('')).toBe(true)
    expect(asked?.reply.insert('echo worfy-requested')).toBe(true)
    await vi.waitFor(() => {
      t.type('\x18l')
      expect(existsSync(file) && readFileSync(file, 'utf8')).toBe('line:[echo worfy-requested]\n')
    }, WAIT)
    expect(await t.run('')).toContain('worfy-requested')
  })

  it('a first command typed before the shell read the settings: Next command asks at the prompt after it, once they come', async () => {
    let read: () => void = () => undefined
    const settingsRead = new Promise<void>((resolve) => (read = resolve))
    const t = await start({ settings: { nextCommand: true }, settingsRead })
    await t.run('true')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(t.next.asks).toHaveLength(0)
    read()
    await vi.waitFor(() => expect(t.next.lines()).toEqual(['']), WAIT)
  })

  it('a zle-line-pre-redraw hook of the user (zsh-syntax-highlighting has one) is left alone: no new connection at every key, the ask that waits is asked once and its answer is drawn', async () => {
    await userZshrc(['autoload -Uz add-zle-hook-widget', '__test_redraw() { : }', 'zle -N __test_redraw', 'add-zle-hook-widget line-pre-redraw __test_redraw'].join('\n'))
    const t = await start({ defaults: true })
    await t.run('true')
    await vi.waitFor(() => expect(t.next.asks).toHaveLength(1), WAIT)
    expect(await t.run('print -r -- "${functions[__test_redraw]}"')).not.toContain('_worfy_assist_guard_enter')
    await vi.waitFor(() => expect(t.next.asks).toHaveLength(2), WAIT)
    // Every key and every message of main redraws the line: the hook does not give the link or the ask up.
    expect(t.next.asks[1]?.reply.show('echo worfy-redrawn')).toBe(true)
    await vi.waitFor(() => expect(t.text()).toContain('echo worfy-redrawn'), WAIT)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(t.next.asks).toHaveLength(2)
    expect(t.next.asks[1]?.ask.signal.aborted).toBe(false)
  })

  it('a plugin that keeps the wrapped text of a completion function and wraps it itself (fzf-tab, loaded late or toggled) leaves Tab working, with no loop', async () => {
    const file = join(root, 'tab.txt')
    const t = await start({
      script: [
        `__test_completer() { builtin print -r -- "depth:\${#funcstack}" >> ${file}; compadd worfy-completed }`,
        'zle -C __test_complete complete-word __test_completer',
        "bindkey '^Xc' __test_complete",
        // As fzf-tab does with _main_complete: the text as it is now goes to a name of the plugin's,
        // and the function calls that name; turned off, the function gets that text back.
        '__test_plugin_on() { builtin functions -c __test_completer __test_saved; functions[__test_completer]=\'__test_saved "$@"\' }',
        '__test_plugin_off() { builtin functions -c __test_saved __test_completer }',
      ].join('\n'),
    })
    const tab = async (round: number) => {
      t.type('echo ')
      t.type(COMPLETE_KEY)
      await vi.waitFor(() => expect(existsSync(file) ? (readFileSync(file, 'utf8').match(/depth:/g) ?? []).length : 0).toBe(round), WAIT)
      expect(await t.run('')).toContain('worfy-completed')
    }
    await tab(1)
    for (const [round, step] of [[2, '__test_plugin_on'], [3, '__test_plugin_off'], [4, '__test_plugin_on'], [5, '__test_plugin_off']] as const) {
      await t.run(step)
      await tab(round)
    }
    const depths = [...readFileSync(file, 'utf8').matchAll(/depth:(\d+)/g)].map((match) => Number(match[1]))
    expect(Math.max(...depths)).toBeLessThan(20)
    expect(t.text()).not.toMatch(/maximum nested function level|FUNCNEST/i)
  })

  it('a function whose name starts with a dash (as fzf-tab names its own) is wrapped too', async () => {
    const file = join(root, 'dash.txt')
    const t = await start({
      script: [`__test_body() { ${descriptorsInto(file)} }`, 'builtin functions -c -- __test_body -test-widget', 'zle -N test-dash -test-widget', "bindkey '^Xz' test-dash"].join('\n'),
    })
    t.type(WIDGET_KEY)
    expect(await checkedIn(file)).not.toMatch(/socket:\d/)
    expect(await t.run('print -r -- "${functions[-test-widget]}"')).toContain('_worfy_assist_guard_enter')
  })

  it('what main sent before it read the bye of a widget is not lost: the insert lands once the link is open again', async () => {
    const waiting = join(root, 'slow.waiting')
    const go = join(root, 'slow.go')
    // A widget named as worfy's own, so the link stays while it waits: main's insert reaches the
    // shell's side of the connection first, then a widget of the user's gives the link up.
    const t = await start({
      script: [
        'zmodload zsh/zselect',
        '__test_noop() { : }',
        'zle -N __test_noop',
        '_worfy_test_slow() {',
        `  builtin print -r -- waiting >| ${waiting}`,
        '  builtin local -i n=0',
        `  while [[ ! -e ${go} ]] && (( n++ < 500 )); do zselect -t 2; done`,
        '  zle __test_noop',
        '}',
        'zle -N _worfy_test_slow',
        "bindkey '^Xz' _worfy_test_slow",
      ].join('\n'),
    })
    t.type(WIDGET_KEY)
    await vi.waitFor(() => expect(existsSync(waiting)).toBe(true), WAIT)
    expect(t.link.push(KEY, { type: 'insert', text: 'echo drained-insert' })).toBe(true)
    await writeFile(go, '')
    await vi.waitFor(() => expect(t.text()).toContain('echo drained-insert'), WAIT)
    expect(await t.run('')).toContain('drained-insert')
  })
})

describe('the subshell of the Suggest AI timer and the startup files', () => {
  beforeEach(needsZsh)

  it('the subshell of the Suggest AI timer holds no socket', async () => {
    const file = join(root, 'timer.txt')
    const t = await start({
      settings: { suggestionAsksModel: true },
      // The pause is long: the timer's subshell waits while the test looks at it.
      before: 'typeset -g __worfy_suggest_pause_ms=30000',
      script: widgetScript(`  builtin print -r -- "$__worfy_suggest_pid" >| ${file}`),
    })
    // The settings come after the hello; the line asks for a timer once Suggest AI is on.
    t.type('x')
    await vi.waitFor(() => {
      t.type(WIDGET_KEY)
      expect(existsSync(file) && readFileSync(file, 'utf8')).toMatch(/^\d+\n$/)
    }, WAIT)
    const pid = Number(readFileSync(file, 'utf8'))
    expect(() => process.kill(pid, 0)).not.toThrow()
    expect(socketsOf(pid)).toEqual([])
  })

  it('under `allexport` from the start (as /etc/zshenv may set it) the programs of the user\'s .zshenv and .zshrc do not see the token', async () => {
    const bin = join(home, 'bin')
    await mkdir(bin)
    // A zsh whose `allexport` is on before any startup file is read; its name is zsh, so worfy treats it as one.
    const wrapper = join(bin, 'zsh')
    await writeFile(wrapper, `#!/bin/sh\nexec ${zshPath()} -o allexport "$@"\n`)
    chmodSync(wrapper, 0o755)
    const zshenvFile = join(root, 'zshenv-env.txt')
    const zshrcFile = join(root, 'zshrc-env.txt')
    await writeFile(join(home, '.zshenv'), `[[ -o allexport ]] && echo allexport-on >| ${zshenvFile}; /usr/bin/env >> ${zshenvFile}\n`)
    await userZshrc(`[[ -o allexport ]] && echo allexport-on >| ${zshrcFile}; /usr/bin/env >> ${zshrcFile}`)
    const t = await start({ env: { SHELL: wrapper } })
    const token = t.envs[0]?.WORFY_ASSIST_TOKEN
    expect(token).toMatch(/\S{16}/)
    for (const found of [readFileSync(zshenvFile, 'utf8'), readFileSync(zshrcFile, 'utf8')]) {
      expect(found).toContain('allexport-on')
      expect(found).toMatch(/HOME=/)
      expect(found).not.toContain(token)
      expect(found).not.toMatch(/__worfy_assist_(token|socket)=/)
      expect(found).not.toMatch(/__worfy_nonce=/)
    }
  })
})

/** A shell the test plays over the socket of `link`: it writes the lines and sees exactly what main sends. */
async function playedShell(link: ShellLink) {
  const integration = new ShellIntegration()
  integrations.push(integration)
  const admission = await link.admit('played', await integration.prepare())
  return async () => {
    const socket = createConnection(admission.socket)
    sockets.push(socket)
    let received = ''
    let closed = false
    socket.on('data', (chunk: Buffer) => (received += chunk.toString('utf8')))
    socket.on('error', () => undefined)
    socket.on('close', () => (closed = true))
    socket.write(`hello\t${admission.token}\n`)
    await vi.waitFor(() => expect(received).toMatch(/^config\t/), WAIT)
    return {
      write: (line: string) => socket.write(`${line}\n`),
      received: () => received,
      /** Says bye and waits for main to close the connection. */
      bye: async () => {
        socket.write('bye\n')
        await vi.waitFor(() => expect(closed).toBe(true), WAIT)
      },
    }
  }
}

describe('an ask whose connection ended without a cancel', () => {
  function linkWithProbe() {
    const feature = recordingFeature(PROBE)
    const link = new ShellLink({
      settings: () => Promise.resolve(settingsSource()),
      context: { shellState: () => null, assist: () => Promise.reject(new Error('no assist service in this test')) },
      features: { [`./features/${PROBE}.ts`]: feature.loader },
    })
    links.push(link)
    return { link, feature }
  }

  it(`the same ask over the next connection within ${ASK_KEPT_MS} ms takes it up: the feature is asked once, what it answered meanwhile arrives, a cancel then gives it up`, async () => {
    const { link, feature } = linkWithProbe()
    const connect = await playedShell(link)
    const first = await connect()
    first.write(`ask\t7\t${PROBE}\tgit sta`)
    await vi.waitFor(() => expect(feature.lines()).toEqual(['git sta']), WAIT)
    const [open] = feature.asks
    await first.bye()
    // The answer comes while the shell has no connection: it waits for the same ask.
    expect(open?.reply.show('sh')).toBe(true)
    const second = await connect()
    second.write(`ask\t7\t${PROBE}\tgit sta`)
    await vi.waitFor(() => expect(second.received()).toContain('show\t7\tsh\n'), WAIT)
    expect(feature.asks).toHaveLength(1)
    expect(open?.ask.signal.aborted).toBe(false)
    second.write('cancel\t7')
    await vi.waitFor(() => expect(open?.ask.signal.aborted).toBe(true), WAIT)
  })

  it(`another line under the same id takes its place; with no ask again it is given up after ${ASK_KEPT_MS} ms`, async () => {
    const { link, feature } = linkWithProbe()
    const connect = await playedShell(link)
    const first = await connect()
    first.write(`ask\t7\t${PROBE}\tgit sta`)
    await vi.waitFor(() => expect(feature.asks).toHaveLength(1), WAIT)
    await first.bye()
    const second = await connect()
    second.write(`ask\t7\t${PROBE}\tgit stash`)
    await vi.waitFor(() => expect(feature.lines()).toEqual(['git sta', 'git stash']), WAIT)
    expect(feature.asks[0]?.ask.signal.aborted).toBe(true)
    const kept = feature.asks[1]
    const ended = Date.now()
    await second.bye()
    await vi.waitFor(() => expect(kept?.ask.signal.aborted).toBe(true), { timeout: ASK_KEPT_MS + WAIT.timeout, interval: 20 })
    expect(Date.now() - ended).toBeGreaterThanOrEqual(ASK_KEPT_MS - 50)
    expect(kept?.reply.show('late')).toBe(false)
  })
})
