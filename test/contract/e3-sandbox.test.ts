// scripts/e3-sandbox.sh (worfy-harness tickets 26, item 1, and 36) on temporary folders: HOME is a
// temporary folder, so the sandbox lives in its Library/Application Support and the keychain link
// points into it; E3_SANDBOX_TMP is the temp dir (the TMPDIR of the sandbox, and the old place `move`
// takes a sandbox from) and E3_LOCK_DIR the lock, so no test touches the real sandbox or the shared
// Electron lock /tmp/worfy-e2e.lock (E3_LOCK_PAUSE shortens the pause between two attempts to take
// it). `gh` is a stub first on the PATH: it records how it was called and prints a made-up token, so
// no test reads a real one.
//
// The file is skipped on Windows (worfy-windows ticket 55): e3-sandbox.sh is the acceptance sandbox
// of the macOS app — a per-user temp dir of `getconf DARWIN_USER_TEMP_DIR`, the keychain under
// ~/Library/Keychains, zsh login shells — and is not supported there. Under Git Bash `ln -s` copies,
// so each init copied claude and node (337 MB); a script killed at the timeout kept a process in the
// folder of the test, and that folder (342 MB) stayed in %TEMP%. The one exception is the last
// describe, the release of the lock-run heartbeat: lock-run makes no sandbox, and its Git Bash
// branch of the trap is tested where it runs.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitBash } from '../git-bash'
import { shellStub } from '../shell-stub'
import { removeTestTree } from '../remove'
import { timeScale } from '../time-scale'

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'e3-sandbox.sh')
/** e3-sandbox.sh is the acceptance sandbox of the macOS app; it is not supported on Windows. */
const ON_WINDOWS = process.platform === 'win32'
const TOKEN = 'gho_made-up-token-of-the-stub'

let scratch: string
let temp: string
let root: string
let userHome: string
let lock: string
let ghLog: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e3-sandbox-test-')))
  temp = join(scratch, 'temp')
  // A space and an & in the path: the move rewrites files with it, where sed or bash 5.2 would put the match for the &.
  userHome = join(scratch, 'user & home')
  root = join(userHome, 'Library', 'Application Support', 'worfy-e3-sandbox')
  lock = join(scratch, 'lock')
  ghLog = join(scratch, 'gh.log')
  mkdirSync(temp)
  mkdirSync(join(userHome, 'Library', 'Keychains'), { recursive: true })
  writeFileSync(join(userHome, 'Library', 'Keychains', 'login.keychain-db'), 'the keychain of the machine\n')
  ghStub(0)
})

afterEach(() => {
  removeTestTree(scratch)
})

/**
 * A stand-in `gh` in <scratch>/bin: appends its arguments and the HOME, CLAUDE_CONFIG_DIR and
 * GH_CONFIG_DIR it got to gh.log, prints TOKEN, and exits `code` (with gh's own words when not 0).
 */
function ghStub(code: number): void {
  const bin = join(scratch, 'bin')
  mkdirSync(bin, { recursive: true })
  const lines = [`printf '%s|HOME=%s|CLAUDE_CONFIG_DIR=%s|GH_CONFIG_DIR=%s\\n' "$*" "$HOME" "$CLAUDE_CONFIG_DIR" "$GH_CONFIG_DIR" >> '${ghLog}'`, `echo '${TOKEN}'`]
  if (code !== 0) lines.push("echo 'no oauth token found for github.com account IDSAD-XL' >&2")
  lines.push(`exit ${code}`)
  shellStub(join(bin, 'gh'), lines)
}

/** A stand-in for a command the script calls by name, in <scratch>/bin: first on the script's PATH. */
function stubCommand(name: string, lines: string[]): void {
  shellStub(join(scratch, 'bin', name), lines)
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  ms: number
}

/** What every run of the script gets: temporary folders only, and <scratch>/bin first on the PATH. */
function sandboxEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${join(scratch, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
    HOME: userHome,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: 'C.UTF-8',
    E3_SANDBOX_TMP: temp,
    E3_LOCK_DIR: lock,
    GH_CONFIG_DIR: join(scratch, 'gh-config'),
    ...extra,
  }
}

function sandbox(args: string[], options: { env?: Record<string, string>; timeout?: number } = {}): Run {
  const env = sandboxEnv(options.env)
  const started = Date.now()
  const run = spawnSync(gitBash(), [SCRIPT, ...args], { cwd: scratch, env, encoding: 'utf8', input: '', timeout: options.timeout ?? 10_000, killSignal: 'SIGKILL' })
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut: run.error !== undefined, ms: Date.now() - started }
}

/** A finished run: its exit code, with the output in the message when it differs. */
function expectExit(run: Run, code: number): void {
  expect(run.timedOut, `the script did not finish in time:\n${run.stdout}${run.stderr}`).toBe(false)
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(code)
}

const ghCalls = (): string[] => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean) : [])

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh init', () => {
  it('makes the sandbox in Library/Application Support of HOME, not in the temp dir: its folders, marker, .gitconfig and the variables of its login shells', () => {
    const run = sandbox(['init'])
    expectExit(run, 0)
    expect(run.stdout).toContain(`e3-sandbox: ${root}`)
    expect(readdirSync(temp)).toEqual([])
    expect(sandbox(['path']).stdout).toBe(`${root}\n`)
    for (const dir of ['home/.claude', 'npm/bin', 'tools', 'data', 'runs']) expect(lstatSync(join(root, dir)).isDirectory(), dir).toBe(true)
    expect(existsSync(join(root, '.worfy-e3-sandbox'))).toBe(true)
    const gitconfig = readFileSync(join(root, 'home', '.gitconfig'), 'utf8')
    expect(gitconfig).toContain('email = IDSAD-XL@users.noreply.github.com')
    expect(gitconfig).toContain(`helper = !${join(scratch, 'bin', 'gh')} auth git-credential`)
    const zshenv = readFileSync(join(root, 'home', '.zshenv'), 'utf8')
    expect(zshenv).toContain(`export CLAUDE_CONFIG_DIR='${join(root, 'home', '.claude')}'`)
    expect(zshenv).toContain(`export WORFY_CLAUDE_HOME='${join(root, 'home', '.claude')}'`)
    expect(zshenv).toContain(`export npm_config_prefix='${join(root, 'npm')}'`)
    expect(zshenv).toContain(`export GH_CONFIG_DIR='${join(scratch, 'gh-config')}'`)
    expect(zshenv).not.toMatch(/^export HOME=/m)
    expect(readFileSync(join(root, 'home', '.profile'), 'utf8')).toBe(zshenv)
    // The keychain of the machine, by a link: gh finds its tokens through $HOME/Library/Keychains.
    expect(readlinkSync(join(root, 'home', 'Library', 'Keychains'))).toBe(join(userHome, 'Library', 'Keychains'))
  })

  it('asks gh for the token of the account in the sandbox environment, and never prints the token', () => {
    const run = sandbox(['init'], { env: { E3_GH_ACCOUNT: 'someone' } })
    expectExit(run, 0)
    expect(ghCalls()).toEqual([`auth token --hostname github.com -u someone|HOME=${join(root, 'home')}|CLAUDE_CONFIG_DIR=${join(root, 'home', '.claude')}|GH_CONFIG_DIR=${join(scratch, 'gh-config')}`])
    expect(run.stdout).toContain('gh auth token -u someone in the sandbox environment: exit 0')
    expect(`${run.stdout}${run.stderr}`).not.toContain(TOKEN)
    for (const file of ['.gitconfig', '.zshenv', '.profile']) expect(readFileSync(join(root, 'home', file), 'utf8')).not.toContain(TOKEN)
  })

  it('exits 3 with what gh said when gh has no token, the sandbox made all the same; check-gh repeats the check', () => {
    ghStub(1)
    const run = sandbox(['init'])
    expectExit(run, 3)
    expect(run.stderr).toContain('failed: no oauth token found for github.com account IDSAD-XL')
    expect(`${run.stdout}${run.stderr}`).not.toContain(TOKEN)
    expect(existsSync(join(root, '.worfy-e3-sandbox'))).toBe(true)
    expectExit(sandbox(['check-gh']), 3)
    ghStub(0)
    expectExit(sandbox(['check-gh']), 0)
  })

  it('keeps the sandbox that is there: a second init changes neither its files nor its marker', () => {
    expectExit(sandbox(['init']), 0)
    writeFileSync(join(root, 'home', '.claude', '.claude.json'), '{"signedIn":true}\n')
    const marker = readFileSync(join(root, '.worfy-e3-sandbox'), 'utf8')
    expectExit(sandbox(['init']), 0)
    expect(readFileSync(join(root, 'home', '.claude', '.claude.json'), 'utf8')).toBe('{"signedIn":true}\n')
    expect(readFileSync(join(root, '.worfy-e3-sandbox'), 'utf8')).toBe(marker)
  })

  it('leaves the keychain link out with E3_KEYCHAIN_LINK=0', () => {
    expectExit(sandbox(['init'], { env: { E3_KEYCHAIN_LINK: '0' } }), 0)
    expect(existsSync(join(root, 'home', 'Library'))).toBe(false)
  })

  it('refuses a folder of the same name that is not empty and not its own, and leaves it unmarked', () => {
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'someone-elses.txt'), 'x\n')
    const touch = `touch '${join(root, '.worfy-e3-sandbox')}'`
    const run = sandbox(['init'])
    expectExit(run, 2)
    expect(run.stderr).toContain('not a sandbox of this script')
    expect(run.stderr).toContain(touch)
    expect(readdirSync(root)).toEqual(['someone-elses.txt'])
    expect(ghCalls()).toEqual([])
    // With the folder marked by mistake, reset would delete it: it must still refuse.
    for (const command of ['reset', 'reset-harness']) {
      const refused = sandbox([command])
      expectExit(refused, 2)
      expect(refused.stderr, command).toContain(touch)
      expect(readdirSync(root)).toEqual(['someone-elses.txt'])
    }
  })

  it('takes an empty folder of the same name', () => {
    mkdirSync(root, { recursive: true })
    expectExit(sandbox(['init']), 0)
    expect(existsSync(join(root, '.worfy-e3-sandbox'))).toBe(true)
  })
})

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh env and run', () => {
  it('runs a command with the sandbox variables only: nothing of the caller reaches it', () => {
    expectExit(sandbox(['init']), 0)
    const run = sandbox(['run', '/usr/bin/env'], { env: { CALLER_SECRET: 'x', GH_TOKEN: 'y', ANTHROPIC_API_KEY: 'z' } })
    expectExit(run, 0)
    const variables = Object.fromEntries(run.stdout.trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
    expect(Object.keys(variables).sort()).toEqual(['CLAUDE_CONFIG_DIR', 'GH_CONFIG_DIR', 'HOME', 'LANG', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER', 'WORFY_CLAUDE_HOME', 'WORFY_DATA_DIR', 'npm_config_prefix'].sort())
    expect(variables).toMatchObject({ HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'home', '.claude'), WORFY_DATA_DIR: join(root, 'data'), npm_config_prefix: join(root, 'npm'), GH_CONFIG_DIR: join(scratch, 'gh-config') })
    expect(variables.PATH?.startsWith(`${join(root, 'npm', 'bin')}:`)).toBe(true)
    expect(sandbox(['env']).stdout.trim().split('\n').sort()).toEqual(run.stdout.trim().split('\n').sort())
  })

  it('passes the exit code of the command, and refuses to run without a sandbox', () => {
    expectExit(sandbox(['run', 'true']), 2)
    expectExit(sandbox(['init']), 0)
    expectExit(sandbox(['run', 'sh', '-c', 'exit 5']), 5)
    expectExit(sandbox(['shell']), 0)
    expectExit(sandbox(['bogus']), 2)
  })
})

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh tools', () => {
  const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
  const TOOLS = ['claude', 'gh', 'git', 'jq', 'node', 'npm', 'npx']

  /** Stand-ins for tools of the machine in <scratch>/<folder>: each prints its name and that folder. */
  function machineTools(folder: string, names: string[]): string {
    const dir = join(scratch, folder)
    mkdirSync(dir, { recursive: true })
    // Files of their own, not links to test/shell-stub.ts's one stub: e3-sandbox.sh leaves a link
    // alone when the tool found is the same file (`-ef`), and links to one file all are.
    for (const name of names) {
      writeFileSync(join(dir, name), `#!/bin/sh\necho '${name} of ${folder}'\n`)
      chmodSync(join(dir, name), 0o755)
    }
    return dir
  }

  /** The caller's PATH: these folders of the machine, then the system folders. */
  const callerPath = (...dirs: string[]): Record<string, string> => ({ PATH: [...dirs, SYSTEM_PATH].join(':') })

  /**
   * A machine like the owner's: a node folder that also holds a qmd, and a folder of other tools with
   * a tool nobody asked for; `gh` is the stand-in of <scratch>/bin.
   */
  function machine(): { nodeBin: string; otherBin: string; env: Record<string, string> } {
    const nodeBin = machineTools('node-bin', ['node', 'npm', 'npx', 'qmd'])
    const otherBin = machineTools('other-bin', ['claude', 'git', 'jq', 'tool-nobody-asked-for'])
    return { nodeBin, otherBin, env: callerPath(nodeBin, otherBin, join(scratch, 'bin')) }
  }

  /** The environment `e3-sandbox.sh env` prints, as variables. */
  function printedEnv(env: Record<string, string>): Record<string, string> {
    const run = sandbox(['env'], { env })
    expectExit(run, 0)
    return Object.fromEntries(run.stdout.trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  }

  /** Where a shell with the environment `env` finds each of `names`: '' when nowhere. */
  function found(env: Record<string, string>, names: string[]): Record<string, string> {
    const run = spawnSync('/bin/sh', ['-c', `for t in ${names.join(' ')}; do echo "$t=$(command -v "$t")"; done`], { env, encoding: 'utf8' })
    return Object.fromEntries(run.stdout.trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  }

  const toolLinks = (): string[] => readdirSync(join(root, 'tools')).sort()
  const linkOf = (name: string): string => readlinkSync(join(root, 'tools', name))

  it('finds the tools the acceptance needs through links in tools/, and not the qmd that lies next to node on the machine', () => {
    const { nodeBin, otherBin, env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const printed = printedEnv(env)
    // No folder of the machine: what npm installs in the sandbox, the links, the system folders.
    expect(printed.PATH).toBe(`${join(root, 'npm', 'bin')}:${join(root, 'tools')}:${SYSTEM_PATH}`)
    expect(found(printed, [...TOOLS, 'qmd', 'tool-nobody-asked-for'])).toEqual({
      ...Object.fromEntries(TOOLS.map((name) => [name, join(root, 'tools', name)])),
      qmd: '',
      'tool-nobody-asked-for': '',
    })
    expect(toolLinks()).toEqual(TOOLS)
    for (const name of ['node', 'npm', 'npx']) expect(linkOf(name), name).toBe(join(nodeBin, name))
    for (const name of ['claude', 'git', 'jq']) expect(linkOf(name), name).toBe(join(otherBin, name))
    expect(linkOf('gh')).toBe(join(scratch, 'bin', 'gh'))
    // The link runs the tool of the machine.
    expect(spawnSync('node', [], { env: printed, encoding: 'utf8' }).stdout).toBe('node of node-bin\n')
    // The login shells of the sandbox get the same PATH.
    expect(readFileSync(join(root, 'home', '.zshenv'), 'utf8')).toContain(`export PATH='${printed.PATH}'\n`)
  })

  it('finds qmd once it is installed under the npm prefix of the sandbox', () => {
    const { env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    writeFileSync(join(root, 'npm', 'bin', 'qmd'), '#!/bin/sh\n')
    chmodSync(join(root, 'npm', 'bin', 'qmd'), 0o755)
    expect(found(printedEnv(env), ['qmd'])).toEqual({ qmd: join(root, 'npm', 'bin', 'qmd') })
  })

  it.each([
    ['env', ['env']],
    ['run', ['run', 'true']],
    ['check-gh', ['check-gh']],
    ['init', ['init']],
  ])('%s gives the links to a sandbox that was made without them, and changes nothing else in it', (_name, args) => {
    const { env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    removeTestTree(join(root, 'tools'))
    writeFileSync(join(root, 'home', '.claude', '.claude.json'), '{"signedIn":true}\n')
    expectExit(sandbox(args, { env }), 0)
    expect(toolLinks()).toEqual(TOOLS)
    expect(readFileSync(join(root, 'home', '.claude', '.claude.json'), 'utf8')).toBe('{"signedIn":true}\n')
  })

  it('env makes no sandbox: without one it only prints', () => {
    const { env } = machine()
    expect(printedEnv(env).PATH).toBe(`${join(root, 'npm', 'bin')}:${join(root, 'tools')}:${SYSTEM_PATH}`)
    expect(existsSync(root)).toBe(false)
  })

  it('says which tool the machine does not have and goes on: no link, no refusal', () => {
    const nodeBin = machineTools('node-bin', ['node', 'npm', 'npx'])
    const env = callerPath(nodeBin, join(scratch, 'bin'))
    const run = sandbox(['init'], { env })
    expectExit(run, 0)
    expect(run.stderr).toContain('e3-sandbox: claude is not on the PATH')
    expect(run.stderr).not.toContain('node is not on the PATH')
    expect(toolLinks()).not.toContain('claude')
    expect(found(printedEnv(env), ['claude', 'node'])).toEqual({ claude: '', node: join(root, 'tools', 'node') })
  })

  it('keeps a link when the caller has a shorter PATH: a tool is not taken from the sandbox', () => {
    const { nodeBin, env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const run = sandbox(['env'], { env: callerPath() })
    expectExit(run, 0)
    expect(linkOf('node')).toBe(join(nodeBin, 'node'))
    expect(linkOf('claude')).toBe(join(scratch, 'other-bin', 'claude'))
    expect(run.stderr).not.toContain('is not on the PATH')
  })

  it('points a link at the tool the caller finds now', () => {
    const { nodeBin, otherBin, env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const newer = machineTools('node-bin-newer', ['node'])
    const printed = printedEnv(callerPath(newer, nodeBin, otherBin, join(scratch, 'bin')))
    expect(linkOf('node')).toBe(join(newer, 'node'))
    expect(linkOf('npm')).toBe(join(nodeBin, 'npm'))
    expect(spawnSync('node', [], { env: printed, encoding: 'utf8' }).stdout).toBe('node of node-bin-newer\n')
  })

  it('makes no link to a tool of a system folder, and drops the link once the caller finds the tool there', () => {
    // git is in a system folder on macOS (the Xcode shim) and on the CI image.
    const systemGit = found(callerPath(), ['git']).git ?? ''
    expect(SYSTEM_PATH.split(':')).toContain(systemGit.slice(0, systemGit.lastIndexOf('/')))
    const { nodeBin, otherBin, env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    expect(linkOf('git')).toBe(join(otherBin, 'git'))
    // The machine lost its own git: the caller finds the system one now.
    rmSync(join(otherBin, 'git'))
    const printed = printedEnv(env)
    expect(toolLinks()).toEqual(TOOLS.filter((name) => name !== 'git'))
    expect(found(printed, ['git', 'node'])).toEqual({ git: systemGit, node: join(root, 'tools', 'node') })
    expect(linkOf('node')).toBe(join(nodeBin, 'node'))
  })

  it('leaves the links as they are when the caller itself runs in the sandbox environment', () => {
    const { nodeBin, env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const printed = printedEnv(env)
    const run = sandbox(['env'], { env: { PATH: printed.PATH ?? '' } })
    expectExit(run, 0)
    expect(run.stderr).not.toContain('is not on the PATH')
    expect(toolLinks()).toEqual(TOOLS)
    expect(linkOf('node')).toBe(join(nodeBin, 'node'))
    expect(linkOf('gh')).toBe(join(scratch, 'bin', 'gh'))
  })

  const targets = (): Record<string, string> => Object.fromEntries(TOOLS.map((name) => [name, linkOf(name)]))
  const writtenAt = (): bigint[] => TOOLS.map((name) => lstatSync(join(root, 'tools', name), { bigint: true }).mtimeNs)

  it.each([
    ['another path to the same folder', (): string => {
      symlinkSync(root, join(scratch, 'another-way'))
      return join(scratch, 'another-way', 'tools')
    }],
    ['a link that leads to tools/', (): string => {
      mkdirSync(join(scratch, 'front-bin'))
      for (const name of TOOLS) symlinkSync(join(root, 'tools', name), join(scratch, 'front-bin', name))
      return join(scratch, 'front-bin')
    }],
  ])('points no link at itself when the caller finds the links through %s', (_name, callerFolder) => {
    const { env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const before = targets()
    const run = sandbox(['env'], { env: callerPath(callerFolder()) })
    expectExit(run, 0)
    expect(targets()).toEqual(before)
    expect(spawnSync('node', [], { env: printedEnv(env), encoding: 'utf8' }).stdout).toBe('node of node-bin\n')
  })

  it.each([
    ['env', ['env']],
    ['init', ['init']],
  ])('%s does not write again a link that is right', (_name, args) => {
    const { env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const before = writtenAt()
    expectExit(sandbox(args, { env }), 0)
    expect(writtenAt()).toEqual(before)
  })

  it('replaces a link that points at a folder, and writes nothing into that folder', () => {
    const { nodeBin, env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const outside = join(scratch, 'outside-folder')
    mkdirSync(outside)
    rmSync(join(root, 'tools', 'node'))
    symlinkSync(outside, join(root, 'tools', 'node'))
    expectExit(sandbox(['env'], { env }), 0)
    expect(linkOf('node')).toBe(join(nodeBin, 'node'))
    expect(readdirSync(outside)).toEqual([])
  })

  it('removes only a link when the tool is in a system folder: a folder of that name stays whole', () => {
    expect(found(callerPath(), ['git']).git).not.toBe('')
    const env = callerPath(machineTools('node-bin', ['node', 'npm', 'npx']), join(scratch, 'bin'))
    expectExit(sandbox(['init'], { env }), 0)
    mkdirSync(join(root, 'tools', 'git'))
    writeFileSync(join(root, 'tools', 'git', 'kept.txt'), 'not of this script\n')
    expectExit(sandbox(['env'], { env }), 0)
    expect(readFileSync(join(root, 'tools', 'git', 'kept.txt'), 'utf8')).toBe('not of this script\n')
  })

  it('says so when a link leads nowhere and the caller has no such tool: a link is not a tool', () => {
    const { nodeBin, env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    rmSync(join(nodeBin, 'node'))
    const run = sandbox(['env'], { env: callerPath() })
    expectExit(run, 0)
    expect(run.stderr).toContain('e3-sandbox: node is not on the PATH')
    expect(run.stderr).not.toContain('npm is not on the PATH')
  })

  // A folder nobody can write into stops nobody who is root: nothing to check then.
  describe.skipIf(process.getuid?.() === 0)('a write that fails', () => {
    /** Runs `args` with `dir` read-only, and makes it writable again: the test folder is deleted afterwards. */
    function withReadOnly(dir: string, args: string[], env: Record<string, string>): Run {
      chmodSync(dir, 0o555)
      try {
        return sandbox(args, { env })
      } finally {
        chmodSync(dir, 0o755)
      }
    }

    // claude is the first tool of the list: a failure the links after it must not hide.
    it.each([
      ['init', ['init']],
      ['env', ['env']],
      ['run', ['run', '/usr/bin/env']],
      ['check-gh', ['check-gh']],
    ])('%s exits 1 and names the link it could not write, giving out no environment', (_name, args) => {
      const { env } = machine()
      expectExit(sandbox(['init'], { env }), 0)
      rmSync(join(root, 'tools', 'claude'))
      const run = withReadOnly(join(root, 'tools'), args, env)
      expectExit(run, 1)
      expect(run.stderr).toContain(`e3-sandbox: cannot write the link ${join(root, 'tools', 'claude')}`)
      expect(run.stdout).not.toContain('PATH=')
      // gh was asked once, by the first init: the command stopped before its own check of gh.
      expect(ghCalls()).toHaveLength(1)
    })

    it('exits 1 when tools/ cannot be made', () => {
      const { env } = machine()
      expectExit(sandbox(['init'], { env }), 0)
      removeTestTree(join(root, 'tools'))
      const run = withReadOnly(root, ['env'], env)
      expectExit(run, 1)
      expect(run.stderr).toContain(`e3-sandbox: cannot make ${join(root, 'tools')}`)
      expect(run.stdout).not.toContain('PATH=')
    })

    it('exits 1 when the link of a tool that moved to a system folder cannot be removed', () => {
      expect(found(callerPath(), ['git']).git).not.toBe('')
      const { otherBin, env } = machine()
      expectExit(sandbox(['init'], { env }), 0)
      rmSync(join(otherBin, 'git'))
      const run = withReadOnly(join(root, 'tools'), ['env'], env)
      expectExit(run, 1)
      expect(run.stderr).toContain(`e3-sandbox: cannot remove the link ${join(root, 'tools', 'git')}`)
      expect(run.stdout).not.toContain('PATH=')
    })
  })

  it.each(['env', 'init', 'run'])('%s refuses when tools/ is a link, and writes nothing where it points', (command) => {
    const { env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    const outside = join(scratch, 'outside-tools')
    mkdirSync(outside)
    removeTestTree(join(root, 'tools'))
    symlinkSync(outside, join(root, 'tools'))
    const run = sandbox(command === 'run' ? ['run', 'true'] : [command], { env })
    expectExit(run, 2)
    expect(run.stderr).toContain(`${join(root, 'tools')} is a link`)
    expect(readdirSync(outside)).toEqual([])
  })

  it.each(['env', 'run'])('%s refuses when the sandbox folder itself is a link, and makes no tools/ where it points', (command) => {
    const { env } = machine()
    expectExit(sandbox(['init'], { env }), 0)
    removeTestTree(join(root, 'tools'))
    const outside = join(scratch, 'outside-sandbox')
    renameSync(root, outside)
    symlinkSync(outside, root)
    const run = sandbox(command === 'run' ? ['run', 'true'] : [command], { env })
    expectExit(run, 2)
    expect(run.stderr).toContain(`${root} is a link`)
    expect(existsSync(join(outside, 'tools'))).toBe(false)
  })
})

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh reset and reset-harness', () => {
  /** What an install leaves in the sandbox, and the sign-in next to it. */
  function installed(claudeHome = join(root, 'home', '.claude')): void {
    mkdirSync(join(claudeHome, 'worfy-harness', 'plugin'), { recursive: true })
    mkdirSync(join(claudeHome, 'plugins', 'cache'), { recursive: true })
    writeFileSync(join(claudeHome, 'worfy-harness', 'plugin', 'x'), 'x\n')
    writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
    writeFileSync(join(claudeHome, '.claude.json'), '{"oauthAccount":{}}\n')
  }

  it('reset deletes the sandbox and nothing else: the keychain the link pointed at stays', () => {
    expectExit(sandbox(['init']), 0)
    const run = sandbox(['reset'])
    expectExit(run, 0)
    expect(existsSync(root)).toBe(false)
    expect(readdirSync(join(userHome, 'Library', 'Application Support'))).toEqual([])
    expect(readFileSync(join(userHome, 'Library', 'Keychains', 'login.keychain-db'), 'utf8')).toBe('the keychain of the machine\n')
    // tools/gh was a link to the gh of the machine: the link is gone, the tool is not.
    expect(existsSync(join(scratch, 'bin', 'gh'))).toBe(true)
    expectExit(sandbox(['reset']), 0)
  })

  it('reset-harness removes what an install left and keeps the sign-in', () => {
    expectExit(sandbox(['init']), 0)
    installed()
    writeFileSync(join(root, 'npm', 'bin', 'qmd'), '')
    writeFileSync(join(root, 'data', 'first-run.json'), '{}')
    mkdirSync(join(root, 'runs', 'one'))
    expect(readlinkSync(join(root, 'tools', 'gh'))).toBe(join(scratch, 'bin', 'gh'))
    expectExit(sandbox(['reset-harness']), 0)
    // The links to the tools of the machine are not what an install left: they stay.
    expect(readlinkSync(join(root, 'tools', 'gh'))).toBe(join(scratch, 'bin', 'gh'))
    expect(readdirSync(join(root, 'home', '.claude'))).toEqual(['.claude.json'])
    expect(readFileSync(join(root, 'home', '.claude', '.claude.json'), 'utf8')).toBe('{"oauthAccount":{}}\n')
    for (const dir of ['npm/bin', 'data', 'runs']) expect(readdirSync(join(root, dir)), dir).toEqual([])
    expect(existsSync(join(root, 'home', '.gitconfig'))).toBe(true)
    expect(existsSync(join(root, '.worfy-e3-sandbox'))).toBe(true)
  })

  it('reset-harness refuses without a sandbox', () => {
    expectExit(sandbox(['reset-harness']), 2)
  })

  it.each(['reset-harness', 'reset'])('%s refuses when home/.claude is a link, and the folder it points at stays whole', (command) => {
    expectExit(sandbox(['init']), 0)
    const outside = join(scratch, 'outside-claude')
    renameSync(join(root, 'home', '.claude'), outside)
    installed(outside)
    symlinkSync(outside, join(root, 'home', '.claude'))
    const run = sandbox([command])
    expectExit(run, 2)
    expect(run.stderr).toContain('is a link')
    expect(readdirSync(outside).sort()).toEqual(['.claude.json', 'plugins', 'settings.json', 'worfy-harness'])
    expect(existsSync(join(outside, 'worfy-harness', 'plugin', 'x'))).toBe(true)
    expect(existsSync(join(root, '.worfy-e3-sandbox'))).toBe(true)
  })

  it.each(['reset-harness', 'reset'])('%s refuses when home is a link', (command) => {
    expectExit(sandbox(['init']), 0)
    const outside = join(scratch, 'outside-home')
    renameSync(join(root, 'home'), outside)
    installed(join(outside, '.claude'))
    symlinkSync(outside, join(root, 'home'))
    expectExit(sandbox([command]), 2)
    expect(existsSync(join(outside, '.claude', 'worfy-harness', 'plugin', 'x'))).toBe(true)
    expect(existsSync(join(outside, '.claude', 'settings.json'))).toBe(true)
  })

  it.each(['reset-harness', 'reset', 'init'])('%s refuses when the sandbox folder itself is a link', (command) => {
    expectExit(sandbox(['init']), 0)
    const outside = join(scratch, 'outside-sandbox')
    renameSync(root, outside)
    installed(join(outside, 'home', '.claude'))
    rmSync(join(outside, 'home', '.gitconfig'))
    symlinkSync(outside, root)
    const run = sandbox([command])
    expectExit(run, 2)
    expect(run.stderr).toContain(`${root} is a link`)
    expect(existsSync(join(outside, 'home', '.claude', 'worfy-harness', 'plugin', 'x'))).toBe(true)
    expect(existsSync(join(outside, '.worfy-e3-sandbox'))).toBe(true)
    expect(existsSync(join(outside, 'home', '.gitconfig'))).toBe(false)
    expect(lstatSync(root).isSymbolicLink()).toBe(true)
  })

  it('init refuses to write through a home that is a link', () => {
    expectExit(sandbox(['init']), 0)
    const outside = join(scratch, 'outside-home')
    renameSync(join(root, 'home'), outside)
    rmSync(join(outside, '.gitconfig'))
    symlinkSync(outside, join(root, 'home'))
    expectExit(sandbox(['init']), 2)
    expect(existsSync(join(outside, '.gitconfig'))).toBe(false)
  })
})

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh place', () => {
  it('refuses a HOME inside a sandbox: a caller in the sandbox environment would make a sandbox inside it', () => {
    expectExit(sandbox(['init']), 0)
    const run = sandbox(['path'], { env: { HOME: join(root, 'home') } })
    expectExit(run, 2)
    expect(run.stderr).toContain('inside a sandbox')
    expectExit(sandbox(['init'], { env: { HOME: join(root, 'home') } }), 2)
    expect(existsSync(join(root, 'home', 'Library', 'Application Support'))).toBe(false)
  })

  it('refuses without a HOME, and with a HOME that is not a folder or is /', () => {
    const env = sandboxEnv()
    delete env.HOME
    const unset = spawnSync('bash', [SCRIPT, 'path'], { cwd: scratch, env, encoding: 'utf8', timeout: 10_000 })
    expect(unset.status, unset.stderr).toBe(2)
    expect(unset.stderr).toContain('HOME is not set')
    writeFileSync(join(scratch, 'a-file'), 'x\n')
    const file = sandbox(['path'], { env: { HOME: join(scratch, 'a-file') } })
    expectExit(file, 2)
    expect(file.stderr).toContain('HOME is not a folder')
    const slash = sandbox(['path'], { env: { HOME: '/' } })
    expectExit(slash, 2)
    expect(slash.stderr).toContain('HOME resolves to /')
  })

  // /usr belongs to root: a folder of another user without sudo. Run as root, it is the caller's own.
  it.skipIf(process.getuid?.() === 0)('refuses a HOME owned by another user', () => {
    const run = sandbox(['init'], { env: { HOME: '/usr' } })
    expectExit(run, 2)
    expect(run.stderr).toContain('HOME is not owned by')
  })
})

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh move', () => {
  const old = (): string => join(temp, 'worfy-e3-sandbox')
  const keychainItem = (claudeHome: string): string => `Claude Code-credentials-${createHash('sha256').update(claudeHome).digest('hex').slice(0, 8)}`
  /** What lock-run gives the command: E3_LOCK_HELD=1, with the lock folder (of this test) there. */
  const held = (): Record<string, string> => {
    mkdirSync(lock, { recursive: true })
    return { E3_LOCK_HELD: '1' }
  }
  const sibling = (): string => join(temp, 'worfy-e3-sandbox-other', 'x')
  const printed = (run: Run): Record<string, string> => Object.fromEntries(run.stdout.trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))

  /**
   * A sandbox at the old place, as the script before the move made it there: init, then the folder
   * taken to the temp dir with its files naming it there; a link into it (as npm makes one, but by
   * its full path), a link to a folder beside it whose name begins the same, and a sign-in in the
   * Claude home.
   */
  function oldSandbox(): void {
    expectExit(sandbox(['init']), 0)
    writeFileSync(join(root, 'home', '.claude', '.claude.json'), '{"oauthAccount":{}}\n')
    mkdirSync(join(root, 'npm', 'lib'), { recursive: true })
    writeFileSync(join(root, 'npm', 'lib', 'qmd.js'), 'qmd\n')
    writeFileSync(join(root, 'runs', 'kept.txt'), 'a run\n')
    renameSync(root, old())
    for (const file of ['.zshenv', '.profile', '.gitconfig']) {
      const path = join(old(), 'home', file)
      writeFileSync(path, readFileSync(path, 'utf8').split(root).join(old()))
    }
    writeFileSync(join(old(), 'home', '.gitconfig'), `${readFileSync(join(old(), 'home', '.gitconfig'), 'utf8')}[include]\n\tpath = ${join(old(), 'home', 'extra.gitconfig')}\n`)
    symlinkSync(join(old(), 'npm', 'lib', 'qmd.js'), join(old(), 'npm', 'bin', 'qmd'))
    mkdirSync(join(temp, 'worfy-e3-sandbox-other'))
    symlinkSync(sibling(), join(old(), 'runs', 'beside'))
  }

  /** What a finished move leaves, with the sign-in kept through CLAUDE_SECURESTORAGE_CONFIG_DIR. */
  function expectMoved(marker: string): void {
    expect(existsSync(old())).toBe(false)
    expect(readFileSync(join(root, '.worfy-e3-sandbox'), 'utf8')).toBe(marker)
    expect(readFileSync(join(root, 'home', '.claude', '.claude.json'), 'utf8')).toBe('{"oauthAccount":{}}\n')
    expect(readFileSync(join(root, 'runs', 'kept.txt'), 'utf8')).toBe('a run\n')
    // Links out of the sandbox stay as they were, the one beside it too; a link into it follows it.
    expect(readlinkSync(join(root, 'tools', 'gh'))).toBe(join(scratch, 'bin', 'gh'))
    expect(readlinkSync(join(root, 'home', 'Library', 'Keychains'))).toBe(join(userHome, 'Library', 'Keychains'))
    expect(readlinkSync(join(root, 'runs', 'beside'))).toBe(sibling())
    expect(readlinkSync(join(root, 'npm', 'bin', 'qmd'))).toBe(join(root, 'npm', 'lib', 'qmd.js'))
    const gitconfig = readFileSync(join(root, 'home', '.gitconfig'), 'utf8')
    expect(gitconfig).toContain(`path = ${join(root, 'home', 'extra.gitconfig')}\n`)
    expect(gitconfig).toContain('[credential "https://github.com"]')
    const zshenv = readFileSync(join(root, 'home', '.zshenv'), 'utf8')
    const zshenvBesides = zshenv.split('\n').filter((line) => !line.startsWith('export CLAUDE_SECURESTORAGE_CONFIG_DIR=')).join('\n')
    for (const text of [zshenvBesides, gitconfig]) expect(text).not.toContain(`${old()}/`)
    expect(zshenv).toContain(`export CLAUDE_CONFIG_DIR='${join(root, 'home', '.claude')}'`)
    expect(zshenv).toContain(`export CLAUDE_SECURESTORAGE_CONFIG_DIR='${join(old(), 'home', '.claude')}'`)
    expect(readFileSync(join(root, 'home', '.profile'), 'utf8')).toBe(zshenv)
    expect(printed(sandbox(['env'])).CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(join(old(), 'home', '.claude'))
    expect(readdirSync(root)).not.toContain('.worfy-e3-sandbox-moving')
  }

  it('moves the whole sandbox and keeps the sign-in: the old CLAUDE_CONFIG_DIR becomes CLAUDE_SECURESTORAGE_CONFIG_DIR', () => {
    oldSandbox()
    const marker = readFileSync(join(old(), '.worfy-e3-sandbox'), 'utf8')
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 0)
    expect(run.stdout).toContain(`moved ${old()} to ${root}`)
    expect(run.stdout).toContain(`'${keychainItem(join(old(), 'home', '.claude'))}'`)
    expect(run.stdout).toContain('undocumented')
    expectMoved(marker)
    // init keeps what move wrote, and run gives the variable to the command.
    const zshenv = readFileSync(join(root, 'home', '.zshenv'), 'utf8')
    expectExit(sandbox(['init']), 0)
    expect(readFileSync(join(root, 'home', '.zshenv'), 'utf8')).toBe(zshenv)
    expect(printed(sandbox(['run', '/usr/bin/env'])).CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(join(old(), 'home', '.claude'))
  })

  it('a sandbox made fresh by init has no CLAUDE_SECURESTORAGE_CONFIG_DIR', () => {
    expectExit(sandbox(['init']), 0)
    expect(printed(sandbox(['env']))).not.toHaveProperty('CLAUDE_SECURESTORAGE_CONFIG_DIR')
    expect(readFileSync(join(root, 'home', '.zshenv'), 'utf8')).not.toContain('CLAUDE_SECURESTORAGE_CONFIG_DIR')
  })

  it('moves only under the e2e lock, and takes no options', () => {
    oldSandbox()
    const run = sandbox(['move'])
    expectExit(run, 2)
    expect(run.stderr).toContain('lock-run')
    // E3_LOCK_HELD=1 alone is not the lock: its folder must be there.
    const claimed = sandbox(['move'], { env: { E3_LOCK_HELD: '1' } })
    expectExit(claimed, 2)
    expect(claimed.stderr).toContain('lock-run')
    const option = sandbox(['move', '--sign-in-again'], { env: held() })
    expectExit(option, 2)
    expect(option.stderr).toContain('takes no options')
    expect(existsSync(join(old(), '.worfy-e3-sandbox'))).toBe(true)
    expect(existsSync(root)).toBe(false)
  })

  it.each(['init', 'reset-harness', 'check-gh', 'run', 'shell'])('%s refuses while the sandbox waits at the old place, and names move', (command) => {
    oldSandbox()
    const run = sandbox(command === 'run' ? ['run', 'true'] : [command])
    expectExit(run, 2)
    expect(run.stderr).toContain('still at its old place')
    expect(run.stderr).toContain('e3-sandbox.sh move')
    expect(existsSync(root)).toBe(false)
    expect(existsSync(join(old(), '.worfy-e3-sandbox'))).toBe(true)
  })

  it('takes an empty folder at the new place', () => {
    oldSandbox()
    mkdirSync(root)
    expectExit(sandbox(['move'], { env: held() }), 0)
    expect(existsSync(join(root, '.worfy-e3-sandbox'))).toBe(true)
    expect(existsSync(join(root, 'worfy-e3-sandbox'))).toBe(false)
  })

  it('refuses when something else is at the new place already: both stay as they are', () => {
    oldSandbox()
    mkdirSync(root)
    writeFileSync(join(root, 'something.txt'), 'x\n')
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain('nothing moved')
    expect(run.stderr).toContain('out of the way')
    expect(readdirSync(root)).toEqual(['something.txt'])
    expect(existsSync(join(old(), '.worfy-e3-sandbox'))).toBe(true)
  })

  it('refuses when a sandbox is at the new place already, and says reset deletes a fresh one; after that it moves', () => {
    oldSandbox()
    // A fresh sandbox at the new place, as an init before this change of the script would leave it.
    renameSync(old(), join(scratch, 'parked'))
    expectExit(sandbox(['init']), 0)
    renameSync(join(scratch, 'parked'), old())
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain('holds a sandbox already')
    expect(run.stderr).toContain('e3-sandbox.sh reset`')
    expect(existsSync(join(old(), 'home', '.claude', '.claude.json'))).toBe(true)
    expectExit(sandbox(['reset']), 0)
    expectExit(sandbox(['move'], { env: held() }), 0)
    expect(readFileSync(join(root, 'home', '.claude', '.claude.json'), 'utf8')).toBe('{"oauthAccount":{}}\n')
  })

  it('refuses when the new place is a link, and writes nothing where it points', () => {
    oldSandbox()
    const outside = join(scratch, 'outside-new')
    mkdirSync(outside)
    symlinkSync(outside, root)
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(readdirSync(outside)).toEqual([])
    expect(lstatSync(root).isSymbolicLink()).toBe(true)
    expect(existsSync(join(old(), '.worfy-e3-sandbox'))).toBe(true)
  })

  it('refuses when the old place is a link, and moves nothing', () => {
    oldSandbox()
    const outside = join(scratch, 'outside-old')
    renameSync(old(), outside)
    symlinkSync(outside, old())
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain(`${old()} is a link`)
    expect(existsSync(root)).toBe(false)
    expect(existsSync(join(outside, '.worfy-e3-sandbox'))).toBe(true)
  })

  it('refuses when .gitconfig of the old sandbox is a link: the file it points at stays as it was', () => {
    oldSandbox()
    const outside = join(scratch, 'outside.gitconfig')
    writeFileSync(outside, `[include]\n\tpath = ${join(old(), 'home', 'x')}\n`)
    rmSync(join(old(), 'home', '.gitconfig'))
    symlinkSync(outside, join(old(), 'home', '.gitconfig'))
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain('is a link')
    expect(readFileSync(outside, 'utf8')).toBe(`[include]\n\tpath = ${join(old(), 'home', 'x')}\n`)
    expect(existsSync(root)).toBe(false)
  })

  it('has nothing to move without a sandbox at the old place', () => {
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 0)
    expect(run.stdout).toContain('nothing to move')
    expect(existsSync(root)).toBe(false)
  })

  it('moves no folder without the marker, and says how to put it back', () => {
    oldSandbox()
    rmSync(join(old(), '.worfy-e3-sandbox'))
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain(`touch '${join(old(), '.worfy-e3-sandbox')}'`)
    expect(existsSync(join(old(), 'home', '.claude', '.claude.json'))).toBe(true)
    expect(existsSync(root)).toBe(false)
  })

  it('refuses an old sandbox whose home/.claude is a link, and moves nothing', () => {
    oldSandbox()
    const outside = join(scratch, 'outside-claude')
    renameSync(join(old(), 'home', '.claude'), outside)
    symlinkSync(outside, join(old(), 'home', '.claude'))
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain('is a link')
    expect(existsSync(root)).toBe(false)
  })

  it.skipIf(process.getuid?.() === 0)('a move that stopped after mv is finished by running move again; until then the sandbox is not used', () => {
    oldSandbox()
    const marker = readFileSync(join(old(), '.worfy-e3-sandbox'), 'utf8')
    chmodSync(join(old(), 'home', '.gitconfig'), 0o444)
    const failed = sandbox(['move'], { env: held() })
    expectExit(failed, 1)
    expect(failed.stderr).toContain('cannot write')
    expect(existsSync(old())).toBe(false)
    const init = sandbox(['init'])
    expectExit(init, 2)
    expect(init.stderr).toContain('not finished')
    chmodSync(join(root, 'home', '.gitconfig'), 0o644)
    const unlocked = sandbox(['move'])
    expectExit(unlocked, 2)
    expect(unlocked.stderr).toContain('lock-run')
    expect(existsSync(join(root, '.worfy-e3-sandbox-moving'))).toBe(true)
    const again = sandbox(['move'], { env: held() })
    expectExit(again, 0)
    expect(again.stdout).not.toContain('nothing to move')
    expectMoved(marker)
  })

  /** A move stopped after mv: .gitconfig could not be written. */
  function stoppedAfterMv(): void {
    oldSandbox()
    chmodSync(join(old(), 'home', '.gitconfig'), 0o444)
    expectExit(sandbox(['move'], { env: held() }), 1)
    chmodSync(join(root, 'home', '.gitconfig'), 0o644)
  }

  it.skipIf(process.getuid?.() === 0)('does not finish a move while the old place still has the marker: mv may have copied a part only', () => {
    stoppedAfterMv()
    mkdirSync(old())
    writeFileSync(join(old(), '.worfy-e3-sandbox'), 'the whole sandbox\n')
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain('did not finish')
    expect(existsSync(join(root, '.worfy-e3-sandbox-moving'))).toBe(true)
    expect(readFileSync(join(root, 'home', '.gitconfig'), 'utf8')).toContain(old())
  })

  it.skipIf(process.getuid?.() === 0)('does not finish a move through a .gitconfig that became a link: the file it points at stays', () => {
    stoppedAfterMv()
    const outside = join(scratch, 'outside.gitconfig')
    writeFileSync(outside, `path = ${old()}/x\n`)
    rmSync(join(root, 'home', '.gitconfig'))
    symlinkSync(outside, join(root, 'home', '.gitconfig'))
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 2)
    expect(run.stderr).toContain('is a link')
    expect(readFileSync(outside, 'utf8')).toBe(`path = ${old()}/x\n`)
  })

  it('says where the sandbox went when a folder appeared at the new place just before mv; moved there, move finishes', () => {
    oldSandbox()
    const marker = readFileSync(join(old(), '.worfy-e3-sandbox'), 'utf8')
    // An mv first on the PATH that makes the target folder before it moves: the race, made certain.
    writeFileSync(join(scratch, 'bin', 'mv'), '#!/bin/sh\n/bin/mkdir -p "$3"\nexec /bin/mv "$@"\n')
    chmodSync(join(scratch, 'bin', 'mv'), 0o755)
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 1)
    expect(run.stderr).toContain(`the sandbox is ${join(root, 'worfy-e3-sandbox')}`)
    rmSync(join(scratch, 'bin', 'mv'))
    renameSync(join(root, 'worfy-e3-sandbox'), join(scratch, 'parked'))
    removeTestTree(root)
    renameSync(join(scratch, 'parked'), root)
    expectExit(sandbox(['move'], { env: held() }), 0)
    expectMoved(marker)
  })

  it('after the move, an old place holding only what Claude Code makes there is "moved already": nothing changes', () => {
    oldSandbox()
    expectExit(sandbox(['move'], { env: held() }), 0)
    mkdirSync(join(old(), 'home', '.claude'), { recursive: true })
    writeFileSync(join(old(), 'home', '.claude', '.storage-write'), '')
    const zshenv = readFileSync(join(root, 'home', '.zshenv'), 'utf8')
    const listing = readdirSync(root).sort()
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 0)
    expect(run.stdout).toContain('moved from')
    expect(run.stdout).toContain('already')
    expect(`${run.stdout}${run.stderr}`).not.toContain('touch')
    expect(`${run.stdout}${run.stderr}`).not.toContain('reset')
    expect(readdirSync(root).sort()).toEqual(listing)
    expect(readFileSync(join(root, 'home', '.zshenv'), 'utf8')).toBe(zshenv)
    expect(readdirSync(old())).toEqual(['home'])
    expectExit(sandbox(['init']), 0)
  })

  it('an old place holding only home/.claude beside a fresh sandbox is no sandbox: nothing to move, no advice to mark it or reset', () => {
    expectExit(sandbox(['init']), 0)
    mkdirSync(join(old(), 'home', '.claude'), { recursive: true })
    writeFileSync(join(old(), 'home', '.claude', '.storage-write'), '')
    const run = sandbox(['move'], { env: held() })
    expectExit(run, 0)
    expect(run.stdout).toContain('nothing to move')
    expect(`${run.stdout}${run.stderr}`).not.toContain('touch')
    expect(`${run.stdout}${run.stderr}`).not.toContain('reset')
    expect(readdirSync(old())).toEqual(['home'])
  })
})

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh lock-run', () => {
  const ran = (): boolean => existsSync(join(scratch, 'ran'))
  /** The command under the lock: it records that it ran, what E3_LOCK_HELD was and that the lock folder was there. */
  const touchRan = ['sh', '-c', 'echo "held=$E3_LOCK_HELD lock=$(ls -d "$E3_LOCK_DIR")" > "$SCRATCH/ran"']

  const isAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  /** The pids listed one per line in a file, none when there is no file. */
  const pidsIn = (file: string): number[] => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(Number) : [])
  const until = async (done: () => boolean, ms: number): Promise<void> => {
    for (const end = Date.now() + ms; !done() && Date.now() < end; ) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  // Every test starts with a stand-in `sleep` that records the pid of each heartbeat `sleep 300` and
  // then sleeps for real; after the test any of them still alive is killed by pid. Tests that need
  // another `sleep` replace it.
  const heartbeatPids = (): string => join(scratch, 'heartbeat-pids')
  beforeEach(() => {
    stubCommand('sleep', [`if [ "$1" = 300 ]; then echo "$$" >> '${heartbeatPids()}'; fi`, `PATH='${process.env.PATH ?? ''}' exec sleep "$@"`])
  })
  afterEach(() => {
    for (const pid of pidsIn(heartbeatPids()).filter(isAlive)) process.kill(pid, 'SIGKILL')
  })

  it('runs the command holding the lock, with E3_LOCK_HELD=1, and releases the lock; a caller on a pipe is not kept waiting', () => {
    const run = sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch } })
    expectExit(run, 0)
    expect(readFileSync(join(scratch, 'ran'), 'utf8')).toBe(`held=1 lock=${lock}\n`)
    expect(existsSync(lock)).toBe(false)
    // No `sleep` of the heartbeat may hold this pipe open.
    expect(run.ms).toBeLessThan(5_000)
  })

  // worfy-polish ticket 36 (review of #738): ps shows the heartbeat stopped while a fork it began
  // before the stop may still finish, and its child shows up later under load. One pkill then left a
  // `sleep` for its 5 min in about one run in three of the same trap in epic-wave; the test below
  // shows such a sleep only by chance, this check every time.
  it('runs pkill -P again while the heartbeat is stopped, until three passes in a row find no child', () => {
    const release = readFileSync(SCRIPT, 'utf8').split('\n').find((line) => line.includes("trap 'if [ -e /proc/'")) ?? ''
    const posix = release.slice(release.indexOf('; else '))
    expect(posix).toMatch(/kill -STOP .*pkill -P .*while \[ "\$e" -lt 3 \] && \[ "\$w" -lt 40 \]; do sleep 0\.05; w=\$\(\(w \+ 1\)\); if pkill -P '"\$hb"' 2>\/dev\/null; then e=0; else e=\$\(\(e \+ 1\)\); fi; done; kill -KILL .*kill -CONT/)
  })

  it('leaves no sleep of the heartbeat behind when the command ends', () => {
    // The command under the lock waits until the heartbeat's sleep has started, so the release
    // always finds it running.
    const waitForHeartbeat = ['sh', '-c', 'n=0; until [ -s "$HB_PIDS" ]; do n=$((n + 1)); [ "$n" -le 100 ] || exit 9; sleep 0.05; done']
    const run = sandbox(['lock-run', ...waitForHeartbeat], { env: { HB_PIDS: heartbeatPids() } })
    expectExit(run, 0)
    const started = pidsIn(heartbeatPids())
    expect(started.length).toBeGreaterThan(0)
    // A killed process can take a moment to go: up to 2 seconds.
    for (let i = 0; i < 20 && started.some(isAlive); i++) spawnSync('sleep', ['0.1'])
    expect(started.filter(isAlive)).toEqual([])
  })

  it('the heartbeat of a running lock-run ends once the lock folder is gone, and makes no plain file in its place', async () => {
    // The heartbeat sleeps 0.2 s here and its sleep records the heartbeat's pid. The stand-in
    // `touch` removes the lock folder just before the heartbeat's touch, as a run that took the lock
    // for abandoned would: `touch -c` must not make a plain file there, and the next step must see
    // the folder gone and end the heartbeat. The script stays alive meanwhile, so the folder check
    // ends the heartbeat, not the check of its script (the last describe kills the script).
    const parents = join(scratch, 'heartbeat-parents')
    const go = join(scratch, 'go')
    stubCommand('sleep', [`if [ "$1" = 300 ]; then echo "$PPID" >> '${parents}'; set -- 0.2; fi`, `PATH='${process.env.PATH ?? ''}' exec sleep "$@"`])
    stubCommand('touch', [`rmdir '${lock}' 2>/dev/null`, `PATH='${process.env.PATH ?? ''}' exec touch "$@"`])
    const waitForGo = ['sh', '-c', 'n=0; until [ -e "$GO" ] || [ "$n" -ge 400 ]; do n=$((n + 1)); sleep 0.05; done']
    const child = spawn('bash', [SCRIPT, 'lock-run', ...waitForGo], { cwd: scratch, env: sandboxEnv({ GO: go }), stdio: 'ignore' })
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()))
    let heartbeat = 0
    try {
      await until(() => pidsIn(parents).length > 0, 10_000)
      heartbeat = pidsIn(parents)[0] ?? 0
      expect(heartbeat, 'the heartbeat did not start').toBeGreaterThan(0)
      await until(() => !isAlive(heartbeat), 10_000)
      expect(isAlive(heartbeat), 'the heartbeat outlived the lock').toBe(false)
      expect(child.exitCode === null && child.signalCode === null, 'the script ended before its heartbeat').toBe(true)
      expect(existsSync(lock), 'a plain file was made where the lock folder was').toBe(false)
      writeFileSync(go, '')
      await exited
      expect(child.exitCode).toBe(0)
    } finally {
      writeFileSync(go, '')
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      if (heartbeat > 0 && isAlive(heartbeat)) process.kill(heartbeat, 'SIGKILL')
    }
  })

  it('passes the exit code of a failing command through and still releases its own lock', () => {
    const run = sandbox(['lock-run', 'sh', '-c', 'exit 7'])
    expectExit(run, 7)
    expect(existsSync(lock)).toBe(false)
  })

  it('waits for a fresh lock of someone else: the command does not run and the lock stays', () => {
    mkdirSync(lock)
    const run = sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch }, timeout: 2_500 })
    expect(run.timedOut).toBe(true)
    expect(ran()).toBe(false)
    expect(existsSync(lock)).toBe(true)
  })

  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000)

  it('waits for a lock touched 29 minutes ago, and takes one left 31 minutes ago', () => {
    mkdirSync(lock)
    utimesSync(lock, minutesAgo(29), minutesAgo(29))
    const waiting = sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch }, timeout: 2_500 })
    expect(waiting.timedOut).toBe(true)
    expect(ran()).toBe(false)
    expect(existsSync(lock)).toBe(true)

    utimesSync(lock, minutesAgo(31), minutesAgo(31))
    const taken = sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch, E3_LOCK_PAUSE: '1' } })
    expectExit(taken, 0)
    expect(ran()).toBe(true)
    expect(existsSync(lock)).toBe(false)
  })

  it('pauses 20 seconds between two attempts to take the lock, or as long as E3_LOCK_PAUSE says', () => {
    // This `sleep` records what it was asked for and fails, which ends the script at its first pause.
    const pauses = join(scratch, 'pauses')
    stubCommand('sleep', [`echo "$1" >> '${pauses}'`, 'exit 1'])
    mkdirSync(lock)
    expectExit(sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch } }), 1)
    expectExit(sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch, E3_LOCK_PAUSE: '3' } }), 1)
    expect(readFileSync(pauses, 'utf8')).toBe('20\n3\n')
    expect(ran()).toBe(false)
    expect(existsSync(lock)).toBe(true)
  })

  // Two runs find the same abandoned lock. The one that removes it must pause before it takes the
  // lock: the other has read the old time too, and without the pause its own `rmdir` removes the
  // fresh lock of the first, and both run.
  //
  // No step of this test is timed. `rmdir` and `sleep` of the script are stand-ins that wait for
  // each other through marker files in <scratch>/race, so the order is the same on any machine:
  //   1. both runs read the old time and reach `rmdir` — `first` removes the lock only then;
  //   2. `second` calls its `rmdir` only when `first` has gone on: it is in its pause, or (without
  //      the pause) it holds the lock and its command runs;
  //   3. the pause of `first` lasts until that `rmdir` of `second` is over, which is what 20 seconds
  //      are for outside the test;
  //   4. the command under the lock ends only when the other run has started its command too (both
  //      hold the lock: the failure) or waits for the lock after its own pause.
  // The stand-in `sleep` never sleeps, and the heartbeat's `sleep 300` fails at once, so the
  // heartbeat ends and no process outlives the test.
  it('two runs that find the same abandoned lock do not both take it: the one that removed it pauses first', async () => {
    const race = join(scratch, 'race')
    mkdirSync(race)
    writeFileSync(
      join(race, 'lib.sh'),
      [
        'PATH=$REAL_PATH',
        'me=$RACE_DIR/$RACER',
        'if [ "$RACER" = first ]; then other=$RACE_DIR/second; else other=$RACE_DIR/first; fi',
        'any_of() { for f in "$@"; do [ ! -e "$f" ] || return 0; done; return 1; }',
        'gone() { [ ! -e "$1" ]; }',
        // Polls for a state of the files; gives up after a minute of polls, or when the test did.
        'wait_until() {',
        '  n=0',
        '  until "$@"; do',
        '    [ -d "$RACE_DIR" ] || exit 1',
        '    n=$((n + 1))',
        '    if [ "$n" -gt 1200 ] || [ -e "$RACE_DIR/abort" ]; then echo "$RACER gave up waiting: $*" >> "$RACE_DIR/stuck"; exit 1; fi',
        '    sleep 0.05',
        '  done',
        '}',
        '',
      ].join('\n'),
    )
    stubCommand('rmdir', [
      '. "$RACE_DIR/lib.sh"',
      // Only the first `rmdir` of a run is the one of an abandoned lock; a later one releases its own.
      'if [ -e "$me.at-rmdir" ]; then exec rmdir "$@"; fi',
      ': > "$me.at-rmdir"',
      'if [ "$RACER" = first ]; then wait_until any_of "$other.at-rmdir"; else wait_until any_of "$other.paused" "$other.entered"; fi',
      'rmdir "$@"',
      'code=$?',
      ': > "$me.rmdir-done"',
      'exit "$code"',
    ])
    stubCommand('sleep', [
      '. "$RACE_DIR/lib.sh"',
      '[ "$1" != 300 ] || exit 1',
      // The release of the lock sleeps 0.01 s and 0.05 s while it ends the heartbeat: no pause of the race.
      'case "$1" in 0.0*) exec sleep "$1" ;; esac',
      'echo "$1" >> "$me.pauses"',
      'if [ ! -e "$me.paused" ]; then',
      '  : > "$me.paused"',
      '  wait_until any_of "$other.rmdir-done"',
      'else',
      '  : > "$me.waiting"',
      '  wait_until gone "$E3_LOCK_DIR"',
      'fi',
    ])
    writeFileSync(
      join(race, 'under-lock.sh'),
      ['. "$RACE_DIR/lib.sh"', 'echo "enter $RACER" >> "$RACE_DIR/log"', ': > "$me.entered"', 'wait_until any_of "$other.entered" "$other.waiting"', 'echo "exit $RACER" >> "$RACE_DIR/log"', ''].join('\n'),
    )

    const racer = (name: 'first' | 'second'): Promise<Run> =>
      new Promise((resolve) => {
        const started = Date.now()
        const env = sandboxEnv({ RACER: name, RACE_DIR: race, REAL_PATH: process.env.PATH ?? '', E3_LOCK_PAUSE: '7' })
        const child = spawn('bash', [SCRIPT, 'lock-run', 'sh', join(race, 'under-lock.sh')], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        let timedOut = false
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
        // Far above what the run takes (under a second): only a run that hangs gets here.
        const timer = setTimeout(() => {
          timedOut = true
          writeFileSync(join(race, 'abort'), '')
          child.kill('SIGKILL')
        }, 90_000)
        child.on('close', (status) => {
          clearTimeout(timer)
          resolve({ status, stdout, stderr, timedOut, ms: Date.now() - started })
        })
      })

    mkdirSync(lock)
    utimesSync(lock, minutesAgo(31), minutesAgo(31))
    const [first, second] = await Promise.all([racer('first'), racer('second')])

    expect(existsSync(join(race, 'stuck')) ? readFileSync(join(race, 'stuck'), 'utf8') : '').toBe('')
    expectExit(first, 0)
    expectExit(second, 0)
    // One command at a time under the lock, whichever run took it first after the pause.
    const log = readFileSync(join(race, 'log'), 'utf8').trim().split('\n')
    expect([
      ['enter first', 'exit first', 'enter second', 'exit second'],
      ['enter second', 'exit second', 'enter first', 'exit first'],
    ]).toContainEqual(log)
    // Every pause was as long as E3_LOCK_PAUSE says: the one after the removal, and the wait for the other run's lock.
    const pauses = ['first', 'second'].flatMap((name) => readFileSync(join(race, `${name}.pauses`), 'utf8').trim().split('\n'))
    expect(pauses.sort()).toEqual(['7', '7', '7'])
    expect(existsSync(lock)).toBe(false)
  }, 120_000)

  it('refuses without a command, taking no lock', () => {
    expectExit(sandbox(['lock-run']), 2)
    expect(existsSync(lock)).toBe(false)
  })
})

// Runs on Windows too. In Git Bash a `kill -KILL` right after `kill -STOP` can leave the heartbeat
// alive and deaf to every signal, and the trap's `wait` for it then never returns; Git Bash also has
// no pkill, so the heartbeat's `sleep 300` outlived every run. Processes are looked at and ended
// through bash (scratch/bin/procs.sh): in Git Bash the pids of the script are MSYS pids, which
// process.kill of Node does not know.
describe('e3-sandbox.sh lock-run: the release of the heartbeat, also in Git Bash', () => {
  /** Puts $STUBS (the stand-ins) first on the PATH, in the POSIX form Git Bash needs there. */
  const FRONT = 's=$STUBS; command -v cygpath >/dev/null 2>&1 && s=$(cygpath -u "$s"); PATH="$s:$PATH"'
  const procsScript = (): string => join(scratch, 'bin', 'procs.sh')
  const boundedScript = (): string => join(scratch, 'bin', 'bounded.sh')
  beforeEach(() => {
    stubCommand('procs.sh', [
      '# procs.sh alive <pid>...: prints the pids (all recorded by the test) that are alive and whose command',
      '#   line has $TEXT (from the environment, so the command line of this script never has it), or cannot be',
      '#   read: in Git Bash that is a process deaf to signals, such as a heartbeat stopped and then killed.',
      '# procs.sh end <pid>...: ends each pid, through Windows (kill -f) where it has /proc/<pid>/winpid.',
      '# procs.sh kill9 <pid>...: kill -KILL, a signal: the trap of the process does not run.',
      'cmd_of() { if [ -r "/proc/$1/cmdline" ]; then tr "\\0" " " <"/proc/$1/cmdline" 2>/dev/null; else ps -ww -o command= -p "$1" 2>/dev/null; fi; }',
      'mode=$1; shift',
      'for p in "$@"; do',
      '  case $mode in',
      '    alive) kill -0 "$p" 2>/dev/null && case "$(cmd_of "$p")" in "" | *"$TEXT"*) echo "$p" ;; esac ;;',
      '    end) if [ -e "/proc/$p/winpid" ]; then /usr/bin/kill -f -9 "$p"; else kill -KILL "$p"; fi 2>/dev/null ;;',
      '    kill9) kill -KILL "$p" 2>/dev/null ;;',
      '  esac',
      'done',
      'exit 0',
    ])
    stubCommand('bounded.sh', [
      '# bounded.sh <seconds> <out file> <command>...: runs the command, its output in <out file>, and waits',
      '# at most <seconds> for it. Exits with its code, or 124 when it was still running: then its children',
      '# (by /proc/<pid>/ppid in Git Bash, else pgrep -P: Linux has no such file) and the command itself are',
      '# ended, through Windows where they have a winpid.',
      '# The launcher of Git Bash puts /usr/bin first on the PATH, in front of the stand-ins: put them back first.',
      FRONT,
      's=$1 out=$2; shift 2',
      '"$@" >"$out" 2>&1 & p=$!',
      '# By the clock: in Git Bash each `sleep` takes a start-up of its own, so a count of steps runs twice as long.',
      'end=$((SECONDS + s))',
      'while [ "$SECONDS" -lt "$end" ] && kill -0 "$p" 2>/dev/null; do /bin/sleep 0.05; done',
      'kill -0 "$p" 2>/dev/null || { wait "$p"; exit $?; }',
      'if [ -e "/proc/$$/ppid" ]; then kids=; for f in /proc/[0-9]*/ppid; do read -r pp 2>/dev/null <"$f" && [ "$pp" = "$p" ] && { f=${f%/ppid}; kids="$kids ${f#/proc/}"; }; done; else kids=$(pgrep -P "$p"); fi',
      `sh '${procsScript()}' end $kids "$p"`,
      'wait "$p" 2>/dev/null',
      'exit 124',
    ])
    stubCommand('started.sh', [
      '# started.sh <pid file>: exit 0 once the pid in the file runs the real `sleep`. The stand-in `sleep`',
      '# records its pid before it execs the real one; a trap that comes in between finds a process in the',
      '# middle of its exec, which in Git Bash can leave the new sleep.exe behind.',
      'p=$(cat "$1" 2>/dev/null) && [ -n "$p" ] || exit 1',
      'e=$({ cat "/proc/$p/exename" || readlink "/proc/$p/exe" || ps -o comm= -p "$p"; } 2>/dev/null)',
      'case $e in *sleep | *sleep.exe) exit 0 ;; *) exit 1 ;; esac',
    ])
  })

  const procs = (mode: 'alive' | 'end' | 'kill9', pids: string[], text = ''): string[] => {
    if (pids.length === 0) return []
    const run = spawnSync(gitBash(), [procsScript(), mode, ...pids], { env: sandboxEnv({ TEXT: text }), encoding: 'utf8' })
    return (run.stdout ?? '').split('\n').filter(Boolean)
  }
  /** The lines of a file, none when there is no file. */
  const linesOf = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [])
  /**
   * Polls `done` every 100 ms for at most `ms`; true as soon as it holds. It waits with setTimeout,
   * so the event loop runs: Node reaps a killed child only then, and a child it has not reaped is a
   * zombie, which `kill -0` still finds alive on macOS and Linux.
   */
  const until = async (done: () => boolean, ms: number): Promise<boolean> => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (done()) return true
    return done()
  }

  it('the Git Bash branch of the trap kills the heartbeat without kill -STOP and ends its children through Windows', () => {
    // Behaviour alone cannot show a STOP put back there: the bounded wait below ends even a deaf
    // heartbeat after 1 s. So this reads the trap's Git Bash branch out of the script.
    const text = readFileSync(SCRIPT, 'utf8')
    const head = `trap 'if [ -e /proc/'"$hb"'/winpid ]; then `
    const start = text.indexOf(head)
    expect(start, 'the trap has no Git Bash branch').toBeGreaterThan(0)
    const branch = text.slice(start + head.length, text.indexOf('; else ', start))
    expect(branch).toContain(`kill -KILL '"$hb"'`)
    expect(branch).toContain('/usr/bin/kill -f -9 $c')
    expect(branch).toContain(`/usr/bin/kill -f -9 '"$hb"'`)
    // STOP by name or by number: SIGSTOP is 17 in Cygwin and on macOS, 19 on Linux.
    expect(branch).not.toMatch(/STOP|kill +-(s +)?(17|19)\b/)
  })

  it('40 runs each end within 15 s and leave no heartbeat shell or sleep behind', async () => {
    // The stand-in `sleep` records, for the heartbeat's `sleep 300`, its own pid and its parent's (the
    // heartbeat shell). The command under the lock waits until the heartbeat runs the real sleep
    // (started.sh) and then 0.3 s more, as a real command runs minutes: the trap finds the heartbeat
    // waiting for its sleep. The marker is an argument of the script, so every heartbeat shell (a fork of it)
    // carries it in its command line. Each run has 15 s; a trap that never returns fails here.
    const marker = `hb-marker-${process.pid}-${Date.now()}`
    const sleeps = join(scratch, 'hb-sleeps')
    const shells = join(scratch, 'hb-shells')
    stubCommand('sleep', [`if [ "$1" = 300 ]; then echo "$$" >> "$HB_PIDS"; echo "$$" >> '${sleeps}'; echo "$PPID" >> '${shells}'; fi`, 'exec /bin/sleep "$@"'])
    const waitThenWork = ['sh', '-c', 'n=0; until sh "$STARTED" "$HB_PIDS"; do n=$((n + 1)); [ "$n" -le 200 ] || exit 9; /bin/sleep 0.05; done; /bin/sleep 0.3', marker]
    const codes: string[] = []
    try {
      for (let i = 1; i <= 40; i++) {
        const run = spawnSync(gitBash(), [boundedScript(), '15', join(scratch, 'run.out'), ON_WINDOWS ? '/usr/bin/bash' : 'bash', SCRIPT, 'lock-run', ...waitThenWork], {
          cwd: scratch,
          env: sandboxEnv({ HB_PIDS: join(scratch, `hb-${i}`), STUBS: join(scratch, 'bin'), STARTED: join(scratch, 'bin', 'started.sh') }),
          // No pipes: in Git Bash a `sleep` the trap left behind holds the pipes of the whole run open.
          stdio: 'ignore',
          timeout: 60_000,
          killSignal: 'SIGKILL',
        })
        codes.push(run.error === undefined ? String(run.status) : 'timeout')
        if (existsSync(lock)) codes[codes.length - 1] += '+lock'
        if (existsSync(lock)) rmdirSync(lock)
      }
      expect(codes.filter((code) => code !== '0'), `exit codes of the 40 runs (124: cut off after 15 s): ${codes.join(' ')}`).toEqual([])
      expect(linesOf(sleeps), 'every run had a heartbeat sleep').toHaveLength(40)
      // A killed process can take a moment to go: up to 2 seconds.
      await until(() => procs('alive', linesOf(sleeps), 'sleep 300').length === 0, 10_000)
      expect(procs('alive', linesOf(shells), marker), 'heartbeat shells left').toEqual([])
      expect(procs('alive', linesOf(sleeps), 'sleep 300'), 'heartbeat sleeps left').toEqual([])
    } finally {
      procs('end', procs('alive', linesOf(shells), marker))
      procs('end', procs('alive', linesOf(sleeps), 'sleep 300'))
    }
  }, 900_000 * timeScale)

  it('a heartbeat whose script was killed with kill -9 ends with that script, though the lock stays', async () => {
    // The trap did not run, so the lock folder stays until it goes stale; the heartbeat must not keep
    // it fresh for ever. Here the heartbeat sleeps 0.2 s, and its sleep records the heartbeat's pid.
    const parents = join(scratch, 'heartbeat-parents')
    const main = join(scratch, 'main-pid')
    const go = join(scratch, 'go')
    const command = join(scratch, 'command-pid')
    stubCommand('sleep', [`if [ "$1" = 300 ]; then echo "$PPID" >> '${parents}'; set -- 0.2; fi`, 'exec /bin/sleep "$@"'])
    const marker = `hb-marker-${process.pid}-${Date.now()}`
    const waitForGo = ['sh', '-c', `echo "$PPID" > '${main}'; echo "$$" > '${command}'; n=0; until [ -e '${go}' ] || [ "$n" -ge 400 ]; do n=$((n + 1)); /bin/sleep 0.05; done`, marker]
    // Through FRONT, so the stand-ins come first, and `exec`: the pid stays the script's.
    const child = spawn(gitBash(), ['-c', `${FRONT}; exec bash "$@"`, 'front', SCRIPT, 'lock-run', ...waitForGo], { cwd: scratch, env: sandboxEnv({ STUBS: join(scratch, 'bin') }), stdio: 'ignore' })
    let exited = false
    child.on('exit', () => (exited = true))
    try {
      expect(await until(() => linesOf(parents).length > 0 && linesOf(main).length > 0, 10_000), 'the heartbeat did not start').toBe(true)
      procs('kill9', linesOf(main))
      // Node reaps the script here; until then it is a zombie that `kill -0 $$` of the heartbeat still finds.
      expect(await until(() => exited, 10_000), 'the script outlived kill -9').toBe(true)
      const heartbeat = linesOf(parents)[0] ?? ''
      // The heartbeat sleeps 0.2 s between its checks; 10 s leave room for a loaded Windows machine.
      expect(await until(() => procs('alive', [heartbeat], marker).length === 0, 10_000), 'the heartbeat outlived its script').toBe(true)
      expect(existsSync(lock), 'the lock was removed: this run shows nothing').toBe(true)
    } finally {
      writeFileSync(go, '')
      procs('end', procs('alive', linesOf(parents), marker))
      procs('end', procs('alive', linesOf(command), marker))
      if (!exited) child.kill('SIGKILL')
    }
  }, 60_000 * timeScale)
})
