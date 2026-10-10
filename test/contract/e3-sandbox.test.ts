// scripts/e3-sandbox.sh (worfy-harness ticket 26, item 1) on temporary folders: E3_SANDBOX_TMP is
// the temp dir its sandbox lives in and E3_LOCK_DIR its lock, so no test touches the real sandbox or
// the shared Electron lock /tmp/worfy-e2e.lock. HOME is a temporary folder too (the keychain link
// points into it), and `gh` is a stub first on the PATH: it records how it was called and prints a
// made-up token, so no test reads a real one.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'e3-sandbox.sh')
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
  rmSync(scratch, { recursive: true, force: true })
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

function sandbox(args: string[], options: { env?: Record<string, string>; timeout?: number } = {}): Run {
  const env: NodeJS.ProcessEnv = {
    PATH: `${join(scratch, 'bin')}:${process.env.PATH ?? ''}`,
    HOME: userHome,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: 'C.UTF-8',
    E3_SANDBOX_TMP: temp,
    E3_LOCK_DIR: lock,
    GH_CONFIG_DIR: join(scratch, 'gh-config'),
    ...options.env,
  }
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

describe('e3-sandbox.sh init', () => {
  it('makes the sandbox in the given temp dir: its folders, marker, .gitconfig and the variables of its login shells', () => {
    const run = sandbox(['init'])
    expectExit(run, 0)
    expect(run.stdout).toContain(`e3-sandbox: ${root}`)
    for (const dir of ['home/.claude', 'npm/bin', 'data', 'runs']) expect(lstatSync(join(root, dir)).isDirectory(), dir).toBe(true)
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

describe('e3-sandbox.sh env and run', () => {
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

describe('e3-sandbox.sh reset and reset-harness', () => {
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
    expectExit(sandbox(['reset']), 0)
  })

  it('reset-harness removes what an install left and keeps the sign-in', () => {
    expectExit(sandbox(['init']), 0)
    installed()
    writeFileSync(join(root, 'npm', 'bin', 'qmd'), '')
    writeFileSync(join(root, 'data', 'first-run.json'), '{}')
    mkdirSync(join(root, 'runs', 'one'))
    expectExit(sandbox(['reset-harness']), 0)
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

describe('e3-sandbox.sh lock-run', () => {
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

  it('waits for a lock touched 29 minutes ago, and takes one left 31 minutes ago', () => {
    const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000)
    mkdirSync(lock)
    utimesSync(lock, minutesAgo(29), minutesAgo(29))
    const waiting = sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch }, timeout: 2_500 })
    expect(waiting.timedOut).toBe(true)
    expect(ran()).toBe(false)
    expect(existsSync(lock)).toBe(true)

    utimesSync(lock, minutesAgo(31), minutesAgo(31))
    const taken = sandbox(['lock-run', ...touchRan], { env: { SCRATCH: scratch } })
    expectExit(taken, 0)
    expect(ran()).toBe(true)
    expect(existsSync(lock)).toBe(false)
  })

  it('refuses without a command, taking no lock', () => {
    expectExit(sandbox(['lock-run']), 2)
    expect(existsSync(lock)).toBe(false)
  })
})
