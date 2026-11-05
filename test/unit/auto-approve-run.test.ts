// What a Run gives the approval policy (worfy-auto-approve ticket 04): the git facts read when it starts
// (hooksActive, hooksPath, rebase.updateRefs, remotes, the default branch), the git environment of its
// Session, the worktrees of its Wave, and the Journal's cleaning of a command.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HINTS, type Decision } from '../../src/main/agent/auto-approve/policy'
import { configRunsProgram, GIT_CONFIG_PARAMETERS, gitEnvironment, hooksActiveOf, openRunApproval, PARK_PENDING_HINT, readCheckouts, readGitFacts } from '../../src/main/agent/auto-approve/run-approval'
import type { PermissionRequestOptions } from '../../src/main/agent/session/types'
import { sessionOptions } from '../../src/main/vendors/claude/options'
import { ToolUseFolders, UNATTENDED_DENIED_MESSAGE, unattendedCanUseTool, unattendedDeniedMessage } from '../../src/main/vendors/claude/session'
import type { SessionApproval } from '../../src/main/vendors/session'
import { COMMAND_MAX, journalCommand } from '../../src/shared/autopilot/journal'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'
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
    const at = { cwd: join(scratch, 'wt'), scratchpad: null, sessionId: 's' }
    expect((await approval.judge(request, at)).outcome).not.toBe('allow')
    approval.setWave(['01'])
    expect(await approval.judge(request, at)).toMatchObject({ outcome: 'allow', rule: 'files-inside-roots' })
    await approval.close()
  })

  it('the Run\'s TMPDIR folder exists from the start, is a root, and close() removes it', async () => {
    const approval = await open()
    expect(approval.runTemp).toBe(join(scratch, 'data', 'autopilot-tmp', approval.run))
    expect(approval.environment).toMatchObject({ TMPDIR: approval.runTemp })
    const decision = await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(approval.runTemp, 'x')}'` } }, { cwd: repo, scratchpad: null, sessionId: 's' })
    expect(decision).toMatchObject({ outcome: 'allow' })
    await approval.close()
    const { existsSync } = await import('node:fs')
    expect(existsSync(approval.runTemp)).toBe(false)
  })

  it('the scratchpad Claude Code names for the request is a root', async () => {
    const pad = join(scratch, 'pad')
    mkdirSync(pad)
    const approval = await open()
    const decision = await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(pad, 'x')}'` } }, { cwd: repo, scratchpad: pad, sessionId: 's' })
    expect(decision).toMatchObject({ outcome: 'allow' })
    await approval.close()
  })

  it('a Bash request whose shell folder is not known is not judged against another folder: deny with a hint', async () => {
    const approval = await open()
    expect(await approval.judge({ tool: 'Bash', input: { command: 'rm -rf build' } }, { cwd: null, scratchpad: null, sessionId: 's' })).toEqual({ outcome: 'deny', rule: 'no-cwd', hint: HINTS.notJudged, targets: [] })
    await approval.close()
  })

  it('a worktree list that cannot be read approves nothing (it is never passed empty)', async () => {
    const approval = await open()
    approval.setWave(['01'])
    removeTestTree(join(repo, '.git'))
    expect(await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(approval.runTemp, 'x')}'` } }, { cwd: repo, scratchpad: null, sessionId: 's' })).toEqual({ outcome: 'deny', rule: 'no-checkouts', hint: HINTS.notJudged, targets: [] })
    await approval.close()
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

  it('On answers by the decision: allow with the input unchanged, deny with the rule\'s hint after the reason, park with PARK_PENDING_HINT', async () => {
    const input = { command: ' rm -rf ~/x ', description: 'd' }
    const allow = driver(() => 'on', { outcome: 'allow', rule: 'files-inside-roots', hint: null, targets: [] })
    expect(await allow.ask(input)).toEqual({ behavior: 'allow', updatedInput: input })
    expect(allow.decided).toMatchObject([{ mode: 'on', outcome: 'allow', command: ' rm -rf ~/x ' }])
    expect(await driver(() => 'on', deny('not-judged', 'the hint')).ask(input)).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\nthe hint` })
    expect(await driver(() => 'on', deny('not-judged', 'the hint')).ask(input, { decisionReason: undefined })).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nthe hint` })
    expect(await driver(() => 'on', { outcome: 'hard-deny', rule: 'hard:ssh', hint: 'never', targets: [] }).ask(input)).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\nnever` })
    const park = driver(() => 'on', { outcome: 'park', rule: 'outside-roots', hint: null, targets: [] })
    expect(await park.ask(input)).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\n${PARK_PENDING_HINT}` })
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
    await approval.judge({ tool: 'Bash', input: { command: 'git log --oneline -1' } }, { cwd: join(scratch, 'wt'), scratchpad: null, sessionId: 's' })
    await approval.judge({ tool: 'Bash', input: { command: `rm -rf '${join(scratch, 'wt', 'x')}'` } }, { cwd: join(scratch, 'wt'), scratchpad: null, sessionId: 's' })
    await approval.close()
    expect(snapshot()).toEqual(before)
  })
})
