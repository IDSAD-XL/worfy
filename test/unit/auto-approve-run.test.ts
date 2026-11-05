// What a Run gives the approval policy (worfy-auto-approve ticket 04): the git facts read when it starts
// (hooksActive, hooksPath, rebase.updateRefs, remotes, the default branch), the git environment of its
// Session, the worktrees of its Wave, and the Journal's cleaning of a command.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HARD_HINTS, hardHint, HINTS, type Decision } from '../../src/main/agent/auto-approve/policy'
import { configRunsProgram, GIT_CONFIG_PARAMETERS, gitEnvironment, hooksActiveOf, openRunApproval, readCheckouts, readGitFacts, runTempsDir, sweepRunTemps } from '../../src/main/agent/auto-approve/run-approval'
import type { PermissionRequestOptions } from '../../src/main/agent/session/types'
import { sessionOptions } from '../../src/main/vendors/claude/options'
import { ToolUseFolders, UNATTENDED_DENIED_MESSAGE, unattendedCanUseTool, unattendedDeniedMessage } from '../../src/main/vendors/claude/session'
import type { SessionApproval } from '../../src/main/vendors/session'
import { COMMAND_MAX, journalCommand, makeRunId } from '../../src/shared/autopilot/journal'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'
import { removeTreeAsync } from '../../src/main/storage/remove'
import { removeTestTree } from '../remove'

let scratch: string
let repo: string

const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_CONFIG_GLOBAL: join(scratch, 'global-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_PARAMETERS: '' })
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv(), encoding: 'utf8' })

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-aa04-unit-')))
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  writeFileSync(join(scratch, 'global-config'), '')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'demo')
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('configRunsProgram: a key of git config --list that names a program git may run', () => {
  it('takes every key the ticket names, and every key with one of the endings, without case', () => {
    for (const [key, value] of [
      ['diff.external', 'x'],
      ['core.sshcommand', 'ssh -i k'],
      ['core.sshCommand', 'ssh'],
      ['remote.origin.uploadpack', 'x'],
      ['remote.Origin.receivepack', 'x'],
      ['gpg.program', 'gpg2'],
      ['gpg.ssh.program', 'ssh-keygen'],
      ['gpg.ssh.defaultkeycommand', 'x'],
      ['GPG.SSH.DEFAULTKEYCOMMAND', 'x'],
      ['diff.ipynb.command', 'x'],
      ['merge.ours.driver', 'true'],
      ['trailer.Sign.cmd', 'x'],
      ['diff.ipynb.textconv', 'python3 -m nbstripout'],
      ['filter.nbstripout.clean', 'x'],
      ['filter.lfs.smudge', 'git-lfs smudge'],
      ['filter.lfs.process', 'git-lfs filter-process'],
      ['filter.lfs.PROCESS', 'x'],
      ['core.fsmonitor', './hook'],
      ['core.fsmonitor', 'yes'],
      ['core.fsmonitor', '1'],
      ['core.fsmonitor', null],
    ] as const) expect(configRunsProgram(key, value), `${key}=${String(value)}`).toBe(true)
  })

  it('leaves out the helpers the spec keeps out, core.fsmonitor true or false, and other keys', () => {
    for (const [key, value] of [
      ['credential.helper', 'osxkeychain'],
      ['core.askpass', 'x'],
      ['core.gitproxy', 'x'],
      ['core.pager', 'less'],
      ['pager.log', 'x'],
      ['core.fsmonitor', 'true'],
      ['core.fsmonitor', 'false'],
      ['core.fsmonitor', 'FALSE'],
      ['user.name', 'demo'],
      ['remote.origin.url', 'git@example.invalid:demo.git'],
      ['diff.external.note', 'x'],
      ['program.x', 'x'],
    ] as const) expect(configRunsProgram(key, value), `${key}=${String(value)}`).toBe(false)
  })
})

describe('hooksActiveOf', () => {
  const none = { hooksPath: null, hookFiles: [] as string[], config: [] as { key: string; value: string | null }[] }
  it('is false with no hooks, only sample hooks and no program in the config', () => {
    expect(hooksActiveOf(none)).toBe(false)
    expect(hooksActiveOf({ ...none, hookFiles: ['pre-commit.sample', 'commit-msg.sample'], config: [{ key: 'credential.helper', value: 'osxkeychain' }] })).toBe(false)
  })
  it('is true with core.hooksPath, a hook file that is not a sample, or a program in the config', () => {
    expect(hooksActiveOf({ ...none, hooksPath: '.husky/_' })).toBe(true)
    expect(hooksActiveOf({ ...none, hookFiles: ['pre-commit'] })).toBe(true)
    expect(hooksActiveOf({ ...none, hookFiles: ['pre-commit.sample.bak'] })).toBe(true)
    expect(hooksActiveOf({ ...none, config: [{ key: 'core.sshcommand', value: 'ssh' }] })).toBe(true)
  })
  it('is null when a part could not be read, unless another part already says true', () => {
    expect(hooksActiveOf({ ...none, hookFiles: null })).toBeNull()
    expect(hooksActiveOf({ ...none, config: null })).toBeNull()
    expect(hooksActiveOf({ ...none, hookFiles: null, hooksPath: '.githooks' })).toBe(true)
    expect(hooksActiveOf({ hooksPath: null, hookFiles: ['pre-push'], config: null })).toBe(true)
  })
})

describe('gitEnvironment: the git environment of the Run\'s Session', () => {
  it('always sets GIT_CONFIG_PARAMETERS with the three keys, and nothing else while hooksActive is false', () => {
    expect(GIT_CONFIG_PARAMETERS).toBe("'safe.bareRepository'='explicit' 'log.showSignature'='false' 'format.pretty'='medium'")
    expect(gitEnvironment(false)).toEqual({ GIT_CONFIG_PARAMETERS })
  })
  it('adds GIT_NO_LAZY_FETCH=1 when hooksActive is true or not known', () => {
    expect(gitEnvironment(true)).toEqual({ GIT_CONFIG_PARAMETERS, GIT_NO_LAZY_FETCH: '1' })
    expect(gitEnvironment(null)).toEqual({ GIT_CONFIG_PARAMETERS, GIT_NO_LAZY_FETCH: '1' })
  })
  it('sets no GIT_CONFIG_COUNT: the parser of ticket 02 judges no git under it', () => {
    expect(Object.keys(gitEnvironment(true))).not.toContain('GIT_CONFIG_COUNT')
  })
})

describe('readGitFacts: what the Run reads of the repository when it starts', () => {
  it('a plain repository: no hooks, rebase.updateRefs false, its remotes, the default branch', async () => {
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/demo.git')
    git(repo, 'remote', 'add', 'upstream', 'https://example.invalid/up.git')
    expect(await readGitFacts(repo, gitEnv())).toEqual({ hooksPath: null, hooksActive: false, rebaseUpdateRefs: false, remotes: ['origin', 'upstream'], defaultBranch: 'main' })
  })

  it('reads rebase.updateRefs as git prints it, and the default branch of origin/HEAD', async () => {
    git(repo, 'config', 'rebase.updateRefs', 'yes')
    git(repo, 'branch', 'trunk')
    git(repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    expect(await readGitFacts(repo, gitEnv())).toMatchObject({ rebaseUpdateRefs: true, defaultBranch: 'trunk' })
  })

  it('a value of rebase.updateRefs git cannot read as a boolean is not known (null)', async () => {
    git(repo, 'config', 'rebase.updateRefs', 'maybe')
    expect(await readGitFacts(repo, gitEnv())).toMatchObject({ rebaseUpdateRefs: null })
  })

  it('core.hooksPath as git prints it, and hooksActive true with it', async () => {
    git(repo, 'config', 'core.hooksPath', '.husky/_')
    expect(await readGitFacts(repo, gitEnv())).toMatchObject({ hooksPath: '.husky/_', hooksActive: true })
  })

  it('a hook file in hooks/ of the common git folder, read from a worktree too', async () => {
    writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\n')
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', join(scratch, 'wt'))
    expect(await readGitFacts(join(scratch, 'wt'), gitEnv())).toMatchObject({ hooksPath: null, hooksActive: true })
  })

  it('a program of the global config counts (core.sshCommand of the owner)', async () => {
    writeFileSync(join(scratch, 'global-config'), '[core]\n\tsshCommand = ssh -i demo\n')
    expect(await readGitFacts(repo, gitEnv())).toMatchObject({ hooksActive: true })
  })

  it('credential.helper alone does not', async () => {
    writeFileSync(join(scratch, 'global-config'), '[credential]\n\thelper = osxkeychain\n')
    expect(await readGitFacts(repo, gitEnv())).toMatchObject({ hooksActive: false })
  })

  it('a folder that is no repository: hooksActive and remotes are null, nothing is read as false', async () => {
    const plain = join(scratch, 'plain')
    mkdirSync(plain)
    const env = { ...gitEnv(), GIT_CEILING_DIRECTORIES: scratch }
    const facts = await readGitFacts(plain, env)
    expect(facts).toMatchObject({ hooksActive: null, remotes: null, rebaseUpdateRefs: null })
  })

  it('a hooksPath read that fails with another exit code than 1 throws: the Run gets no policy', async () => {
    writeFileSync(join(repo, '.git', 'config'), '[core\nbroken')
    await expect(readGitFacts(repo, gitEnv())).rejects.toThrow(/core\.hooksPath/)
  })
})

describe('readCheckouts: the worktrees of the Project with their branches', () => {
  it('lists the main checkout and each worktree, a detached one with a null branch', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', join(scratch, 'wt1'))
    git(repo, 'worktree', 'add', '-q', '--detach', join(scratch, 'wt2'))
    expect(await readCheckouts(repo, gitEnv())).toEqual([
      { path: repo, branch: 'main' },
      { path: join(scratch, 'wt1'), branch: 'demo/01' },
      { path: join(scratch, 'wt2'), branch: null },
    ])
  })
  it('null when the list cannot be read', async () => {
    const plain = join(scratch, 'plain')
    mkdirSync(plain)
    expect(await readCheckouts(plain, { ...gitEnv(), GIT_CEILING_DIRECTORIES: scratch })).toBeNull()
  })
})

describe('openRunApproval: the context of each request', () => {
  const open = async (shellEnv: Record<string, string> = { HOME: homedir(), USERPROFILE: homedir() }) =>
    openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv, gitEnv: gitEnv(), sessions: { list: () => [] } })

  it('a delete inside the worktree of a Ticket of the Wave is allowed; before the Wave names the Ticket it is not', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', join(scratch, 'wt'))
    const approval = await open()
    const request = { tool: 'Bash', input: { command: `rm -rf '${join(scratch, 'wt', 'build')}'` } }
    const at = { cwd: join(scratch, 'wt'), scratchpad: null, sessionId: 's', started: approval.environment }
    expect((await approval.judge(request, at)).outcome).not.toBe('allow')
    approval.setWave(['01'])
    expect(await approval.judge(request, at)).toMatchObject({ outcome: 'allow', rule: 'files-inside-roots' })
    await approval.close()
  })

  it('a relative target is judged from the shell folder of the request, not from the Project', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', join(scratch, 'wt'))
    const approval = await open()
    approval.setWave(['01'])
    const request = { tool: 'Bash', input: { command: 'rm -rf build' } }
    expect(await approval.judge(request, { cwd: join(scratch, 'wt'), scratchpad: null, sessionId: 's', started: approval.environment })).toMatchObject({ outcome: 'allow', targets: [join(realpathSync(scratch), 'wt', 'build')] })
    expect((await approval.judge(request, { cwd: repo, scratchpad: null, sessionId: 's', started: approval.environment })).outcome).not.toBe('allow')
    await approval.close()
  })

  it('the Run\'s TMPDIR folder exists from the start, is a root, and close() removes it', async () => {
    const approval = await open()
    expect(approval.runTemp).toBe(join(scratch, 'data', 'autopilot-tmp', approval.run))
    expect(approval.environment).toMatchObject({ TMPDIR: approval.runTemp })
    const decision = await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(approval.runTemp, 'x')}'` } }, { cwd: repo, scratchpad: null, sessionId: 's', started: approval.environment })
    expect(decision).toMatchObject({ outcome: 'allow' })
    await approval.close()
    const { existsSync } = await import('node:fs')
    expect(existsSync(approval.runTemp)).toBe(false)
  })

  it('the scratchpad Claude Code names for the request is a root', async () => {
    const pad = join(scratch, 'pad')
    mkdirSync(pad)
    const approval = await open()
    const decision = await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(pad, 'x')}'` } }, { cwd: repo, scratchpad: pad, sessionId: 's', started: approval.environment })
    expect(decision).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it('a Bash request whose shell folder is not known is not judged against another folder: deny with a hint', async () => {
    const approval = await open()
    expect(await approval.judge({ tool: 'Bash', input: { command: 'rm -rf build' } }, { cwd: null, scratchpad: null, sessionId: 's', started: approval.environment })).toEqual({ outcome: 'deny', rule: 'no-cwd', hint: HINTS.notJudged, targets: [] })
    await approval.close()
  })

  it('a worktree list that cannot be read approves nothing (it is never passed empty)', async () => {
    const approval = await open()
    approval.setWave(['01'])
    removeTestTree(join(repo, '.git'))
    expect(await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(approval.runTemp, 'x')}'` } }, { cwd: repo, scratchpad: null, sessionId: 's', started: approval.environment })).toEqual({ outcome: 'deny', rule: 'no-checkouts', hint: HINTS.notJudged, targets: [] })
    await approval.close()
  })
})

describe('openRunApproval: the environment, the git facts and the folders of round 2 (review of PR #1460)', () => {
  const posix = process.platform !== 'win32'
  const shell = (extra: Record<string, string> = {}): Record<string, string> => ({ ...(process.env as Record<string, string>), HOME: homedir(), USERPROFILE: homedir(), ...extra })
  const open = (shellEnv: Record<string, string> = shell(), more: { platform?: NodeJS.Platform; gitEnv?: NodeJS.ProcessEnv | null } = {}) =>
    openRunApproval({
      root: repo,
      epic: 'demo',
      dataDir: join(scratch, 'data'),
      harnessHome: join(scratch, 'harness'),
      shellEnv,
      ...(more.gitEnv === null ? {} : { gitEnv: more.gitEnv ?? gitEnv() }),
      sessions: { list: () => [] },
      ...(more.platform === undefined ? {} : { platform: more.platform }),
    })
  const wt = (): string => join(scratch, 'wt')
  const inWave = async (shellEnv?: Record<string, string>, more?: Parameters<typeof open>[1]) => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', wt())
    mkdirSync(join(wt(), 'build'))
    const approval = await open(shellEnv, more)
    approval.setWave(['01'])
    return approval
  }
  const ask = (approval: Awaited<ReturnType<typeof open>>, command: string, started: Readonly<Record<string, string>> = approval.environment) =>
    approval.judge({ tool: 'Bash', input: { command } }, { cwd: wt(), scratchpad: null, sessionId: 's', started })

  it.skipIf(!posix)('judges in the whole environment of the shell: CDPATH, BASH_ENV, IFS and GIT_DIR each keep a command they change from allow', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ CDPATH: homedir() }, 'cd build && rm -rf x'],
      [{ BASH_ENV: join(scratch, 'env.sh') }, "bash -c 'rm -rf build/x'"],
      [{ IFS: ':' }, 'rm -rf build/x'],
      [{ GIT_DIR: join(scratch, 'other.git') }, 'git log --oneline -1'],
    ]
    const plain = await inWave()
    for (const [, command] of cases) expect((await ask(plain, command)).outcome, command).toBe('allow')
    await plain.close()
    for (const [extra, command] of cases) {
      const approval = await open(shell(extra))
      approval.setWave(['01'])
      expect((await ask(approval, command)).outcome, `${Object.keys(extra)[0]}: ${command}`).not.toBe('allow')
      await approval.close()
    }
  })

  it('reads git in the shell\'s environment by default: a program in the global config the shell names counts', async () => {
    const global = join(scratch, 'shell-global-config')
    writeFileSync(global, '[core]\n\tsshCommand = ssh -i key\n')
    const approval = await open(shell({ GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' }), { gitEnv: null })
    expect(approval.facts.hooksActive).toBe(true)
    expect(approval.environment).toMatchObject({ GIT_NO_LAZY_FETCH: '1' })
    await approval.close()
    const clean = await open(shell({ GIT_CONFIG_GLOBAL: join(scratch, 'global-config'), GIT_CONFIG_NOSYSTEM: '1' }), { gitEnv: null })
    expect(clean.facts.hooksActive).toBe(false)
    await clean.close()
  })

  it.skipIf(!posix)('reads git again at each request: a hook the agent set since the start keeps git from allow', async () => {
    const approval = await inWave()
    expect((await ask(approval, 'git status')).outcome).toBe('allow')
    git(repo, 'config', 'core.hooksPath', '.husky/_')
    expect((await ask(approval, 'git status')).outcome).not.toBe('allow')
    await approval.close()
  })

  it.skipIf(!posix)('a process without the run\'s git environment, or without GIT_NO_LAZY_FETCH once hooks came, gets git parked', async () => {
    const approval = await inWave()
    expect(await ask(approval, 'git log --oneline -1')).toMatchObject({ outcome: 'allow', rule: 'git-in-wave-worktree' })
    expect(await ask(approval, 'git log --oneline -1', {})).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    expect(await ask(approval, 'git log --oneline -1 && rm -rf build/x', {})).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    // Files are judged as before.
    expect(await ask(approval, 'rm -rf build/x', {})).toMatchObject({ outcome: 'allow' })
    writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\n')
    expect(approval.environment).not.toHaveProperty('GIT_NO_LAZY_FETCH')
    expect(await ask(approval, 'git log --oneline -1')).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    expect(await ask(approval, 'git log --oneline -1', { ...approval.environment, GIT_NO_LAZY_FETCH: '1' })).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it.skipIf(!posix)('the folder for temporary files is the one the process started with, also another run\'s', async () => {
    const approval = await inWave()
    const other = join(scratch, 'data', 'autopilot-tmp', 'other-run')
    mkdirSync(other, { recursive: true })
    expect((await ask(approval, `rm -rf '${join(other, 'x')}'`, { ...approval.environment, TMPDIR: other })).outcome).toBe('allow')
    expect((await ask(approval, `rm -rf '${join(other, 'x')}'`)).outcome).not.toBe('allow')
    expect((await ask(approval, `rm -rf '${join(approval.runTemp, 'x')}'`, {})).outcome).toBe('allow')
    await approval.close()
  })

  it.skipIf(!posix)('mktemp -d: a new folder in TMPDIR on Linux; on macOS, where mktemp ignores TMPDIR, outside every root', async () => {
    const linux = await open(shell(), { platform: 'linux' })
    expect((await linux.judge({ tool: 'Bash', input: { command: 'X=$(mktemp -d) && touch "$X/a"' } }, { cwd: repo, scratchpad: null, sessionId: 's', started: linux.environment })).outcome).toBe('allow')
    await linux.close()
    const mac = await open(shell(), { platform: 'darwin' })
    expect((await mac.judge({ tool: 'Bash', input: { command: 'X=$(mktemp -d) && touch "$X/a"' } }, { cwd: repo, scratchpad: null, sessionId: 's', started: mac.environment })).outcome).toBe('park')
    await mac.close()
  })

  it('a repository without hooks/ has hooksActive false; core.fsmonitor true from real git is no program, a path is', async () => {
    removeTestTree(join(repo, '.git', 'hooks'))
    expect((await readGitFacts(repo, gitEnv())).hooksActive).toBe(false)
    git(repo, 'config', 'core.fsmonitor', 'true')
    git(repo, 'config', 'diff.demo.cachetextconv', 'true')
    expect((await readGitFacts(repo, gitEnv())).hooksActive).toBe(false)
    git(repo, 'config', 'core.fsmonitor', '/usr/local/bin/watchman-hook')
    expect((await readGitFacts(repo, gitEnv())).hooksActive).toBe(true)
  })

  it('sweepRunTemps removes the folders of runs that started before, and keeps a later run\'s and other names', async () => {
    const dir = runTempsDir(join(scratch, 'data'))
    const old = makeRunId(new Date('2026-11-05T10:00:00Z'), 'abcdef')
    const later = makeRunId(new Date('2026-11-05T12:00:01Z'), '000001')
    for (const name of [old, later, 'notes']) mkdirSync(join(dir, name, 'inner'), { recursive: true })
    await sweepRunTemps(join(scratch, 'data'), new Date('2026-11-05T12:00:00Z'))
    expect(readdirSync(dir).sort()).toEqual([later, 'notes'].sort())
    await sweepRunTemps(join(scratch, 'nothing-here'))
  })

  it('close() removes the folder without blocking: a promise of the removal', async () => {
    const approval = await open()
    writeFileSync(join(approval.runTemp, 'f'), 'x')
    const closing = approval.close()
    expect(closing).toBeInstanceOf(Promise)
    await closing
    expect(existsSync(approval.runTemp)).toBe(false)
  })
})

describe('openRunApproval: round 3 (review of PR #1460)', () => {
  const posix = process.platform !== 'win32'
  const shell = (): Record<string, string> => ({ ...(process.env as Record<string, string>), HOME: homedir(), USERPROFILE: homedir() })
  const open = (platform?: NodeJS.Platform) =>
    openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: gitEnv(), sessions: { list: () => [] }, ...(platform === undefined ? {} : { platform }) })
  const wt = (): string => join(scratch, 'wt')
  const inWave = async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', wt())
    const approval = await open()
    approval.setWave(['01'])
    return approval
  }
  const ask = (approval: Awaited<ReturnType<typeof open>>, command: string, cwd = wt(), env?: Record<string, string>) =>
    approval.judge({ tool: 'Bash', input: { command } }, { cwd, scratchpad: null, sessionId: 's', started: approval.environment, ...(env === undefined ? {} : { env }) })

  it.skipIf(!posix)('reads git in the checkout the command runs in: a core.hooksPath of the worktree\'s own config keeps git status from allow', async () => {
    const approval = await inWave()
    expect(await ask(approval, 'git status')).toMatchObject({ outcome: 'allow', rule: 'git-in-wave-worktree' })
    expect(await ask(approval, `git -C '${wt()}' status`, repo)).toMatchObject({ outcome: 'allow', rule: 'git-in-wave-worktree' })
    git(repo, 'config', 'extensions.worktreeConfig', 'true')
    git(wt(), 'config', '--worktree', 'core.hooksPath', 'hooks')
    // The Project's own checkout sees no hook: only the worktree's config names one.
    expect((await readGitFacts(repo, gitEnv())).hooksPath).toBeNull()
    expect((await ask(approval, 'git status')).outcome).not.toBe('allow')
    // The checkout after git -C, from a shell that stands in the Project.
    expect((await ask(approval, `git -C '${wt()}' status`, repo)).outcome).not.toBe('allow')
    // A write into the hooks folder of the worktree's config is refused as one into .git/hooks.
    expect(await ask(approval, `touch '${join(wt(), 'hooks', 'pre-commit')}'`)).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    await approval.close()
  })

  it.skipIf(!posix)('an includeIf "gitdir:" of the Project\'s config that names only the worktree counts there', async () => {
    const approval = await inWave()
    expect(await ask(approval, 'git status')).toMatchObject({ outcome: 'allow' })
    const included = join(scratch, 'included-config')
    writeFileSync(included, '[core]\n\thooksPath = .husky/_\n')
    git(repo, 'config', 'includeIf.gitdir:**/worktrees/wt.path', included)
    expect((await readGitFacts(repo, gitEnv())).hooksPath).toBeNull()
    expect((await readGitFacts(wt(), gitEnv())).hooksPath).toBe('.husky/_')
    expect((await ask(approval, 'git status')).outcome).not.toBe('allow')
    // A read of refs and objects stays allowed, for a process that started with GIT_NO_LAZY_FETCH only.
    expect(await ask(approval, 'git log --oneline -1')).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    const fetchless = { ...approval.environment, GIT_NO_LAZY_FETCH: '1' }
    expect(await approval.judge({ tool: 'Bash', input: { command: 'git log --oneline -1' } }, { cwd: wt(), scratchpad: null, sessionId: 's', started: fetchless })).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it.skipIf(!posix)('a git command in a folder git cannot read there is judged as with hooks not known: no git status', async () => {
    const approval = await inWave()
    expect((await ask(approval, `mkdir -p '${join(wt(), 'n')}' && cd '${join(wt(), 'n')}' && git status`)).outcome).not.toBe('allow')
    await approval.close()
  })

  it.skipIf(!posix)('judges with the whole environment the process started with, when the driver tells it', async () => {
    const approval = await inWave()
    mkdirSync(join(wt(), 'build'))
    expect((await ask(approval, 'cd build && rm -rf x')).outcome).toBe('allow')
    expect((await ask(approval, 'cd build && rm -rf x', wt(), { ...shell(), ...approval.environment, CDPATH: homedir() })).outcome).not.toBe('allow')
    expect((await ask(approval, "zsh -c 'rm -rf build/x'", wt(), { ...shell(), ...approval.environment, ZDOTDIR: join(scratch, 'z') })).outcome).not.toBe('allow')
    await approval.close()
  })

  it.skipIf(!posix)('on macOS the hint of a hard deny in the home folder names the folder form that is approved there', async () => {
    const mac = await open('darwin')
    const hard = await mac.judge({ tool: 'Bash', input: { command: `rm -rf '${join(homedir(), '.ssh', 'x')}'` } }, { cwd: repo, scratchpad: null, sessionId: 's', started: mac.environment })
    expect(hard).toMatchObject({ outcome: 'hard-deny', hint: hardHint('ssh', 'darwin') })
    expect(hardHint('ssh', 'darwin')).toContain('mkdir -p "$TMPDIR/<name>"')
    expect(hardHint('ssh', 'darwin')).not.toContain('mktemp')
    expect(hardHint('ssh', 'linux')).toBe(HARD_HINTS['ssh'])
    expect(hardHint('ssh', 'win32')).toBe(HARD_HINTS['ssh'])
    // The form the hint names is approved.
    const named = 'mkdir -p "$TMPDIR/work" && touch "$TMPDIR/work/a"'
    expect((await mac.judge({ tool: 'Bash', input: { command: named } }, { cwd: repo, scratchpad: null, sessionId: 's', started: mac.environment })).outcome).toBe('allow')
    await mac.close()
  })
})

describe('removeTreeAsync', () => {
  it.skipIf(process.platform === 'win32')('looks through the tree first: a volume mounted in it removes nothing', async () => {
    const root = join(scratch, 'tree')
    mkdirSync(join(root, 'mounted'), { recursive: true })
    const removed: string[] = []
    const look = {
      lstat: (path: string) => Promise.resolve({ isDirectory: () => true, dev: path.endsWith('mounted') ? 2 : 1 }),
      readdir: (path: string) => Promise.resolve(path === root ? ['mounted'] : []),
    }
    await expect(removeTreeAsync(root, { look, rm: (path) => Promise.resolve(void removed.push(path)) })).rejects.toMatchObject({ code: 'EXDEV' })
    expect(removed).toEqual([])
    await removeTreeAsync(root)
    expect(existsSync(root)).toBe(false)
    await removeTreeAsync(root)
  })

  it.skipIf(process.platform === 'win32')('looks through the tree without blocking: other work runs while it looks (round 3 of PR #1460)', async () => {
    const root = join(scratch, 'tree')
    for (let n = 0; n < 20; n++) mkdirSync(join(root, `d${n}`, 'e'), { recursive: true })
    let ticked = false
    setImmediate(() => {
      ticked = true
    })
    let tickedAtRm: boolean | null = null
    await removeTreeAsync(root, {
      rm: () => {
        tickedAtRm = ticked
        return Promise.resolve()
      },
    })
    expect(tickedAtRm).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('a part the look cannot read removes nothing, and the error names the path given', async () => {
    const root = join(scratch, 'tree')
    mkdirSync(join(root, 'a'), { recursive: true })
    const removed: string[] = []
    const look = {
      lstat: (path: string) => (path.endsWith('/a') ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })) : Promise.resolve({ isDirectory: () => true, dev: 1 })),
      readdir: (path: string) => Promise.resolve(path === root ? ['a'] : []),
    }
    await expect(removeTreeAsync(root, { look, rm: (path) => Promise.resolve(void removed.push(path)) })).rejects.toMatchObject({ code: 'EACCES', message: expect.stringContaining(`Nothing of ${root} was removed`) })
    expect(removed).toEqual([])
    // An entry its folder still lists, which lstat cannot find (a name that is not UTF-8 on Linux): not seen either.
    const listed = {
      lstat: (path: string) => (path.endsWith('/a') ? Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })) : Promise.resolve({ isDirectory: () => true, dev: 1 })),
      readdir: (path: string) => Promise.resolve(path === root ? ['a'] : []),
    }
    await expect(removeTreeAsync(root, { look: listed, rm: (path) => Promise.resolve(void removed.push(path)) })).rejects.toMatchObject({ code: 'ENOENT', message: expect.stringContaining('still lists it') })
    // Gone meanwhile, and no longer listed: nothing to keep from the removal.
    let listings = 0
    const gone = { lstat: listed.lstat, readdir: (path: string) => Promise.resolve(path === root && listings++ === 0 ? ['a'] : []) }
    await removeTreeAsync(root, { look: gone, rm: (path) => Promise.resolve(void removed.push(path)) })
    expect(removed).toEqual([root])
  })
})

describe('journalCommand: a command as the Journal keeps it', () => {
  const home = '/Users/demo'
  it('writes the home folder as ~, a secret assignment as NAME=***, and keeps at most COMMAND_MAX units', () => {
    expect(COMMAND_MAX).toBe(200)
    expect(journalCommand('rm -rf /Users/demo/projects/app/build', home)).toBe('rm -rf ~/projects/app/build')
    expect(journalCommand('GH_TOKEN=ghp_demo123 gh pr list', home)).toBe('GH_TOKEN=*** gh pr list')
    expect(journalCommand("export API_KEY='a b c' && MY_SECRET=\"x y\" DB_PASSWORD=p run", home)).toBe('export API_KEY=*** && MY_SECRET=*** DB_PASSWORD=*** run')
    expect(journalCommand('gh_token=abc x', home)).toBe('gh_token=*** x')
    expect(journalCommand('NAME=demo x', home)).toBe('NAME=demo x')
    const long = journalCommand(`GH_TOKEN=secret-demo-token rm -rf ${'/Users/demo/a '.repeat(40)}`, home)
    expect(long.length).toBeLessThanOrEqual(COMMAND_MAX)
    expect(long).not.toContain('secret-demo-token')
    expect(long).not.toContain('/Users/demo')
  })

  it('cuts after the cleaning: a secret where the cut falls leaves none of its value, and the line is COMMAND_MAX long', () => {
    const command = `echo ${'a'.repeat(183)} GH_TOKEN=supersecretvalue123 x`
    expect(command.length).toBeGreaterThan(COMMAND_MAX)
    const kept = journalCommand(command, home)
    expect(kept).toBe(`echo ${'a'.repeat(183)} GH_TOKEN=**`)
    expect(kept).toHaveLength(COMMAND_MAX)
    expect(journalCommand(`${'b'.repeat(250)}`, home)).toHaveLength(COMMAND_MAX)
  })

  it('hides every form of a secret the review found', () => {
    const cases: [string, string][] = [
      ['TOKEN=abc run', 'TOKEN=*** run'],
      ['PASSWORD=hunter2 run', 'PASSWORD=*** run'],
      ['GITHUB_PAT=abc AUTH=xyz DB_PASS=p run', 'GITHUB_PAT=*** AUTH=*** DB_PASS=*** run'],
      ['TOKEN= run', 'TOKEN=*** run'],
      ['curl -H "Authorization: Bearer abc.def.ghi" https://x', 'curl -H "Authorization: ***" https://x'],
      ["curl -H 'authorization: token abc123' x", "curl -H 'authorization: ***' x"],
      ['curl -H "X: Bearer abcdefghijkl" x', 'curl -H "X: Bearer ***" x'],
      ['git clone https://user:p4ss@example.invalid/r.git', 'git clone https://user:***@example.invalid/r.git'],
      ['tool --token abc --password xyz --password=q --api-key k --client-secret s', 'tool --token *** --password *** --password=*** --api-key *** --client-secret ***'],
      ['tool --secret-key k --token-file f', 'tool --secret-key *** --token-file ***'],
      ['curl -u demo:secret x', 'curl -u demo:*** x'],
      ['mysql -u root -psecret db', 'mysql -u root -p*** db'],
      ['echo ghp_abcdefghijklmnop1234 github_pat_abcdefghijklmnop_1234 sk-abcdefghijklmnop1234 xoxb-1234-abcd AKIAABCDEFGHIJKLMNOP', 'echo *** *** *** *** ***'],
    ]
    for (const [command, kept] of cases) expect(journalCommand(command, home), command).toBe(kept)
    // What is not a secret stays.
    for (const command of ['PATH=/usr/bin make', 'AUTHOR=demo x', 'mkdir -p build', 'git log -p', 'NAME=demo x']) expect(journalCommand(command, home), command).toBe(command)
  })

  it('hides the forms of round 3 (review of PR #1460): JSON, .netrc, headers, curl -u joined or quoted, docker login, sshpass, --key', () => {
    const cases: [string, string][] = [
      [`curl -d '{"token":"abc","user":"demo"}' x`, `curl -d '{"token":"***","user":"demo"}' x`],
      [`curl -d '{"password": "a b c", "secret":"s", "api_key":"k"}' x`, `curl -d '{"password": "***", "secret":"***", "api_key":"***"}' x`],
      [`curl -d "{\\"token\\":\\"abc\\"}" x`, `curl -d "{\\"token\\":\\"***\\"}" x`],
      [`curl -d '{"x-auth":"v"}' x`, `curl -d '{"x-auth":"***"}' x`],
      [`printf 'machine x login demo password hunter2' > n`, `printf 'machine x login demo password ***' > n`],
      [`curl -H "X-Api-Key: abc def" x`, `curl -H "X-Api-Key: ***" x`],
      [`curl -H 'Cookie: a=b; c=d' x`, `curl -H 'Cookie: ***' x`],
      ['curl -ubob:pass x', 'curl -ubob:*** x'],
      ['curl -u "bob:a b" x', 'curl -u "bob:***" x'],
      ['curl --user=bob:pass x', 'curl --user=bob:*** x'],
      ['docker login -u demo -p s3cret registry.invalid', 'docker login -u demo -p *** registry.invalid'],
      ['sshpass -p s3cret ssh host', 'sshpass -p *** ssh host'],
      ['tool --key=abc --key def', 'tool --key=*** --key ***'],
    ]
    for (const [command, kept] of cases) expect(journalCommand(command, home), command).toBe(kept)
    // What is not a secret stays.
    for (const command of [`curl -d '{"user":"demo","count":"3"}' x`, 'docker run -p 8080:80 image', 'tool --keyboard us', `curl -H 'Accept: text/plain' x`]) expect(journalCommand(command, home), command).toBe(command)
  })
  it('the home folder of Windows in every form', () => {
    expect(journalCommand('rm -rf C:\\Users\\Demo\\x /c/Users/Demo/y', 'C:\\Users\\Demo')).toBe('rm -rf ~\\x ~/y')
  })
})

describe('the Claude driver: environment, PreToolUse hook and the unattended canUseTool by mode', () => {
  const runtime = { packaged: false, resourcesPath: '/nowhere', platform: process.platform, arch: process.arch }

  it('sessionOptions lays the run\'s variables over the agent environment, and adds a hook only with toolUse', async () => {
    const plain = sessionOptions({ cwd: '/tmp/demo', env: { HOME: '/tmp/demo-home', TMPDIR: '/tmp/x' }, runtime })
    expect(plain.env).toEqual({ HOME: '/tmp/demo-home', TMPDIR: '/tmp/x' })
    expect(plain).not.toHaveProperty('hooks')
    const seen: unknown[] = []
    const options = sessionOptions({ cwd: '/tmp/demo', env: { HOME: '/tmp/demo-home', TMPDIR: '/tmp/x' }, runtime, environment: { TMPDIR: '/tmp/run', GIT_CONFIG_PARAMETERS }, toolUse: (use) => seen.push(use) })
    expect(options.env).toEqual({ HOME: '/tmp/demo-home', TMPDIR: '/tmp/run', GIT_CONFIG_PARAMETERS })
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0]
    expect(hook).toBeDefined()
    const signal = new AbortController().signal
    // The hook answers nothing: Claude Code goes on as without it.
    expect(await hook!({ hook_event_name: 'PreToolUse', session_id: 's', transcript_path: '', cwd: '/tmp/demo/wt', scratchpad_dir: '/tmp/pad', tool_name: 'Bash', tool_input: {}, tool_use_id: 'toolu_1' } as never, 'toolu_1', { signal })).toEqual({})
    expect(await hook!({ hook_event_name: 'PreToolUse', session_id: 's', transcript_path: '', cwd: '/tmp/demo', tool_name: 'Bash', tool_input: {}, tool_use_id: 'toolu_2' } as never, 'toolu_2', { signal })).toEqual({})
    expect(seen).toEqual([
      { toolUseId: 'toolu_1', cwd: '/tmp/demo/wt', scratchpad: '/tmp/pad' },
      { toolUseId: 'toolu_2', cwd: '/tmp/demo', scratchpad: null },
    ])
  })

  it('ToolUseFolders gives each call its folder once, nulls for a call the hook did not tell, and keeps only the latest 256', () => {
    const folders = new ToolUseFolders()
    folders.record({ toolUseId: 'a', cwd: '/tmp/a', scratchpad: null })
    expect(folders.take('a')).toEqual({ cwd: '/tmp/a', scratchpad: null })
    expect(folders.take('a')).toEqual({ cwd: null, scratchpad: null })
    expect(folders.take(null)).toEqual({ cwd: null, scratchpad: null })
    for (let n = 0; n < 300; n++) folders.record({ toolUseId: `t${n}`, cwd: `/tmp/${n}`, scratchpad: null })
    expect(folders.take('t43')).toEqual({ cwd: null, scratchpad: null })
    expect(folders.take('t44')).toEqual({ cwd: '/tmp/44', scratchpad: null })
    expect(folders.take('t299')).toEqual({ cwd: '/tmp/299', scratchpad: null })
  })

  it('ToolUseFolders gives each call the whole environment the process started with, once the query told it (round 3 of PR #1460)', () => {
    const folders = new ToolUseFolders()
    folders.record({ toolUseId: 'a', cwd: '/tmp/a', scratchpad: null })
    expect(folders.take('a')).not.toHaveProperty('env')
    folders.started({ HOME: '/tmp/demo-home', CDPATH: '/tmp' })
    folders.record({ toolUseId: 'b', cwd: '/tmp/b', scratchpad: null })
    expect(folders.take('b')).toEqual({ cwd: '/tmp/b', scratchpad: null, env: { HOME: '/tmp/demo-home', CDPATH: '/tmp' } })
    // A call the hook did not tell still runs in that process.
    expect(folders.take(null)).toEqual({ cwd: null, scratchpad: null, env: { HOME: '/tmp/demo-home', CDPATH: '/tmp' } })
  })

  /** The unattended canUseTool over a policy that answers `decision`, at `mode`. */
  function driver(mode: () => AutoApprovalMode, decision: Decision) {
    const refused: unknown[] = []
    const decided: unknown[] = []
    const judged: unknown[] = []
    const folders = new ToolUseFolders()
    const approval: SessionApproval = {
      mode,
      judge: (request, where) => {
        judged.push({ request, where })
        return Promise.resolve(decision)
      },
      decided: (fields) => decided.push(fields),
    }
    const canUseTool = unattendedCanUseTool((...args) => refused.push(args), approval, folders)
    const ask = (input: Record<string, unknown>, extra: Partial<PermissionRequestOptions> = {}) => canUseTool('Bash', input, { signal: new AbortController().signal, toolUseID: 'toolu_1', decisionReason: 'why', agentID: 'agent-1', ...extra })
    return { refused, decided, judged, folders, ask }
  }
  const deny = (rule: string, hint: string | null): Decision => ({ outcome: 'deny', rule, hint, targets: ['/tmp/demo/x'] })

  it('Off asks no policy and refuses as before; a mode that cannot be read is Off', async () => {
    for (const mode of [() => 'off' as const, () => { throw new Error('no settings') }]) {
      const d = driver(mode, deny('r', 'h'))
      expect(await d.ask({ command: 'rm -rf x' })).toEqual({ behavior: 'deny', message: unattendedDeniedMessage('why') })
      expect(d.judged).toEqual([])
      expect(d.decided).toEqual([])
      expect(d.refused).toEqual([['Bash', unattendedDeniedMessage('why'), { agent: 'agent-1', reason: 'why' }]])
    }
  })

  it('Shadow refuses with the message of Off, tells the decision as would-*, and not refused', async () => {
    for (const [outcome, recorded] of [['allow', 'would-allow'], ['deny', 'would-deny'], ['park', 'would-park'], ['hard-deny', 'hard-deny']] as const) {
      const d = driver(() => 'shadow', { outcome, rule: 'r', hint: 'h', targets: ['/tmp/demo/x'] })
      d.folders.record({ toolUseId: 'toolu_1', cwd: '/tmp/demo/wt', scratchpad: '/tmp/pad' })
      expect(await d.ask({ command: 'rm -rf x' })).toEqual({ behavior: 'deny', message: unattendedDeniedMessage('why') })
      expect(d.refused).toEqual([])
      expect(d.judged).toEqual([{ request: { tool: 'Bash', input: { command: 'rm -rf x' } }, where: { cwd: '/tmp/demo/wt', scratchpad: '/tmp/pad' } }])
      expect(d.decided).toEqual([{ mode: 'shadow', outcome: recorded, rule: 'r', tool: 'Bash', targets: ['/tmp/demo/x'], command: 'rm -rf x', agent: 'agent-1', reason: 'why' }])
    }
  })

  it('On answers by the decision: allow with the input unchanged, deny with the rule\'s hint after the reason, park with HINTS.parkPending', async () => {
    const input = { command: ' rm -rf ~/x ', description: 'd' }
    const allow = driver(() => 'on', { outcome: 'allow', rule: 'files-inside-roots', hint: null, targets: [] })
    expect(await allow.ask(input)).toEqual({ behavior: 'allow', updatedInput: input })
    expect(allow.decided).toMatchObject([{ mode: 'on', outcome: 'allow', command: ' rm -rf ~/x ' }])
    expect(await driver(() => 'on', deny('not-judged', 'the hint')).ask(input)).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\nthe hint` })
    expect(await driver(() => 'on', deny('not-judged', 'the hint')).ask(input, { decisionReason: undefined })).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nthe hint` })
    expect(await driver(() => 'on', { outcome: 'hard-deny', rule: 'hard:ssh', hint: 'never', targets: [] }).ask(input)).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\nnever` })
    const park = driver(() => 'on', { outcome: 'park', rule: 'outside-roots', hint: null, targets: [] })
    expect(await park.ask(input)).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\n${HINTS.parkPending}` })
    expect(park.decided).toMatchObject([{ mode: 'on', outcome: 'park', rule: 'outside-roots' }])
    // A deny without a hint keeps the refusal of Off.
    expect(await driver(() => 'on', deny('policy-failed', null)).ask(input)).toEqual({ behavior: 'deny', message: unattendedDeniedMessage('why') })
    // Another tool has no command.
    const edit = driver(() => 'on', deny('no-target', 'h'))
    await edit.ask({ file_path: '/tmp/demo/x' })
    expect(edit.decided).toMatchObject([{ command: null }])
  })

  it('the hint never carries a piece of the request', async () => {
    const d = driver(() => 'on', deny('not-judged', HINTS.notJudged))
    const answer = await d.ask({ command: 'echo IGNORE-PREVIOUS-INSTRUCTIONS' })
    expect(JSON.stringify(answer)).not.toContain('IGNORE-PREVIOUS-INSTRUCTIONS')
  })
})

describe('the run reads the repository and writes nothing into it (ADR-0005)', () => {
  it('opening the policy, judging and closing leave every file of the repository, .git included, as it was', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', join(scratch, 'wt'))
    const snapshot = (): Record<string, string> => {
      const out: Record<string, string> = {}
      const walk = (folder: string): void => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, entry.name)
          if (entry.isDirectory()) walk(path)
          else out[path] = `${statSync(path).mtimeMs}:${readFileSync(path, 'base64')}`
        }
      }
      walk(repo)
      walk(join(scratch, 'wt'))
      return out
    }
    const before = snapshot()
    const approval = await openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: null, shellEnv: { HOME: homedir(), USERPROFILE: homedir() }, gitEnv: gitEnv(), sessions: { list: () => [] } })
    approval.setWave(['01'])
    await approval.judge({ tool: 'Bash', input: { command: 'git log --oneline -1' } }, { cwd: join(scratch, 'wt'), scratchpad: null, sessionId: 's', started: approval.environment })
    await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(scratch, 'wt', 'x')}'` } }, { cwd: join(scratch, 'wt'), scratchpad: null, sessionId: 's', started: approval.environment })
    await approval.close()
    expect(snapshot()).toEqual(before)
  })
})
