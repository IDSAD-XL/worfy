// scripts/e3-sandbox.sh (worfy-harness ticket 26, item 1) on temporary folders: E3_SANDBOX_TMP is
// the temp dir its sandbox lives in and E3_LOCK_DIR its lock, so no test touches the real sandbox or
// the shared Electron lock /tmp/worfy-e2e.lock (E3_LOCK_PAUSE shortens the pause between two attempts
// to take it). HOME is a temporary folder too (the keychain link
// points into it), and `gh` is a stub first on the PATH: it records how it was called and prints a
// made-up token, so no test reads a real one.
//
// The file is skipped on Windows (worfy-windows ticket 55): e3-sandbox.sh is the acceptance sandbox
// of the macOS app — a per-user temp dir of `getconf DARWIN_USER_TEMP_DIR`, the keychain under
// ~/Library/Keychains, zsh login shells — and is not supported there. Under Git Bash `ln -s` copies,
// so each init copied claude and node (337 MB); a script killed at the timeout kept a process in the
// folder of the test, and that folder (342 MB) stayed in %TEMP%.
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

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
  root = join(temp, 'worfy-e3-sandbox')
  userHome = join(scratch, 'user-home')
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
  const lines = ['#!/bin/sh', `printf '%s|HOME=%s|CLAUDE_CONFIG_DIR=%s|GH_CONFIG_DIR=%s\\n' "$*" "$HOME" "$CLAUDE_CONFIG_DIR" "$GH_CONFIG_DIR" >> '${ghLog}'`, `echo '${TOKEN}'`]
  if (code !== 0) lines.push("echo 'no oauth token found for github.com account IDSAD-XL' >&2")
  lines.push(`exit ${code}`)
  writeFileSync(join(bin, 'gh'), `${lines.join('\n')}\n`)
  chmodSync(join(bin, 'gh'), 0o755)
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
    PATH: `${join(scratch, 'bin')}:${process.env.PATH ?? ''}`,
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
  const run = spawnSync('bash', [SCRIPT, ...args], { cwd: scratch, env, encoding: 'utf8', input: '', timeout: options.timeout ?? 10_000, killSignal: 'SIGKILL' })
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut: run.error !== undefined, ms: Date.now() - started }
}

/** A finished run: its exit code, with the output in the message when it differs. */
function expectExit(run: Run, code: number): void {
  expect(run.timedOut, `the script did not finish in time:\n${run.stdout}${run.stderr}`).toBe(false)
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(code)
}

const ghCalls = (): string[] => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean) : [])

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh init', () => {
  it('makes the sandbox in the given temp dir: its folders, marker, .gitconfig and the variables of its login shells', () => {
    const run = sandbox(['init'])
    expectExit(run, 0)
    expect(run.stdout).toContain(`e3-sandbox: ${root}`)
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
    mkdirSync(root)
    writeFileSync(join(root, 'someone-elses.txt'), 'x\n')
    const run = sandbox(['init'])
    expectExit(run, 2)
    expect(run.stderr).toContain('not a sandbox of this script')
    expect(readdirSync(root)).toEqual(['someone-elses.txt'])
    expect(ghCalls()).toEqual([])
    // With the folder marked by mistake, reset would delete it: it must still refuse.
    expectExit(sandbox(['reset']), 2)
    expect(readdirSync(root)).toEqual(['someone-elses.txt'])
  })

  it('takes an empty folder of the same name', () => {
    mkdirSync(root)
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
    expect(readdirSync(temp)).toEqual([])
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

describe.skipIf(ON_WINDOWS)('e3-sandbox.sh lock-run', () => {
  const ran = (): boolean => existsSync(join(scratch, 'ran'))
  /** The command under the lock: it records that it ran, what E3_LOCK_HELD was and that the lock folder was there. */
  const touchRan = ['sh', '-c', 'echo "held=$E3_LOCK_HELD lock=$(ls -d "$E3_LOCK_DIR")" > "$SCRATCH/ran"']

  it('runs the command holding the lock, with E3_LOCK_HELD=1, and releases the lock; a caller on a pipe is not kept waiting', () => {
    const run = sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch } })
    expectExit(run, 0)
    expect(readFileSync(join(scratch, 'ran'), 'utf8')).toBe(`held=1 lock=${lock}\n`)
    expect(existsSync(lock)).toBe(false)
    // The heartbeat's `sleep 300` outlives the script; it must not hold this pipe open.
    expect(run.ms).toBeLessThan(5_000)
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

  /** A stand-in for a command the script calls by name, in <scratch>/bin: first on the script's PATH. */
  function stubCommand(name: string, lines: string[]): void {
    writeFileSync(join(scratch, 'bin', name), `${['#!/bin/sh', ...lines].join('\n')}\n`)
    chmodSync(join(scratch, 'bin', name), 0o755)
  }

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
