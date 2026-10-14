// The shell integration of zsh in Terminal Nodes, on a real zsh in a real pseudo-terminal (node-pty
// under Electron's Node): worfy's ZDOTDIR reads the user's startup files and keeps the user's
// history, the OSC 633 sequences with the nonce give main the state of the Terminal, and nothing
// else (another shell, the registry of "Sign in with gh") gets any of it.
//
// HOME and the user's files are in a temporary folder: the real ~/.zshrc and ~/.zsh_history of the
// machine running the tests are never read. The system files (/etc/zshrc) take part, as they do in
// a Terminal: on macOS that is where HISTFILE is set from ZDOTDIR.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_PATH, type Env } from '../../src/main/agent/env'
import type { ShellEvent } from '../../src/main/terminal/osc'
import { REPLAY_LIMIT, TerminalRegistry, type TerminalSink } from '../../src/main/terminal/pty'
import { ShellIntegration, SOCKET_PATH_MAX, socketPath } from '../../src/main/terminal/shell-integration'
import { removeTestTree } from '../remove'

/** The zsh of the machine: /bin/zsh on macOS, /usr/bin/zsh on Linux CI (.github/workflows/ci.yml). */
const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()
const KEY = 'terminal-1'
const WAIT = { timeout: 10_000, interval: 20 }
/**
 * Ubuntu's /etc/zsh/zshrc runs compinit unless skip_global_compinit is set, and on the CI runner
 * compinit finds insecure folders in fpath and waits for a key; zsh without worfy waits the same.
 * The variable is the switch Ubuntu documents in that file.
 */
const QUIET_ZSH: Env = { skip_global_compinit: '1' }
/** One of worfy's sequences, whatever the nonce. */
// eslint-disable-next-line no-control-regex -- the sequences start with ESC.
const WORFY_OSC = /\x1b\]633;/

let home: string
let root: string
const registries: TerminalRegistry[] = []
const integrations: ShellIntegration[] = []

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-zsh-home-')))
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-zsh-project-')))
})

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
  for (const integration of integrations.splice(0)) integration.disposeSync()
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** What the same zsh with the same HOME prints without worfy: a login, interactive shell running `command`. */
function withoutWorfy(command: string): string {
  return execFileSync(ZSH, ['-l', '-i', '-c', command], {
    env: { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, TERM: 'xterm-256color', TERM_PROGRAM: 'worfy', LANG: 'en_US.UTF-8' },
    encoding: 'utf8',
  })
}

/** The nonce of the Terminal's shell, from the first A it printed. */
function nonceIn(text: string): string {
  // eslint-disable-next-line no-control-regex -- the sequence starts with ESC.
  const nonce = /\x1b\]633;A;([0-9a-f]{32})\x07/.exec(text)?.[1]
  if (nonce === undefined) throw new Error('no A sequence in the output')
  return nonce
}

/** The output as xterm.js shows it: OSC sequences end on BEL, ESC \\ or U+009C and are not shown. */
// eslint-disable-next-line no-control-regex -- the sequences are made of control characters.
const shown = (text: string) => text.replace(/\x1b\][^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)/g, '')

/** The user's startup files, in HOME or in a folder under it. */
async function userFiles(files: Record<string, string>, folder = home): Promise<void> {
  await mkdir(folder, { recursive: true })
  for (const [name, text] of Object.entries(files)) await writeFile(join(folder, name), `${text}\n`)
}

async function hashes(folder: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
  }
  return out
}

interface StartOptions {
  /** SHELL of the login environment; null leaves it out. */
  shell?: string | null
  /** False: a registry without the integration, as "Sign in with gh" has. */
  integration?: boolean | ShellIntegration
  env?: Env
}

/** A registry of Terminals over the temporary HOME, and helpers to drive one Terminal of it. */
async function start(options: StartOptions = {}) {
  const integration = options.integration instanceof ShellIntegration ? options.integration : new ShellIntegration()
  integrations.push(integration)
  const shell = options.shell === undefined ? ZSH : options.shell
  const base: Env = { ...QUIET_ZSH, PATH: SYSTEM_PATH, HOME: home, LANG: 'en_US.UTF-8', LESS: '', ...(shell === null ? {} : { SHELL: shell }), ...options.env }
  const registry = new TerminalRegistry({
    env: () => Promise.resolve(base),
    killGraceMs: 1000,
    ...(options.integration === false ? {} : { integration }),
  })
  registries.push(registry)
  const events: { key: string; event: ShellEvent }[] = []
  registry.onShellEvent((key, event) => events.push({ key, event }))
  return { registry, integration, events, open: (key = KEY) => openTerminal(registry, events, key) }
}

async function openTerminal(registry: TerminalRegistry, allEvents: { key: string; event: ShellEvent }[], key: string) {
  const chunks: string[] = []
  let exit: number | null = null
  const sink: TerminalSink = {
    output: (data) => chunks.push(data),
    exit: (exitCode) => (exit = exitCode),
    started: () => undefined,
  }
  const client = {}
  const opened = await registry.open(key, { cwd: root, cols: 120, rows: 30 }, client, sink)
  const events = () => allEvents.filter((each) => each.key === key).map((each) => each.event)
  const finished = () => events().filter((event) => event.type === 'command-finished')
  const text = () => chunks.join('')
  const state = () => registry.shellState(key)
  const type = (data: string) => registry.write(key, data, client)
  const terminal = {
    opened,
    text,
    state,
    events,
    type,
    exited: () => exit,
    /** Waits for the shell's prompt (B with its nonce). */
    prompt: async (count = 1) => {
      const prompts = () => events().filter((event) => event.type === 'prompt').length
      // On failure the message shows what the shell printed instead.
      await vi.waitFor(() => expect(prompts(), `prompts in ${JSON.stringify(text().slice(-3000))}`).toBeGreaterThanOrEqual(count), WAIT)
    },
    /** Types one command line and waits until it finished and the next prompt is shown; answers its event. */
    run: async (line: string, timeout = WAIT.timeout) => {
      const before = finished().length
      const prompts = events().filter((event) => event.type === 'prompt').length
      type(`${line}\r`)
      await vi.waitFor(() => {
        expect(finished().length).toBe(before + 1)
        expect(events().filter((event) => event.type === 'prompt').length).toBeGreaterThan(prompts)
      }, { ...WAIT, timeout })
      return finished()[before] as Extract<ShellEvent, { type: 'command-finished' }>
    },
    /** Waits until the output since `from` matches. */
    output: async (pattern: RegExp, from = 0) => {
      await vi.waitFor(() => expect(text().slice(from)).toMatch(pattern), WAIT)
    },
    /** Types `exit` and waits for the shell to end. */
    exit: async () => {
      type('exit\r')
      await vi.waitFor(() => expect(exit).not.toBeNull(), WAIT)
    },
  }
  return terminal
}

/** The four startup files, each setting its own variable and the HISTFILE settings of the user. */
const FOUR_FILES = {
  '.zshenv': 'export Z_ENV=env-loaded',
  '.zprofile': 'export Z_PROFILE=profile-loaded',
  '.zshrc': 'Z_RC=rc-loaded',
  '.zlogin': 'Z_LOGIN=login-loaded',
}
const PRINT_FILES = 'print -r -- "files:$Z_ENV,$Z_PROFILE,$Z_RC,$Z_LOGIN zdotdir:${ZDOTDIR-unset}"'

describe("worfy's ZDOTDIR reads the user's startup files", () => {
  it('.zshenv, .zprofile, .zshrc and .zlogin of HOME are read, worfy\'s .zlogin gives ZDOTDIR back, and the files are not changed', async () => {
    await userFiles(FOUR_FILES)
    const before = await hashes(home)
    const { open, integration } = await start()
    const t = await open()
    await t.prompt()
    const done = await t.run(PRINT_FILES)
    expect(done.exitCode).toBe(0)
    // worfy's .zlogin ran: the shell's ZDOTDIR is no longer worfy's folder (unset: the user had none).
    expect(t.state()?.lastOutput).toContain('files:env-loaded,profile-loaded,rc-loaded,login-loaded zdotdir:unset')
    expect(integration.path).not.toBeNull()
    await t.exit()
    // Only the history file may have been added; the user's files are the same bytes.
    const after = await hashes(home)
    for (const [path, hash] of Object.entries(before)) expect({ path, hash: after[path] }).toEqual({ path, hash })
  })

  it('the same when the user\'s .zshenv moves ZDOTDIR to $HOME/zdot and the other files are there', async () => {
    const zdot = join(home, 'zdot')
    await userFiles({ '.zshenv': 'export Z_ENV=env-loaded; export ZDOTDIR=$HOME/zdot' })
    await userFiles(Object.fromEntries(Object.entries(FOUR_FILES).filter(([name]) => name !== '.zshenv')), zdot)
    const before = await hashes(home)
    const { open } = await start()
    const t = await open()
    await t.prompt()
    await t.run(PRINT_FILES)
    expect(t.state()?.lastOutput).toContain(`files:env-loaded,profile-loaded,rc-loaded,login-loaded zdotdir:${zdot}`)
    await t.exit()
    const after = await hashes(home)
    for (const [path, hash] of Object.entries(before)) expect({ path, hash: after[path] }).toEqual({ path, hash })
  })
})

describe("the user's ZDOTDIR while their files run", () => {
  it('a .zshenv that sets ZDOTDIR only when it is unset (the XDG form) reads the same .zshrc and ends with the same ZDOTDIR as without worfy', async () => {
    await userFiles({ '.zshenv': ': ${ZDOTDIR:=$HOME/zdot}; export ZDOTDIR' })
    await userFiles({ '.zshrc': 'ZRC=loaded' }, join(home, 'zdot'))
    const print = 'print -r -- "ZRC=[$ZRC] ZDOTDIR=[$ZDOTDIR] exported=[${(t)ZDOTDIR}]"'
    const expected = /ZRC=.*/.exec(withoutWorfy(print))?.[0]
    expect(expected).toBe(`ZRC=[loaded] ZDOTDIR=[${join(home, 'zdot')}] exported=[scalar-export]`)
    const { open } = await start()
    const t = await open()
    await t.prompt()
    await t.run(print)
    expect(t.state()?.lastOutput).toContain(`${expected}\r`)
  })

  it('a ZDOTDIR the user has in the environment is theirs while their .zshenv runs', async () => {
    const zdot = join(home, 'zdot')
    await userFiles({ '.zshrc': 'ZRC=loaded' }, zdot)
    await userFiles({ '.zshenv': 'ZENV="zdotdir in zshenv: $ZDOTDIR"' }, zdot)
    const { open } = await start({ env: { ZDOTDIR: zdot } })
    const t = await open()
    await t.prompt()
    await t.run('print -r -- "$ZENV|$ZRC|$ZDOTDIR"')
    expect(t.state()?.lastOutput).toContain(`zdotdir in zshenv: ${zdot}|loaded|${zdot}\r`)
  })
})

describe('the history stays the user\'s', () => {
  it('a line of $HOME/.zsh_history is there in a new Terminal, and a typed command goes back to it, not to worfy\'s folder', async () => {
    await writeFile(join(home, '.zsh_history'), 'echo from-the-past\n')
    await userFiles({ '.zshrc': 'HISTSIZE=100; SAVEHIST=100' })
    const { open, integration } = await start()
    const t = await open()
    await t.prompt()
    await t.run('fc -ln -1')
    expect(t.state()?.lastOutput).toMatch(/echo from-the-past/)
    await t.run('echo typed-in-worfy')
    await t.exit()
    const history = await readFile(join(home, '.zsh_history'), 'utf8')
    expect(history).toContain('echo typed-in-worfy')
    expect(existsSync(join(integration.path ?? '', '.zsh_history'))).toBe(false)
  })

  it('a HISTFILE the user\'s .zshrc sets wins', async () => {
    await userFiles({ '.zshrc': 'HISTFILE=$HOME/custom_hist; HISTSIZE=100; SAVEHIST=100' })
    const { open } = await start()
    const t = await open()
    await t.prompt()
    await t.run('echo to-custom')
    await t.exit()
    expect(await readFile(join(home, 'custom_hist'), 'utf8')).toContain('echo to-custom')
    expect(existsSync(join(home, '.zsh_history'))).toBe(false)
  })

  it('a HISTFILE of the user\'s .zshenv ends where it would without worfy', async () => {
    await userFiles({ '.zshenv': 'HISTFILE=$HOME/envhist' })
    // The same zsh with the same HOME, without worfy's ZDOTDIR.
    const without = withoutWorfy('print -r -- "hf:$HISTFILE"')
    const expected = /hf:(.*)/.exec(without)?.[1]
    const { open } = await start()
    const t = await open()
    await t.prompt()
    await t.run('print -r -- "hf:$HISTFILE"')
    expect(t.state()?.lastOutput).toContain(`hf:${expected}\r`)
    // macOS: /etc/zshrc sets it from ZDOTDIR after .zshenv; Linux (Debian's /etc/zsh/zshrc): .zshenv's stays.
    expect(expected).toBe(process.platform === 'darwin' ? join(home, '.zsh_history') : join(home, 'envhist'))
  })
})

describe('the state of the Terminal, from the sequences with the nonce', () => {
  it('folder, exit code, a running command; a sequence without the nonce changes nothing; WORFY_ variables are not exported', async () => {
    await mkdir(join(root, 'sub'))
    const { open } = await start()
    const t = await open()
    await t.prompt()
    expect(t.state()).toMatchObject({ cwd: root, awaitingInput: true, commandRunning: false })

    await t.run('cd sub')
    expect(t.state()?.cwd).toBe(join(root, 'sub'))
    expect((await t.run('false')).exitCode).toBe(1)
    expect(t.state()?.exitCode).toBe(1)
    expect((await t.run('true')).exitCode).toBe(0)
    expect(t.state()?.exitCode).toBe(0)

    const before = t.events().length
    t.type('sleep 1\r')
    await vi.waitFor(() => expect(t.state()?.commandRunning).toBe(true), WAIT)
    expect(t.state()?.awaitingInput).toBe(false)
    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: false, awaitingInput: true }), WAIT)
    expect(t.events().slice(before)).toEqual([
      { type: 'command-started', command: 'sleep 1' },
      { type: 'command-finished', command: 'sleep 1', exitCode: 0 },
      { type: 'prompt' },
    ])

    // A program prints a D and an E without the nonce: only the shell's own D counts.
    const forging = t.events().length
    await t.run("printf '\\e]633;D;7\\a\\e]633;E;forged\\a\\e]133;D;9\\a'; (exit 5)")
    expect(t.events().slice(forging).filter((event) => event.type === 'command-finished')).toEqual([
      { type: 'command-finished', command: "printf '\\e]633;D;7\\a\\e]633;E;forged\\a\\e]133;D;9\\a'; (exit 5)", exitCode: 5 },
    ])
    expect(t.state()?.exitCode).toBe(5)
    expect(t.state()?.commands).not.toContain('forged')

    await t.run('print -r -- "worfy-env:$(env | grep -c WORFY_)"')
    expect(t.state()?.lastOutput).toContain('worfy-env:0')
    expect(t.state()?.commands).toEqual([
      'cd sub',
      'false',
      'true',
      'sleep 1',
      "printf '\\e]633;D;7\\a\\e]633;E;forged\\a\\e]133;D;9\\a'; (exit 5)",
      'print -r -- "worfy-env:$(env | grep -c WORFY_)"',
    ])
  })

  it('a zsh started in the Terminal prints none of worfy\'s sequences', async () => {
    await userFiles({ '.zshrc': "PS1='user%# '" })
    const { open } = await start()
    const t = await open()
    await t.prompt()
    const from = t.text().length
    t.type('zsh -i\r')
    await vi.waitFor(() => expect(t.state()?.commandRunning).toBe(true), WAIT)
    // The nested shell's own prompt, from the user's .zshrc.
    await t.output(/user%/, t.text().indexOf('\x1b]633;C;', from))
    t.type('print -r -- nested-$(( 6 * 7 ))\r')
    await t.output(/nested-42/, from)
    t.type('exit\r')
    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: false, awaitingInput: true }), WAIT)
    const nested = t.state()?.lastOutput ?? ''
    expect(nested).toContain('nested-42')
    expect(nested).not.toMatch(WORFY_OSC)
  })

  it('less is on the alternate screen while it runs; a line that starts with a space stays out of the list', async () => {
    await writeFile(join(root, 'long.txt'), Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n'))
    const { open } = await start()
    const t = await open()
    await t.prompt()
    t.type('less long.txt\r')
    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: true, altScreen: true }), WAIT)
    t.type('q')
    await vi.waitFor(() => expect(t.state()).toMatchObject({ commandRunning: false, altScreen: false }), WAIT)

    const secret = await t.run(' echo secret')
    expect(secret).toEqual({ type: 'command-finished', command: null, exitCode: 0 })
    expect(t.state()?.commands).toEqual(['less long.txt'])
    expect(t.events().some((event) => event.type === 'command-started' && event.command?.includes('secret') === true)).toBe(false)
  })

  it('`setopt allexport` in the user\'s .zshrc exports nothing of worfy\'s: the nonce is not in the environment', async () => {
    await userFiles({ '.zshrc': 'setopt allexport' })
    const { open } = await start()
    const t = await open()
    await t.prompt()
    await t.run('env')
    const nonce = nonceIn(t.text())
    const env = t.state()?.lastOutput ?? ''
    expect(env).toMatch(/HOME=/)
    expect(env).not.toContain(nonce)
    expect(env).not.toMatch(/__worfy_/)
  })

  it('output that ends in a broken ESC [ does not swallow the D after it (prompt_sp off)', async () => {
    await userFiles({ '.zshrc': 'unsetopt prompt_sp' })
    const { open } = await start()
    const t = await open()
    await t.prompt()
    const done = await t.run("printf 'x\\e['")
    expect(done).toEqual({ type: 'command-finished', command: "printf 'x\\e['", exitCode: 0 })
    expect(t.state()).toMatchObject({ commandRunning: false, awaitingInput: true })
  })

  it('a folder and a command with U+009C: the screen shows no tail of a sequence, main reads them exactly', async () => {
    const folder = 'c1\u009cdir'
    await mkdir(join(root, folder))
    const { open } = await start()
    const t = await open()
    await t.prompt()
    await t.run('cd c1*dir')
    expect(t.state()?.cwd).toBe(join(root, folder))
    await t.run(': c1\u009cx')
    expect(t.state()?.commands).toContain(': c1\u009cx')
    // Not escaped, U+009C would end the sequence in xterm.js, and `b;<nonce>` would be printed.
    expect(shown(t.text())).not.toContain(nonceIn(t.text()))
  })

  it('a PS1 rebuilt in a precmd hook (as prompt frameworks do) still gets A and B on every prompt, once', async () => {
    await userFiles({
      '.zshrc': [
        "PS1='start%# '",
        'autoload -Uz add-zsh-hook',
        // A hook that adds the hook that builds PS1 only on the first prompt, after worfy's was added.
        '__fw_lazy() { add-zsh-hook precmd __fw_build; add-zsh-hook -d precmd __fw_lazy }',
        '__fw_build() { PS1="built-$((++__fw_count))%# " }',
        'add-zsh-hook precmd __fw_lazy',
      ].join('\n'),
    })
    const { open } = await start()
    const t = await open()
    await t.prompt()
    for (const n of [1, 2, 3]) await t.run(`echo run-${n}`)
    // The hooks before worfy's do not hide the exit code of the command from it.
    expect((await t.run('false')).exitCode).toBe(1)
    const prompts = t.events().filter((event) => event.type === 'prompt').length
    expect(prompts).toBe(5)
    const text = t.text()
    const count = (pattern: RegExp) => [...text.matchAll(pattern)].length
    /* eslint-disable no-control-regex -- the sequences are ESC ] … BEL. */
    expect(count(/\x1b\]633;A;[0-9a-f]{32}\x07/g)).toBe(prompts)
    expect(count(/\x1b\]633;B;[0-9a-f]{32}\x07/g)).toBe(prompts)
    // Every prompt is wrapped whole: A, the prompt the user built, B.
    expect(count(/\x1b\]633;A;[0-9a-f]{32}\x07(start|built-\d+)[%#] \x1b\]633;B;[0-9a-f]{32}\x07/g)).toBe(prompts)
    /* eslint-enable no-control-regex */
    expect(text).toMatch(/built-4[%#] /)
  })
})

describe("worfy's folder", () => {
  it('a folder emptied or removed (as macOS dirhelper does) is written anew by the next Terminal', async () => {
    await userFiles(FOUR_FILES)
    const { open, integration } = await start()
    const first = await open('first')
    await first.prompt()
    const dir = integration.path ?? ''
    expect((await readdir(dir)).sort()).toEqual(['.zlogin', '.zprofile', '.zshenv', '.zshrc', 'integration.zsh', 'rc.d'])
    expect((await readdir(join(dir, 'rc.d'))).sort()).toEqual((await readdir(join(import.meta.dirname, '../../src/main/terminal/zsh/rc.d'))).filter((name) => name.endsWith('.zsh')).sort())

    for (const name of await readdir(dir)) removeTestTree(join(dir, name))
    const second = await open('second')
    await second.prompt()
    await second.run(PRINT_FILES)
    expect(second.state()?.lastOutput).toContain('files:env-loaded,profile-loaded,rc-loaded,login-loaded')

    removeTestTree(dir)
    const third = await open('third')
    await third.prompt()
    await third.run(PRINT_FILES)
    expect(third.state()?.lastOutput).toContain('files:env-loaded,profile-loaded,rc-loaded,login-loaded')
    expect(integration.path).toBe(dir)
  })

  it('the socket path in it fits zsh (103 bytes); with a long TMPDIR the folder goes to /tmp; it is removed with worfy', async () => {
    const usual = new ShellIntegration()
    integrations.push(usual)
    const dir = await usual.prepare()
    expect(Buffer.byteLength(socketPath(dir))).toBeLessThanOrEqual(SOCKET_PATH_MAX)

    const longTmp = join(tmpdir(), 'x'.repeat(120))
    const long = new ShellIntegration({ tmpdir: () => longTmp })
    integrations.push(long)
    const short = await long.prepare()
    expect(short.startsWith('/tmp/worfy-')).toBe(true)
    expect(Buffer.byteLength(socketPath(short))).toBeLessThanOrEqual(SOCKET_PATH_MAX)
    expect(existsSync(longTmp)).toBe(false)

    long.disposeSync()
    expect(existsSync(short)).toBe(false)
  })
})

describe('no integration where it does not belong', () => {
  it('a shell that is not zsh (/bin/sh): no ZDOTDIR of worfy, no sequences, no state', async () => {
    const { open, integration } = await start({ shell: '/bin/sh', env: { PS1: '$ ' } })
    const t = await open()
    t.type('echo "zd:${ZDOTDIR-none}:$WORFY_SHELL_NONCE:"\r')
    await t.output(/zd:none::/)
    expect(t.text()).not.toMatch(WORFY_OSC)
    expect(t.state()).toBeNull()
    expect(integration.path).toBeNull()
  })

  it('zsh in a registry without the integration (as "Sign in with gh"): the same', async () => {
    // Without any startup file zsh on Debian and Ubuntu opens zsh-newuser-install, which waits for a key.
    await userFiles({ '.zshrc': "PS1='$ '" })
    const { open } = await start({ integration: false })
    const t = await open()
    t.type('echo "zd:${ZDOTDIR-none}:$WORFY_SHELL_NONCE:"\r')
    await t.output(/zd:none::/)
    expect(t.text()).not.toMatch(WORFY_OSC)
    expect(t.state()).toBeNull()
  })

  it('without SHELL /bin/zsh starts, with the integration', async () => {
    const { open } = await start({ shell: null })
    const t = await open()
    expect(t.opened.shell).toBe('zsh')
    await t.prompt()
    expect(t.state()).toMatchObject({ cwd: root, awaitingInput: true })
  })
})

describe('the output of a zsh Terminal with the integration, measured (worfy-link ticket 05)', () => {
  // The numbers are always printed; WORFY_PERF=1 checks them, as test/contract/terminal.test.ts does.
  const enforce = process.env.WORFY_PERF === '1'
  const BYTES = 10_000_000

  it('10 MB of output: the time to the last byte and the p99 delay of the event loop of main', { timeout: 120_000 }, async () => {
    const { open } = await start()
    const t = await open()
    await t.prompt()
    const before = t.text().length
    const loop = monitorEventLoopDelay({ resolution: 10 })
    loop.enable()
    const started = performance.now()
    await t.run(`head -c ${BYTES} /dev/zero | tr '\\0' a; echo; echo DONE""-MARK`, 60_000)
    const ms = Math.round(performance.now() - started)
    loop.disable()
    const p99 = Math.round(loop.percentile(99) / 1e6)
    const max = Math.round(loop.max / 1e6)
    const characters = t.text().length - before
    console.log(`terminal 10 MB, zsh with the shell integration: ${characters} characters, last byte after ${ms} ms, event loop delay p99 ${p99} ms, max ${max} ms`)
    expect(characters).toBeGreaterThanOrEqual(BYTES)
    // The output of the command is kept up to the replay limit: its end.
    const output = t.state()?.lastOutput ?? ''
    expect(output.length).toBeLessThanOrEqual(REPLAY_LIMIT)
    // zsh's own end-of-line padding (PROMPT_SP) comes before its precmd, so before D: it ends the output.
    expect(output.slice(-400)).toMatch(/aaa\r\nDONE-MARK\r\n[^\n]*\r \r$/)
    // The threshold of worfy-link ticket 05: the event loop of main waits no more than 100 ms at p99.
    if (enforce) expect(p99).toBeLessThanOrEqual(100)
  })
})
