// What a Run gives the approval policy (worfy-auto-approve ticket 04): the git facts read when it starts
// (hooksActive, hooksPath, rebase.updateRefs, remotes, the default branch), the git environment of its
// Session, the worktrees of its Wave, and the Journal's cleaning of a command.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HARD_HINTS, hardHint, HINTS, includeHomes, type Decision } from '../../src/main/agent/auto-approve/policy'
import { configRunsProgram, GIT_CONFIG_PARAMETERS, gitEnvironment, hooksActiveOf, openRunApproval, readCheckouts, readGitFacts, runTempsDir, sweepRunTemps } from '../../src/main/agent/auto-approve/run-approval'
import type { PermissionRequestOptions } from '../../src/main/agent/session/types'
import { sessionOptions } from '../../src/main/vendors/claude/options'
import { ToolUseFolders, UNATTENDED_DENIED_MESSAGE, unattendedCanUseTool, unattendedDeniedMessage } from '../../src/main/vendors/claude/session'
import type { SessionApproval } from '../../src/main/vendors/session'
import { COMMAND_MAX, journalCommand, journalTarget, makeRunId } from '../../src/shared/autopilot/journal'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'
import { removeTreeAsync } from '../../src/main/storage/remove'
import { removeTestTree } from '../remove'

let scratch: string
let repo: string

// XDG_CONFIG_HOME of the machine (the Linux runners set one) would add its git/config to the config files read.
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_CONFIG_GLOBAL: join(scratch, 'global-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_PARAMETERS: '', XDG_CONFIG_HOME: undefined })
// No auto maintenance (test/git-env.ts): its detached run writes .git/objects/maintenance.lock after a commit, and the
// removal of the scratch folder after the test met it there (ENOTEMPTY). On the command line, not in the environment:
// GIT_CONFIG_COUNT there would change what the policy under test says.
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'maintenance.auto=false', ...args], { cwd, env: gitEnv(), encoding: 'utf8' })

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

/** A path as the system names it, compared: one separator, and without case on Windows (git may print another case). */
const samePathForm = (path: string): string => (process.platform === 'win32' ? resolve(path).replaceAll('\\', '/').toLowerCase() : resolve(path))

describe('readGitFacts: what the Run reads of the repository when it starts', () => {
  it('a plain repository: no hooks, rebase.updateRefs false, its remotes, the default branch', async () => {
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/demo.git')
    git(repo, 'remote', 'add', 'upstream', 'https://example.invalid/up.git')
    const facts = await readGitFacts(repo, gitEnv())
    expect({ ...facts, configFiles: facts.configFiles.map(samePathForm), commonDir: samePathForm(facts.commonDir ?? '') }).toEqual({ hooksPath: null, hooksActive: false, rebaseUpdateRefs: false, remotes: ['origin', 'upstream'], defaultBranch: 'main', configFiles: [samePathForm(join(repo, '.git', 'config')), samePathForm(join(scratch, 'global-config'))], checkoutConfig: false, commonDir: samePathForm(join(repo, '.git')) })
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

  it('reads rebase.updateRefs as git --bool does, from the config list (round 4 of PR #1460)', async () => {
    const config = join(repo, '.git', 'config')
    const plain = readFileSync(config, 'utf8')
    for (const [line, read] of [['\tupdateRefs\n', true], ['\tupdateRefs = on\n', true], ['\tupdateRefs = 1\n', true], ['\tupdateRefs = 0\n', false], ['\tupdateRefs = Off\n', false], ['\tupdateRefs = \n', false]] as const) {
      writeFileSync(config, `${plain}[rebase]\n${line}`)
      expect((await readGitFacts(repo, gitEnv())).rebaseUpdateRefs, line).toBe(read)
    }
  })

  it('a core.hooksPath without a value counts as set; the remotes of every key, of a dotted name and of the old folders', async () => {
    const config = join(repo, '.git', 'config')
    writeFileSync(config, `${readFileSync(config, 'utf8')}[core]\n\thooksPath\n[remote "my.fork"]\n\turl = https://example.invalid/f.git\n[remote "push-only"]\n\tpushurl = https://example.invalid/p.git\n`)
    mkdirSync(join(repo, '.git', 'remotes'))
    writeFileSync(join(repo, '.git', 'remotes', 'legacy'), 'URL: https://example.invalid/l.git\n')
    mkdirSync(join(repo, '.git', 'branches'))
    writeFileSync(join(repo, '.git', 'branches', 'older'), 'https://example.invalid/o.git\n')
    const facts = await readGitFacts(repo, gitEnv())
    expect(facts).toMatchObject({ hooksPath: '', hooksActive: true })
    expect([...(facts.remotes ?? [])].sort()).toEqual(['legacy', 'my.fork', 'older', 'push-only'])
  })

  it('the config files: each origin, and each include target from HOME, from the folder of its file, or as given', async () => {
    const home = join(scratch, 'home')
    git(repo, 'config', '--add', 'include.path', '~/demo.cfg')
    git(repo, 'config', '--add', 'include.path', 'rel.cfg')
    git(repo, 'config', '--add', 'include.path', join(scratch, 'abs.cfg'))
    const facts = await readGitFacts(repo, { ...gitEnv(), HOME: home })
    expect(facts.configFiles.map(samePathForm).sort()).toEqual([join(repo, '.git', 'config'), join(home, 'demo.cfg'), join(repo, '.git', 'rel.cfg'), join(scratch, 'abs.cfg'), join(scratch, 'global-config')].map(samePathForm).sort())
  })

  it('a HEAD of a ref store that is no files (reftable names .invalid) gives main as the default branch', async () => {
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/.invalid\n')
    expect((await readGitFacts(repo, gitEnv())).defaultBranch).toBe('main')
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

  it('a Wave of a later Epic of the queue: the worktree of its own Epic\'s Ticket is a root, the first Epic\'s of the same number is not (worfy-autopilot-queue ticket 14)', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', join(scratch, 'wt-demo'))
    git(repo, 'worktree', 'add', '-q', '-b', 'other/01', join(scratch, 'wt-other'))
    const approval = await open()
    const remove = (folder: string) => ({ tool: 'Bash', input: { command: `rm -rf '${join(scratch, folder, 'build')}'` } })
    const at = (folder: string) => ({ cwd: join(scratch, folder), scratchpad: null, sessionId: 's', started: approval.environment })
    approval.setWave(['01'], 'other')
    expect(await approval.judge(remove('wt-other'), at('wt-other'))).toMatchObject({ outcome: 'allow', rule: 'files-inside-roots' })
    expect((await approval.judge(remove('wt-demo'), at('wt-demo'))).outcome).not.toBe('allow')
    // Without an Epic, the run's first again.
    approval.setWave(['01'])
    expect(await approval.judge(remove('wt-demo'), at('wt-demo'))).toMatchObject({ outcome: 'allow', rule: 'files-inside-roots' })
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
    // worfy-auto-approve ticket 14: a Vendor that may drop the run's git variables from the command's shell (Codex's
    // shell_environment_policy.include_only) leaves them out of `known`: git is judged as if the process had none.
    const judged = (command: string, known: readonly string[]) => approval.judge({ tool: 'Bash', input: { command } }, { cwd: wt(), scratchpad: null, sessionId: 's', started: approval.environment, known })
    expect(await judged('git log --oneline -1', ['HOME', 'USERPROFILE'])).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    expect(await judged('git log --oneline -1', ['HOME', 'GIT_CONFIG_PARAMETERS'])).toMatchObject({ outcome: 'allow', rule: 'git-in-wave-worktree' })
    expect(await judged('rm -rf build/x', ['HOME'])).toMatchObject({ outcome: 'allow' })
    writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\n')
    expect(approval.environment).not.toHaveProperty('GIT_NO_LAZY_FETCH')
    expect(await ask(approval, 'git log --oneline -1')).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    expect(await ask(approval, 'git log --oneline -1', { ...approval.environment, GIT_NO_LAZY_FETCH: '1' })).toMatchObject({ outcome: 'allow' })
    // GIT_NO_LAZY_FETCH counts only when the command surely gets it.
    const fetchless = (known: readonly string[]) => approval.judge({ tool: 'Bash', input: { command: 'git log --oneline -1' } }, { cwd: wt(), scratchpad: null, sessionId: 's', started: { ...approval.environment, GIT_NO_LAZY_FETCH: '1' }, known })
    expect(await fetchless(['HOME', 'GIT_CONFIG_PARAMETERS'])).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    expect(await fetchless(['HOME', 'GIT_CONFIG_PARAMETERS', 'GIT_NO_LAZY_FETCH'])).toMatchObject({ outcome: 'allow' })
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
  /** As `ask`, for a process that started with GIT_NO_LAZY_FETCH: the policy's own decision, not the park of the run's git environment. */
  const fetchless = (approval: Awaited<ReturnType<typeof open>>, command: string, cwd = wt()) =>
    approval.judge({ tool: 'Bash', input: { command } }, { cwd, scratchpad: null, sessionId: 's', started: { ...approval.environment, GIT_NO_LAZY_FETCH: '1' } })

  it.skipIf(!posix)('reads git in the checkout the command runs in: a core.hooksPath of the worktree\'s own config keeps git status from allow', async () => {
    const approval = await inWave()
    expect(await ask(approval, 'git status')).toMatchObject({ outcome: 'allow', rule: 'git-in-wave-worktree' })
    expect(await ask(approval, `git -C '${wt()}' status`, repo)).toMatchObject({ outcome: 'allow', rule: 'git-in-wave-worktree' })
    // A folder below the worktree is read on its own.
    mkdirSync(join(wt(), 'src'))
    expect(await ask(approval, 'cd src && git status')).toMatchObject({ outcome: 'allow', rule: 'files-inside-roots+git-in-wave-worktree' })
    git(repo, 'config', 'extensions.worktreeConfig', 'true')
    git(wt(), 'config', '--worktree', 'core.hooksPath', 'hooks')
    // The Project's own checkout sees no hook: only the worktree's config names one.
    expect((await readGitFacts(repo, gitEnv())).hooksPath).toBeNull()
    expect((await ask(approval, 'git status')).outcome).not.toBe('allow')
    // The checkout after git -C, from a shell that stands in the Project.
    expect((await ask(approval, `git -C '${wt()}' status`, repo)).outcome).not.toBe('allow')
    // The policy itself refuses it, also to a process that started with GIT_NO_LAZY_FETCH.
    expect(await fetchless(approval, 'git status')).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    expect(await fetchless(approval, `git -C '${wt()}' status`, repo)).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    expect(await fetchless(approval, 'cd src && git status')).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    // A write into the hooks folder of the worktree's config is refused as one into .git/hooks.
    expect(await ask(approval, `touch '${join(wt(), 'hooks', 'pre-commit')}'`)).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    await approval.close()
  })

  it('an includeIf "gitdir:" of the Project\'s config that names only the worktree counts there (on Windows too: worfy-auto-approve ticket 13)', async () => {
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
    expect(await fetchless(approval, 'git log --oneline -1')).toMatchObject({ outcome: 'allow' })
    expect(await fetchless(approval, 'git status')).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    await approval.close()
  })

  it.skipIf(!posix)('a git command in a folder that does not exist yet is judged by the facts of the checkout it lies in', async () => {
    const approval = await inWave()
    const inside = `mkdir -p '${join(wt(), 'n')}' && cd '${join(wt(), 'n')}' && git status`
    expect(await ask(approval, inside)).toMatchObject({ outcome: 'allow' })
    git(repo, 'config', 'core.hooksPath', '.husky/_')
    expect(await fetchless(approval, inside)).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
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

describe('openRunApproval: round 4 (review of PR #1460)', () => {
  const shell = (): Record<string, string> => ({ ...(process.env as Record<string, string>), HOME: homedir(), USERPROFILE: homedir() })
  const wt = (n = 1): string => join(scratch, n === 1 ? 'wt' : `wt${n}`)
  /**
   * The git calls of the Run, counted from git's own trace (GIT_TRACE2_EVENT: one `start` event per git process, its
   * arguments with it). On every platform: a script in front of git on PATH does not start on Windows.
   */
  const counted = (): { env: NodeJS.ProcessEnv; calls: () => string[] } => {
    const log = join(scratch, 'git-trace.jsonl')
    writeFileSync(log, '')
    const calls = (): string[] =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
        .filter((event) => event.event === 'start')
        .map((event) => (event.argv ?? []).slice(1).join(' '))
    return { env: { ...gitEnv(), GIT_TRACE2_EVENT: log }, calls }
  }
  const open = (env: NodeJS.ProcessEnv = gitEnv()) =>
    openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: env, sessions: { list: () => [] } })
  const inWave = async (env?: NodeJS.ProcessEnv, count = 1) => {
    for (let n = 1; n <= count; n++) git(repo, 'worktree', 'add', '-q', '-b', `demo/0${n}`, wt(n))
    const approval = await open(env)
    approval.setWave(Array.from({ length: count }, (_, n) => `0${n + 1}`))
    return approval
  }
  const at = (approval: Awaited<ReturnType<typeof open>>, cwd = wt()) => ({ cwd, scratchpad: null, sessionId: 's', started: approval.environment })
  const bash = (approval: Awaited<ReturnType<typeof open>>, command: string, cwd = wt()) => approval.judge({ tool: 'Bash', input: { command } }, at(approval, cwd))
  const write = (approval: Awaited<ReturnType<typeof open>>, path: string) => approval.judge({ tool: 'Write', input: { file_path: path, content: '[core]\n\thooksPath = h\n' } }, at(approval))

  it('a file git includes (include.path, includeIf.*.path), there or not yet, is written as git config: never approved (on Windows too: worfy-auto-approve ticket 13)', async () => {
    const approval = await inWave()
    const absolute = join(wt(), 'cfg')
    const relative = join(wt(), 'cfg-relative')
    const conditional = join(wt(), 'cfg-gitdir')
    const existing = join(wt(), 'cfg-existing')
    writeFileSync(existing, '[demo]\n\tx = 1\n')
    // Before any include: an ordinary file of the worktree.
    expect(await write(approval, absolute)).toMatchObject({ outcome: 'allow' })
    git(repo, 'config', '--add', 'include.path', absolute)
    // No checkout config of its own here: the Project's root names the file.
    expect(await write(approval, absolute)).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    // A relative path is read from the folder of the config file that names it (.git/).
    git(repo, 'config', '--add', 'include.path', '../../wt/cfg-relative')
    git(repo, 'config', 'includeIf.gitdir:**/worktrees/wt.path', conditional)
    git(repo, 'config', '--add', 'include.path', existing)
    for (const path of [absolute, relative, conditional, existing]) {
      expect(await write(approval, path), path).toMatchObject({ outcome: 'deny', rule: 'git-files' })
      expect(await bash(approval, `printf '[core]\\n\\thooksPath = h\\n' > '${path}'`), path).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    }
    // One command that writes the file and runs git; and the same as two requests.
    expect(await bash(approval, `printf '[core]\\n\\thooksPath = h\\n' > cfg && git status`)).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    expect(await bash(approval, 'cp a.txt cfg')).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    // On Windows `/dev/null` is no path the policy can place: the command is refused unjudged there.
    expect(await bash(approval, 'cp /dev/null cfg')).toMatchObject(process.platform === 'win32' ? { outcome: 'deny', rule: 'not-judged' } : { outcome: 'deny', rule: 'git-files' })
    expect(await bash(approval, 'rm -f cfg-existing')).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    // A file of the worktree git does not include stays an ordinary one.
    expect(await write(approval, join(wt(), 'other.txt'))).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it('a file the config of one worktree includes (config.worktree) is protected there too (on Windows too: worfy-auto-approve ticket 13)', async () => {
    const approval = await inWave()
    git(repo, 'config', 'extensions.worktreeConfig', 'true')
    const file = join(wt(), 'cfg-worktree')
    git(wt(), 'config', '--worktree', 'include.path', file)
    expect(await write(approval, file)).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    await approval.close()
  })

  it('reads git at most twice per checkout, and not at all for a request that neither writes nor runs git (on Windows too: worfy-auto-approve ticket 13)', async () => {
    const { env, calls } = counted()
    const approval = await inWave(env, 3)
    mkdirSync(join(wt(), 'build'))
    const per = async (request: () => Promise<Decision>): Promise<number> => {
      const before = calls().length
      await request()
      return calls().length - before
    }
    // The worktree list only.
    expect(await per(() => bash(approval, `cat '${join(wt(), 'a.txt')}'`))).toBe(1)
    // The list and the Project's root: its config and its git folders.
    expect(await per(() => bash(approval, 'rm -rf build/x'))).toBe(3)
    expect(await per(() => write(approval, join(wt(), 'build', 'y')))).toBe(3)
    expect(await per(() => bash(approval, 'git status'))).toBe(3)
    expect(await per(() => bash(approval, 'cd build && git status && git log --oneline -1'))).toBe(3)
    // git outside every checkout: nothing more is read, its facts are not known.
    expect(await per(() => bash(approval, 'git status', approval.runTemp))).toBe(3)
    // A config one worktree may see alone: for a write each worktree of the Wave is read too, twice;
    // for git the checkout it runs in, once however many folders of it the command names.
    git(repo, 'config', 'extensions.worktreeConfig', 'true')
    expect(await per(() => bash(approval, 'rm -rf build/x'))).toBe(1 + 2 + 3 * 2)
    expect(await per(() => bash(approval, 'git status && cd build && git status'))).toBe(1 + 2 + 2)
    expect(await per(() => bash(approval, 'git status', repo))).toBe(1 + 2)
    expect(await per(() => bash(approval, `cat '${join(wt(), 'a.txt')}'`))).toBe(1)
    await approval.close()
  })
})

describe('openRunApproval: round 5 (review of PR #1460): a worktree whose git folder is not the Project\'s', () => {
  const shell = (): Record<string, string> => ({ ...(process.env as Record<string, string>), HOME: homedir(), USERPROFILE: homedir() })
  const wt = (): string => join(scratch, 'wt')
  const inWave = async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', wt())
    const approval = await openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: gitEnv(), sessions: { list: () => [] } })
    approval.setWave(['01'])
    return approval
  }
  type Approval = Awaited<ReturnType<typeof inWave>>
  const ask = (approval: Approval, command: string) => approval.judge({ tool: 'Bash', input: { command } }, { cwd: wt(), scratchpad: null, sessionId: 's', started: approval.environment })
  /** As `ask`, for a process that started with GIT_NO_LAZY_FETCH: the policy's own decision, not the park of the run's git environment. */
  const fetchless = (approval: Approval, command: string) =>
    approval.judge({ tool: 'Bash', input: { command } }, { cwd: wt(), scratchpad: null, sessionId: 's', started: { ...approval.environment, GIT_NO_LAZY_FETCH: '1' } })
  /**
   * Writes over an existing file in place. Git for Windows hides a worktree's `.git` file (core.hideDotFiles), and
   * Windows refuses to create a hidden file anew (EPERM): truncating it and writing into it is allowed.
   */
  const rewrite = (path: string, text: string): void => {
    truncateSync(path, 0)
    writeFileSync(path, text, { flag: 'r+' })
  }
  /** A copy of the Project's git folder, which the worktree's `commondir` is then made to name. */
  const otherCommon = (): string => {
    const other = join(scratch, 'other-common')
    cpSync(join(repo, '.git'), other, { recursive: true })
    return other
  }

  it('commondir that names another git folder, whose config runs core.fsmonitor: git status and add get no allow (on Windows too: worfy-auto-approve ticket 13)', async () => {
    const approval = await inWave()
    expect(await ask(approval, 'git status')).toMatchObject({ outcome: 'allow', rule: 'git-in-wave-worktree' })
    const other = otherCommon()
    git(scratch, 'config', '-f', join(other, 'config'), 'core.fsmonitor', join(scratch, 'fsmonitor.sh'))
    writeFileSync(join(repo, '.git', 'worktrees', 'wt', 'commondir'), `${other}\n`)
    // Real git in the worktree now reads the other folder's config.
    expect(git(wt(), 'config', 'core.fsmonitor').trim()).toBe(join(scratch, 'fsmonitor.sh'))
    for (const command of ['git status', 'git add a.txt']) {
      expect((await ask(approval, command)).outcome, command).not.toBe('allow')
      expect(await fetchless(approval, command), command).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    }
    // A read of refs and objects is judged as in round 3: allowed for a process that started with GIT_NO_LAZY_FETCH only.
    expect(await ask(approval, 'git log --oneline -1')).toMatchObject({ outcome: 'park', rule: 'git-without-run-environment' })
    expect(await fetchless(approval, 'git log --oneline -1')).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it('commondir that names another git folder with a pre-commit hook: git commit gets no allow (on Windows too: worfy-auto-approve ticket 13)', async () => {
    const approval = await inWave()
    const other = otherCommon()
    writeFileSync(join(other, 'hooks', 'pre-commit'), '#!/bin/sh\ntrue\n', { mode: 0o755 })
    writeFileSync(join(repo, '.git', 'worktrees', 'wt', 'commondir'), `${other}\n`)
    expect((await ask(approval, 'git commit -m x')).outcome).not.toBe('allow')
    expect(await fetchless(approval, 'git commit -m x')).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    await approval.close()
  })

  it('a .git file that names a git folder out of the Project\'s, or a commondir that cannot be read: git gets no allow (on Windows too: worfy-auto-approve ticket 13)', async () => {
    const approval = await inWave()
    expect(await fetchless(approval, 'git status')).toMatchObject({ outcome: 'allow' })
    // The worktree's .git file names a copy of its git folder in another common folder, and that copy's commondir names it.
    const other = otherCommon()
    writeFileSync(join(other, 'worktrees', 'wt', 'commondir'), `${other}\n`)
    rewrite(join(wt(), '.git'), `gitdir: ${join(other, 'worktrees', 'wt')}\n`)
    expect((await fetchless(approval, 'git status')).outcome).not.toBe('allow')
    // Back to the Project's git folder, it is allowed again; without a readable commondir it is not.
    rewrite(join(wt(), '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt')}\n`)
    expect(await fetchless(approval, 'git status')).toMatchObject({ outcome: 'allow' })
    // A gitdir relative to the worktree, as git 2.48 writes it with worktree.useRelativePaths.
    rewrite(join(wt(), '.git'), 'gitdir: ../repo/.git/worktrees/wt\n')
    expect(await fetchless(approval, 'git status')).toMatchObject({ outcome: 'allow' })
    // A .git file without a gitdir line names no git folder.
    rewrite(join(wt(), '.git'), 'not a gitdir line\n')
    expect((await fetchless(approval, 'git status')).outcome).not.toBe('allow')
    rewrite(join(wt(), '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt')}\n`)
    // A commondir that names a folder that does not exist.
    writeFileSync(join(repo, '.git', 'worktrees', 'wt', 'commondir'), `${join(scratch, 'no-such-folder')}\n`)
    expect(await fetchless(approval, 'git status')).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    removeTestTree(join(repo, '.git', 'worktrees', 'wt', 'commondir'))
    expect(await fetchless(approval, 'git status')).toMatchObject({ outcome: 'park', rule: 'git-hooks' })
    await approval.close()
  })
})

/** Whether this git can make a repository whose refs are kept in reftable (git 2.45 and later). */
const reftable = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'worfy-aa13-reftable-'))
  try {
    execFileSync('git', ['init', '-q', '--ref-format=reftable', join(probe, 'r')], { stdio: 'ignore' })
    return true
  } catch {
    return false
  } finally {
    removeTestTree(probe)
  }
})()

describe('readGitFacts and openRunApproval: the leftovers of the review of ticket 04 (worfy-auto-approve ticket 13)', () => {
  const shell = (): Record<string, string> => ({ ...(process.env as Record<string, string>), HOME: homedir(), USERPROFILE: homedir() })
  const wt = (): string => join(scratch, 'wt')

  it.runIf(reftable)('a repository whose refs are in reftable: the default branch of origin/HEAD, else the checkout\'s branch, read from git', async () => {
    const store = join(scratch, 'reftable')
    git(scratch, 'init', '-q', '--ref-format=reftable', '-b', 'trunk', store)
    git(store, 'commit', '-q', '--allow-empty', '-m', 'demo')
    // The HEAD file of reftable names no branch.
    expect(readFileSync(join(store, '.git', 'HEAD'), 'utf8').trim()).toBe('ref: refs/heads/.invalid')
    expect((await readGitFacts(store, gitEnv())).defaultBranch).toBe('trunk')
    git(store, 'update-ref', 'refs/remotes/origin/dev', 'HEAD')
    git(store, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev')
    expect((await readGitFacts(store, gitEnv())).defaultBranch).toBe('dev')
    // A worktree of it reads its own HEAD, and the origin/HEAD of the repository.
    git(store, 'worktree', 'add', '-q', '-b', 'demo/01', join(scratch, 'reftable-wt'))
    expect((await readGitFacts(join(scratch, 'reftable-wt'), gitEnv())).defaultBranch).toBe('dev')
    git(store, 'symbolic-ref', '-d', 'refs/remotes/origin/HEAD')
    expect((await readGitFacts(join(scratch, 'reftable-wt'), gitEnv())).defaultBranch).toBe('demo/01')
  })

  it.runIf(reftable)('in a reftable repository git checkout of the default branch read from git is a hard deny', async () => {
    const store = join(scratch, 'reftable')
    git(scratch, 'init', '-q', '--ref-format=reftable', '-b', 'trunk', store)
    git(store, 'commit', '-q', '--allow-empty', '-m', 'demo')
    git(store, 'worktree', 'add', '-q', '-b', 'demo/01', join(store, 'wt'))
    const approval = await openRunApproval({ root: store, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: gitEnv(), sessions: { list: () => [] } })
    approval.setWave(['01'])
    expect(approval.facts.defaultBranch).toBe('trunk')
    const decision = await approval.judge({ tool: 'Bash', input: { command: 'git checkout trunk' } }, { cwd: join(store, 'wt'), scratchpad: null, sessionId: 's', started: { ...approval.environment, GIT_NO_LAZY_FETCH: '1' } })
    expect(decision).toMatchObject({ outcome: 'hard-deny', rule: 'hard:git-checkout-default-branch' })
    await approval.close()
  })

  it.runIf(reftable)('extensions.refStorage counts only from the common config: an include or config.worktree that says files keeps the default branch and its hard denies (round 2 of PR #1475)', async () => {
    const store = join(scratch, 'reftable')
    git(scratch, 'init', '-q', '--ref-format=reftable', '-b', 'trunk', store)
    git(store, 'commit', '-q', '--allow-empty', '-m', 'demo')
    git(store, 'update-ref', 'refs/remotes/origin/dev', 'HEAD')
    git(store, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev')
    git(store, 'worktree', 'add', '-q', '-b', 'demo/01', join(store, 'wt'))
    const approval = await openRunApproval({ root: store, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: gitEnv(), sessions: { list: () => [] } })
    approval.setWave(['01'])
    const at = { cwd: join(store, 'wt'), scratchpad: null, sessionId: 's', started: { ...approval.environment, GIT_NO_LAZY_FETCH: '1' } }
    const hard = async (): Promise<void> => {
      expect(await approval.judge({ tool: 'Bash', input: { command: 'git push origin HEAD:dev' } }, at)).toMatchObject({ outcome: 'hard-deny', rule: 'hard:git-push-default-branch' })
      expect(await approval.judge({ tool: 'Bash', input: { command: 'git checkout -b dev' } }, at)).toMatchObject({ outcome: 'hard-deny', rule: 'hard:git-checkout-default-branch' })
    }
    await hard()
    // An include file that says files: git still keeps the refs in reftable.
    const included = join(scratch, 'refstorage.cfg')
    writeFileSync(included, '[extensions]\n\trefStorage = files\n')
    git(store, 'config', '--add', 'include.path', included)
    expect(git(join(store, 'wt'), 'log', '--oneline', '-1')).not.toBe('')
    for (const folder of [store, join(store, 'wt')]) expect((await readGitFacts(folder, gitEnv())).defaultBranch, folder).toBe('dev')
    await hard()
    git(store, 'config', '--unset', 'include.path')
    // The config of the worktree alone.
    git(store, 'config', 'extensions.worktreeConfig', 'true')
    git(join(store, 'wt'), 'config', '--worktree', 'extensions.refStorage', 'files')
    expect((await readGitFacts(join(store, 'wt'), gitEnv())).defaultBranch).toBe('dev')
    await hard()
    await approval.close()
  })

  it('a relative GIT_CONFIG_GLOBAL is read by git from the folder it runs in: it is guarded in every checkout (round 2 of PR #1475)', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', wt())
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/02', join(scratch, 'wt2'))
    const approval = await openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: { ...gitEnv(), GIT_CONFIG_GLOBAL: 'relative-config' }, sessions: { list: () => [] } })
    approval.setWave(['01', '02'])
    const at = { cwd: wt(), scratchpad: null, sessionId: 's', started: approval.environment }
    for (const top of [wt(), join(scratch, 'wt2')]) {
      expect(await approval.judge({ tool: 'Write', input: { file_path: join(top, 'relative-config'), content: '[core]\n\thooksPath = h\n' } }, at), top).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    }
    expect(await approval.judge({ tool: 'Write', input: { file_path: join(wt(), 'other.txt'), content: 'x' } }, at)).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it('a valueless config entry that stops git rev-parse (core.excludesFile; core.hooksPath on Git for Windows 2.45): the git folders come from the files, every fact as before (issue #1481)', async () => {
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/demo.git')
    git(repo, 'branch', 'trunk')
    git(repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', wt())
    // The worktree's .git file names its git folder by a relative path (git worktree add --relative-paths), read from
    // the folder of that file. Written in place: Git for Windows hides the file, and Windows refuses a new hidden file.
    const dotGit = join(wt(), '.git')
    const named = /^gitdir: (.+)$/.exec(readFileSync(dotGit, 'utf8').trim())?.[1] ?? ''
    truncateSync(dotGit, 0)
    writeFileSync(dotGit, `gitdir: ${relative(wt(), named).replaceAll('\\', '/')}\n`, { flag: 'r+' })
    writeFileSync(join(repo, '.git', 'hooks', 'pre-push'), '#!/bin/sh\n')
    const before = { root: await readGitFacts(repo, gitEnv()), worktree: await readGitFacts(wt(), gitEnv()) }
    const config = join(repo, '.git', 'config')
    writeFileSync(config, `${readFileSync(config, 'utf8')}[core]\n\texcludesFile\n`)
    // git itself refuses the git folders now, and still lists the config.
    expect(() => git(repo, 'rev-parse', '--git-dir')).toThrow()
    mkdirSync(join(wt(), 'sub'))
    // A folder reached through a symbolic link: git lists the config by its real path.
    const link = join(scratch, 'link')
    if (process.platform !== 'win32') symlinkSync(wt(), link)
    for (const [folder, known] of [[repo, before.root], [wt(), before.worktree], [join(wt(), 'sub'), before.worktree], ...(process.platform === 'win32' ? [] : [[join(link, 'sub'), before.worktree] as const])] as const) {
      const facts = await readGitFacts(folder, gitEnv())
      expect({ ...facts, configFiles: facts.configFiles.map(samePathForm).sort(), commonDir: samePathForm(facts.commonDir ?? '') }, folder).toEqual({ ...known, configFiles: known.configFiles.map(samePathForm).sort(), commonDir: samePathForm(known.commonDir ?? '') })
    }
    expect(before.root).toMatchObject({ defaultBranch: 'trunk', remotes: ['origin'], hooksActive: true })
    // git worktree list stops on the same entry: with no list of checkouts the policy approves nothing, a hard deny of
    // the default branch included (it is refused, as no-checkouts).
    const approval = await openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: gitEnv(), sessions: { list: () => [] } })
    approval.setWave(['01'])
    const at = { cwd: wt(), scratchpad: null, sessionId: 's', started: { ...approval.environment, GIT_NO_LAZY_FETCH: '1' } }
    for (const command of ['git push origin HEAD:trunk', 'git checkout -b trunk', 'git status']) {
      expect(await approval.judge({ tool: 'Bash', input: { command } }, at), command).toMatchObject({ outcome: 'deny', rule: 'no-checkouts' })
    }
    expect(await approval.judge({ tool: 'Write', input: { file_path: join(repo, '.git', 'hooks', 'post-checkout'), content: 'x' } }, at)).toMatchObject({ outcome: 'deny', rule: 'no-checkouts' })
    await approval.close()
  })

  it('git facts that cannot be found when git rev-parse fails are unknown, never a folder without a repository: readGitFacts throws (issue #1481)', async () => {
    const config = join(repo, '.git', 'config')
    writeFileSync(config, `${readFileSync(config, 'utf8')}[core]\n\texcludesFile\n`)
    // A .git file that names a git folder whose config is not the one git listed.
    const odd = join(scratch, 'odd')
    mkdirSync(odd)
    writeFileSync(join(odd, '.git'), `gitdir: ${join(scratch, 'nowhere')}\n`)
    await expect(readGitFacts(odd, { ...gitEnv(), GIT_DIR: join(repo, '.git') })).rejects.toThrow(/git folder/)
    // A .git file that names no repository: git cannot read the config either.
    await expect(readGitFacts(odd, gitEnv())).rejects.toThrow(/could not read git's config/)
    // git stops above the folder (a ceiling), the files find the repository: git listed no config of it.
    mkdirSync(join(repo, 'sub'))
    await expect(readGitFacts(join(repo, 'sub'), { ...gitEnv(), GIT_CEILING_DIRECTORIES: repo })).rejects.toThrow(/did not list the config/)
    // The environment names the git folders: git reads them, the files above the folder do not tell them.
    await expect(readGitFacts(repo, { ...gitEnv(), GIT_DIR: join(repo, '.git') })).rejects.toThrow(/environment names the git folders/)
    // Above a ceiling: a .git file with no gitdir line, and a .git that cannot be read (a symbolic link to itself).
    mkdirSync(join(odd, 'sub'))
    writeFileSync(join(odd, '.git'), 'nothing\n')
    await expect(readGitFacts(join(odd, 'sub'), { ...gitEnv(), GIT_CEILING_DIRECTORIES: odd })).rejects.toThrow(/names no git folder/)
    if (process.platform !== 'win32') {
      rmSync(join(odd, '.git'))
      symlinkSync(join(odd, '.git'), join(odd, '.git'))
      await expect(readGitFacts(join(odd, 'sub'), { ...gitEnv(), GIT_CEILING_DIRECTORIES: odd })).rejects.toThrow(/cannot be read/)
    }
    // A folder with no .git up to the root stays a folder without a repository.
    const outside = mkdtempSync(join(tmpdir(), 'worfy-aa13-outside-'))
    try {
      expect(await readGitFacts(outside, gitEnv())).toMatchObject({ remotes: null, commonDir: null, rebaseUpdateRefs: null })
    } finally {
      removeTestTree(outside)
    }
  })

  it.runIf(reftable)('a reftable repository whose refs git cannot list (a valueless config entry): the default branch is unknown, never main (issue #1481)', async () => {
    const store = join(scratch, 'reftable')
    git(scratch, 'init', '-q', '--ref-format=reftable', '-b', 'trunk', store)
    git(store, 'commit', '-q', '--allow-empty', '-m', 'demo')
    const config = join(store, '.git', 'config')
    writeFileSync(config, `${readFileSync(config, 'utf8')}[core]\n\texcludesFile\n`)
    await expect(readGitFacts(store, gitEnv())).rejects.toThrow(/could not list the refs/)
  })

  it('the config files of the environment are git\'s even when empty: GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, XDG_CONFIG_HOME/git/config; /dev/null is none', async () => {
    const xdg = join(scratch, 'xdg')
    const env = { ...gitEnv(), GIT_CONFIG_SYSTEM: join(scratch, 'system-config'), XDG_CONFIG_HOME: xdg }
    const facts = await readGitFacts(repo, env)
    // The global config of gitEnv is an empty file: no entry of git names it.
    expect(facts.configFiles.map(samePathForm).sort()).toEqual([join(repo, '.git', 'config'), join(scratch, 'global-config'), join(scratch, 'system-config'), join(xdg, 'git', 'config')].map(samePathForm).sort())
    for (const device of process.platform === 'win32' ? ['/dev/null', 'NUL', 'nul'] : ['/dev/null']) {
      const none = await readGitFacts(repo, { ...gitEnv(), GIT_CONFIG_GLOBAL: device })
      expect(none.configFiles.map(samePathForm), device).toEqual([samePathForm(join(repo, '.git', 'config'))])
    }
  })

  it.runIf(process.platform === 'win32')('on Windows without HOME, `~/` of an include is read from USERPROFILE, as Git for Windows reads it', async () => {
    const profile = join(scratch, 'profile')
    mkdirSync(profile)
    git(repo, 'config', '--add', 'include.path', '~/demo.cfg')
    const env = { ...gitEnv(), USERPROFILE: profile }
    for (const name of ['HOME', 'HOMEDRIVE', 'HOMEPATH']) Reflect.deleteProperty(env, name)
    const facts = await readGitFacts(repo, env)
    expect(facts.configFiles.map(samePathForm)).toContain(samePathForm(join(profile, 'demo.cfg')))
  })

  it('a write into the empty config file GIT_CONFIG_GLOBAL names inside a root is refused as one into .git/config', async () => {
    git(repo, 'worktree', 'add', '-q', '-b', 'demo/01', wt())
    const global = join(wt(), 'global-config')
    writeFileSync(global, '')
    const approval = await openRunApproval({ root: repo, epic: 'demo', dataDir: join(scratch, 'data'), harnessHome: join(scratch, 'harness'), shellEnv: shell(), gitEnv: { ...gitEnv(), GIT_CONFIG_GLOBAL: global }, sessions: { list: () => [] } })
    approval.setWave(['01'])
    const at = { cwd: wt(), scratchpad: null, sessionId: 's', started: approval.environment }
    expect(await approval.judge({ tool: 'Write', input: { file_path: global, content: '[core]\n\thooksPath = h\n' } }, at)).toMatchObject({ outcome: 'deny', rule: 'git-files' })
    expect(await approval.judge({ tool: 'Write', input: { file_path: join(wt(), 'other.txt'), content: 'x' } }, at)).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it('the home folder of `~/` in an include: HOME, else on Windows the ones Git for Windows takes, HOMEDRIVE+HOMEPATH and USERPROFILE', () => {
    expect(includeHomes({ HOME: '/home/demo', USERPROFILE: '/other' }, 'linux')).toEqual(['/home/demo'])
    expect(includeHomes({ USERPROFILE: '/other' }, 'linux')).toEqual([])
    expect(includeHomes({ HOME: 'C:\\Users\\Demo' }, 'win32')).toEqual(['C:\\Users\\Demo'])
    expect(includeHomes({ HOMEDRIVE: 'H:', HOMEPATH: '\\Demo', USERPROFILE: 'C:\\Users\\Demo' }, 'win32')).toEqual(['H:\\Demo', 'C:\\Users\\Demo'])
    expect(includeHomes({ USERPROFILE: 'C:\\Users\\Demo' }, 'win32')).toEqual(['C:\\Users\\Demo'])
    expect(includeHomes({ HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\Demo', USERPROFILE: 'C:\\Users\\Demo' }, 'win32')).toEqual(['C:\\Users\\Demo'])
    expect(includeHomes({ HOME: '' }, 'win32')).toEqual([''])
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

  it('keeps every form of round 3 (round 5 of PR #1460): each input of the round 2 and 3 tests and the review\'s other forms give the output of 7af4d4a2b', () => {
    // The output of each input as the Journal of 7af4d4a2b gave it.
    const cases: [string, string][] = [
      ["TOKEN=abc run", "TOKEN=*** run"],
      ["PASSWORD=hunter2 run", "PASSWORD=*** run"],
      ["GITHUB_PAT=abc AUTH=xyz DB_PASS=p run", "GITHUB_PAT=*** AUTH=*** DB_PASS=*** run"],
      ["TOKEN= run", "TOKEN=*** run"],
      ["curl -H \"Authorization: Bearer abc.def.ghi\" https://x", "curl -H \"Authorization: ***\" https://x"],
      ["curl -H 'authorization: token abc123' x", "curl -H 'authorization: ***' x"],
      ["curl -H \"X: Bearer abcdefghijkl\" x", "curl -H \"X: Bearer ***\" x"],
      ["git clone https://user:p4ss@example.invalid/r.git", "git clone https://user:***@example.invalid/r.git"],
      ["tool --token abc --password xyz --password=q --api-key k --client-secret s", "tool --token *** --password *** --password=*** --api-key *** --client-secret ***"],
      ["tool --secret-key k --token-file f", "tool --secret-key *** --token-file ***"],
      ["curl -u demo:secret x", "curl -u demo:*** x"],
      ["mysql -u root -psecret db", "mysql -u root -p*** db"],
      ["echo ghp_abcdefghijklmnop1234 github_pat_abcdefghijklmnop_1234 sk-abcdefghijklmnop1234 xoxb-1234-abcd AKIAABCDEFGHIJKLMNOP", "echo *** *** *** *** ***"],
      ["curl -d '{\"token\":\"abc\",\"user\":\"demo\"}' x", "curl -d '{\"token\":\"***\",\"user\":\"demo\"}' x"],
      ["curl -d '{\"password\": \"a b c\", \"secret\":\"s\", \"api_key\":\"k\"}' x", "curl -d '{\"password\": \"***\", \"secret\":\"***\", \"api_key\":\"***\"}' x"],
      ["curl -d \"{\\\"token\\\":\\\"abc\\\"}\" x", "curl -d \"{\\\"token\\\":\\\"***\\\"}\" x"],
      ["curl -d '{\"x-auth\":\"v\"}' x", "curl -d '{\"x-auth\":\"***\"}' x"],
      ["printf 'machine x login demo password hunter2' > n", "printf 'machine x login demo password ***' > n"],
      ["curl -H \"X-Api-Key: abc def\" x", "curl -H \"X-Api-Key: ***\" x"],
      ["curl -H 'Cookie: a=b; c=d' x", "curl -H 'Cookie: ***' x"],
      ["curl -ubob:pass x", "curl -ubob:*** x"],
      ["curl -u \"bob:a b\" x", "curl -u \"bob:***\" x"],
      ["curl --user=bob:pass x", "curl --user=bob:*** x"],
      ["docker login -u demo -p s3cret registry.invalid", "docker login -u demo -p *** registry.invalid"],
      ["sshpass -p s3cret ssh host", "sshpass -p *** ssh host"],
      ["tool --key=abc --key def", "tool --key=*** --key ***"],
      ["PATH=/usr/bin make", "PATH=/usr/bin make"],
      ["AUTHOR=demo x", "AUTHOR=demo x"],
      ["mkdir -p build", "mkdir -p build"],
      ["git log -p", "git log -p"],
      ["NAME=demo x", "NAME=demo x"],
      ["curl -d '{\"user\":\"demo\",\"count\":\"3\"}' x", "curl -d '{\"user\":\"demo\",\"count\":\"3\"}' x"],
      ["docker run -p 8080:80 image", "docker run -p 8080:80 image"],
      ["tool --keyboard us", "tool --keyboard us"],
      ["curl -H 'Accept: text/plain' x", "curl -H 'Accept: text/plain' x"],
      ["gh api -H 'X-Api-Key: s3cr3tvalue' /x", "gh api -H 'X-Api-Key: ***' /x"],
      ["http POST https://x 'X-Api-Key:s3cr3tvalue'", "http POST https://x 'X-Api-Key:***'"],
      ["xh https://x 'X-Api-Key:s3cr3tvalue'", "xh https://x 'X-Api-Key:***'"],
      ["git -c http.extraHeader='X-Api-Key: s3cr3tvalue' fetch", "git -c http.extraHeader='X-Api-Key: ***' fetch"],
      ["aria2c --header='X-Api-Key: s3cr3tvalue' https://x", "aria2c --header='X-Api-Key: ***' https://x"],
      ["wget2 --header='X-Api-Key: s3cr3tvalue' https://x", "wget2 --header='X-Api-Key: ***' https://x"],
      ["curlie -H 'X-Api-Key: s3cr3tvalue' https://x", "curlie -H 'X-Api-Key: ***' https://x"],
      ["node -e \"fetch('https://x',{headers:{'Cookie: sid=s3cr3tvalue'}})\"", "node -e \"fetch('https://x',{headers:{'Cookie: ***'}})\""],
      ["lftp -u bob:s3cr3tvalue ftp://x", "lftp -u bob:*** ftp://x"],
      ["rsync -u bob:s3cr3tvalue x", "rsync -u bob:*** x"],
      ["mongo -u bob:s3cr3tvalue", "mongo -u bob:***"],
      ["cat > n <<EOF\nmachine x\nlogin bob\npassword s3cr3tvalue\nEOF", "cat > n <<EOF\nmachine x\nlogin bob\npassword ***\nEOF"],
      ["echo password s3cr3tvalue | sudo -S true", "echo password *** | sudo -S true"],
      ["expect -c 'send \"password s3cr3tvalue\"'", "expect -c 'send \"password ***\"'"],
      ["age --key s3cr3tvalue", "age --key ***"],
      ["tool --key s3cr3tvalue", "tool --key ***"],
      ["tool --key sk_live_abcdef", "tool --key ***"],
      ["tool --key=abcdef123", "tool --key=***"],
    ]
    for (const [command, kept] of cases) expect(journalCommand(command, home), command).toBe(kept)
  })

  it('keeps the safe commands the forms of round 3 hid (worfy-auto-approve ticket 13): an exception list, each for one program and one form', () => {
    for (const command of [
      'sort --key=2 data.txt',
      'sort -t, --key 2,3n data.csv',
      'ls -l | sort --key=5n',
      'git commit -m "auth: refresh the session on start"',
      "git commit -m 'session: keep the last one'",
      'git commit -am "keyboard: add the shortcut"',
      'git -C repo commit --message="auth: x"',
      'grep -rn password src/',
      'git grep -n passwd -- src',
      'cd src && rg -l password .',
      'docker run -u 1000:1000 image',
      'podman run --rm --user=1000:1000 image ls',
      'rg "apiKey: string"',
      'grep -H "token: none" src/a.ts',
      "rg -n 'session: string | null' src",
      'LC_ALL=C sort --key=2 f',
      'env LC_ALL=C sort --key=2 f',
      'find . -name "*.ts" | xargs grep -l password',
      'sudo docker run -u 0:0 image',
      'docker run --rm -it -u 1000:1000 image sh',
      'echo $(rg -l password src)',
      "printf $'a\\'b' ; sort --key=2 f",
    ]) expect(journalCommand(command, home), command).toBe(command)
  })

  it('the exception list of ticket 13 keeps every secret it does not name: another program, a value of another shape, another segment', () => {
    const cases: [string, string][] = [
      // sort: only a key definition of sort is a field number.
      ['sort --key=s3cr3tvalue x', 'sort --key=*** x'],
      ['tool --key=2', 'tool --key=***'],
      ['echo sort | tool --key=2', 'echo sort | tool --key=***'],
      ['sort x; tool --key=2', 'sort x; tool --key=***'],
      // A commit message: only the message of git commit; a header elsewhere in the command stays hidden.
      ['git commit -m "auth: x" && curl -H "X-Api-Key: s3cr3t" y', 'git commit -m "auth: x" && curl -H "X-Api-Key: ***" y'],
      ['git log -n 1 "auth: x"', 'git log -n 1 "auth: ***"'],
      ['git commit -q; tool -m "token: s3cr3t"', 'git commit -q; tool -m "token: ***"'],
      // A secret before the kept text stays hidden.
      ['curl -H "X-Api-Key: s3cr3t" x && git commit -m "auth: x"', 'curl -H "X-Api-Key: ***" x && git commit -m "auth: x"'],
      ['echo git commit -m "auth: x" | tool -H "X-Api-Key: s3cr3t"', 'echo git commit -m "auth: ***" | tool -H "X-Api-Key: ***"'],
      // A token in a commit message is still hidden by its own form.
      ['git commit -m "auth: ghp_abcdefghijklmnop1234"', 'git commit -m "auth: ***"'],
      // Search tools: a password word inside a quoted pattern, a value with a digit, another segment.
      ['grep -r "password hunter2" .', 'grep -r "password ***" .'],
      ['grep -r "x password hunter2" .', 'grep -r "x password ***" .'],
      ['rg "X-Api-Key: s3cr3tvalue"', 'rg "X-Api-Key: ***"'],
      ['grep -c x f; echo password s3cr3tvalue', 'grep -c x f; echo password ***'],
      ['grep x f | curl -H "X-Api-Key: s3cr3tvalue" y', 'grep x f | curl -H "X-Api-Key: ***" y'],
      ['echo grep password s3cr3tvalue', 'echo grep password ***'],
      // docker: only a numeric user and group.
      ['docker run -u bob:s3cr3t image', 'docker run -u bob:*** image'],
      ['docker run image curl -u bob:s3cr3t x', 'docker run image curl -u bob:*** x'],
      ['curl -u 1000:1000 x', 'curl -u 1000:*** x'],
      // Round 2 of PR #1475: a program that starts inside a quote or $(…) of another one, and a later -u after the image.
      ['curl -d "x;rg" -H "X-Api-Key: LettersOnlySecret" https://api', 'curl -d "x;rg" -H "X-Api-Key: ***" https://api'],
      ['rg x $(curl -s -H "X-Api-Key: LettersOnlySecret" u)', 'rg x $(curl -s -H "X-Api-Key: ***" u)'],
      ['git commit -q $(tool -m "token: s3cr3t9")', 'git commit -q $(tool -m "token: ***")'],
      ['curl -d "(docker run" -u 1000:424242 https://x', 'curl -d "(docker run" -u 1000:*** https://x'],
      ["curl -d 'a; rg \"apiKey: Letters\"' x", "curl -d 'a; rg \"apiKey: ***\"' x"],
      ['rg x `curl -H "X-Api-Key: LettersOnlySecret" u`', 'rg x `curl -H "X-Api-Key: ***" u`'],
      ['docker run --rm curlimages/curl -u 12345:987654 https://x', 'docker run --rm curlimages/curl -u 12345:*** https://x'],
      // An ANSI-C quote $'…' holds `\'`: the `;` inside it starts nothing (round 2 of PR #1475, verification).
      ["curl -d $'\\';docker run -u 1000:424242 ' https://x", "curl -d $'\\';docker run -u 1000:*** ' https://x"],
      // A token after `_` in a word.
      ['touch wt/key_ghp_abcdefghijklmnop1234', 'touch wt/key_***'],
      ['echo ghp_abcdefghijklmnop1234_x', 'echo ***_x'],
    ]
    for (const [command, kept] of cases) expect(journalCommand(command, home), command).toBe(kept)
  })

  it('the home folder of Windows in every form', () => {
    expect(journalCommand('rm -rf C:\\Users\\Demo\\x /c/Users/Demo/y', 'C:\\Users\\Demo')).toBe('rm -rf ~\\x ~/y')
  })})

describe('journalTarget: a target as the Journal keeps it (worfy-auto-approve ticket 13, item 6)', () => {
  const home = '/Users/demo'
  it('hides a token in a path as journalCommand does, and writes the home folder as ~', () => {
    expect(journalTarget('/Users/demo/wt/ghp_abcdefghijklmnop1234', home)).toBe('~/wt/***')
    expect(journalTarget('/tmp/github_pat_abcdefghijklmnop_1234/x', home)).toBe('/tmp/***/x')
    expect(journalTarget('/Users/demo/wt/key_ghp_abcdefghijklmnop1234', home)).toBe('~/wt/key_***')
    expect(journalTarget('/tmp/x/GH_TOKEN=s3cr3tvalue', home)).toBe('/tmp/x/GH_TOKEN=***')
    expect(journalTarget('C:\\Users\\Demo\\wt\\sk-abcdefghijklmnop1234.txt', 'C:\\Users\\Demo')).toBe('~\\wt\\***.txt')
    // A path without a secret stays as it is, and is cut at COMMAND_MAX.
    expect(journalTarget('/Users/demo/wt/build/out.js', home)).toBe('~/wt/build/out.js')
    expect(journalTarget(`/tmp/${'a'.repeat(250)}`, home)).toHaveLength(COMMAND_MAX)
    expect(journalTarget(`/tmp/${'a'.repeat(190)}/ghp_abcdefghijklmnop1234`, home)).not.toContain('ghp_')
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
