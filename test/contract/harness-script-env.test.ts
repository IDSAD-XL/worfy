// The Harness scripts get the environment they are handed, not worfy's own (worfy-harness ticket 37).
//
// worfy started from Finder has PATH=/usr/bin:/bin:/usr/sbin:/sbin, and node is not on it. Here the
// test process itself has such a PATH: a folder of links to the utilities the scripts need, without
// node. The environment handed to the readers has node. The scripts are the real `epic-status`,
// `ticket` and `profile` of harness/bin, installed as the plugin in a temporary Claude home, and the
// Project is Silent: its Tickets are in the Workflow folder, outside the repository. A reader that
// ran a script with `process.env` would find no node: `epic-status` then refuses with exit code 3
// (before slice 2 of the ticket it read `<repository>/.scratch` and answered with no Epics), and
// `profile` exits with 127, which the layout reads as a failed call.
//
// Nothing here reads or writes the real ~/.claude: HOME, the Claude home and the Harness home are
// in a temporary folder.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { harnessScriptEnv, type HarnessScriptEnv, type HarnessScriptEnvSource } from '../../src/main/harness/script-env'
import { harnessWorkspaceOf } from '../../src/main/projects/store'
import { LayoutCache, readProjectLayout } from '../../src/main/workflow/folder'
import { epicStatusRunner, readCheckout, readWorkflow } from '../../src/main/workflow/reader'
import { WorkflowHub, WorkflowWatcher } from '../../src/main/workflow/watch'
import type { WorkflowModel } from '../../src/shared/workflow/types'
import { removeTestTree } from '../remove'

const HARNESS = join(__dirname, '..', '..', 'harness')

/** What the scripts call besides node (harness/hooks/tests/gate-verdict.test.sh builds its PATH the same way). */
const TOOLS = ['bash', 'sh', 'env', 'git', 'awk', 'xargs', 'realpath', 'dirname', 'basename', 'sed', 'tr', 'cat', 'grep', 'sort', 'find', 'head', 'tail', 'cut', 'wc', 'ls', 'date', 'mktemp', 'rm', 'mkdir', 'uniq']

/** The absolute path of `name` on `path`, or null: `command -v` of a POSIX shell, as the scripts ask. */
function commandPath(name: string, path: string): string | null {
  const found = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { env: { PATH: path }, encoding: 'utf8' })
  const answer = found.stdout.trim()
  return found.status === 0 && isAbsolute(answer) ? answer : null
}

/** Every file under `dir` with its size and modification time; links are not followed. */
function listing(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const stats = statSync(path)
    out[relative(dir, path)] = `${stats.size}:${stats.mtimeMs}`
  }
  return out
}

const SAVED = ['PATH', 'HOME', 'SHELL', 'WORFY_CLAUDE_HOME', 'WORFY_HARNESS_HOME'] as const

let scratch: string
let saved: Record<string, string | undefined>
/** The folder of links without node: the PATH of this process while the tests run. */
let tools: string
let claudeHome: string
let harnessHome: string
/** The repository of the Silent Project; no workflow file is in it. */
let repo: string
/** The Workflow folder of the Silent Project. */
let folder: string
/** The folder above the two repositories of the other Project. */
let workspace: string
/** The environment with node, as the login shell would give it. */
let withNode: HarnessScriptEnv
/** The folder whose only entry is node. */
let nodeBin: string
let home: string
const source: HarnessScriptEnvSource = () => Promise.resolve(withNode)

// The scripts are bash and POSIX paths; Windows gets them with worfy-windows ticket 05.
describe.skipIf(process.platform === 'win32')('Harness scripts run with the environment handed to the reader', () => {
  beforeAll(() => {
    const ownPath = process.env.PATH ?? ''
    const node = commandPath('node', ownPath)
    if (!node) throw new Error('node is not on the PATH of the test run: the test cannot build the environment with node')
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-script-env-')))
    tools = join(scratch, 'tools')
    nodeBin = join(scratch, 'node-bin')
    home = join(scratch, 'home')
    claudeHome = join(scratch, 'claude-home')
    harnessHome = join(claudeHome, 'worfy-harness')
    repo = join(scratch, 'silent-app')
    folder = join(scratch, 'workflow-folder')
    workspace = join(scratch, 'several')
    for (const dir of [tools, nodeBin, home, join(harnessHome, 'gate'), join(harnessHome, 'projects', 'sp'), join(harnessHome, 'projects', 'multi')]) mkdirSync(dir, { recursive: true })

    for (const name of TOOLS) {
      const path = commandPath(name, ownPath)
      if (path) symlinkSync(path, join(tools, name))
    }
    symlinkSync(node, join(nodeBin, 'node'))
    // The plugin as First run installs it: <Harness home>/plugin, with the manifest and bin/.
    symlinkSync(HARNESS, join(harnessHome, 'plugin'))

    const git = (cwd: string, ...args: string[]): void => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: { ...env, HOME: home }, encoding: 'utf8' })
    }
    const makeRepo = (path: string): void => {
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'README.md'), 'text\n')
      git(path, 'init', '-q')
      git(path, 'add', '.')
      git(path, 'commit', '-q', '-m', 'init')
    }
    makeRepo(repo)
    makeRepo(join(workspace, 'api'))
    makeRepo(join(workspace, 'web'))
    const issues = join(folder, '.scratch', 'demo', 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(folder, '.scratch', 'demo', 'spec.md'), '# Epic of the Silent Project\n\ntext\n')
    writeFileSync(join(issues, '01-first.md'), '# 01 — First\n\nType: task\nStatus: open\nBlocked by: —\n\n## Где в коде\n\n- `src/a.ts`\n')
    git(folder, 'init', '-q')
    git(folder, 'add', '.')
    git(folder, 'commit', '-q', '-m', 'epic')

    const entry = (key: string, match: string, profile: string): unknown => ({ key, match, profile, pm: 'npm', root: {}, workspace: {} })
    writeFileSync(
      join(harnessHome, 'gate', 'config.json'),
      JSON.stringify({ repos: [entry('sp', repo, 'sp'), entry('api', join(workspace, 'api'), 'multi'), entry('web', join(workspace, 'web'), 'multi')] }),
    )
    writeFileSync(
      join(harnessHome, 'projects', 'sp', 'profile.json'),
      JSON.stringify({ schema: 2, name: 'sp', mode: 'silent', attribution: 'off', workflow: { folder }, tickets: { root: '.scratch/' } }),
    )
    writeFileSync(join(harnessHome, 'projects', 'multi', 'profile.json'), JSON.stringify({ schema: 2, name: 'multi', mode: 'full', attribution: 'on', tickets: { root: '.scratch/' } }))

    withNode = { PATH: `${nodeBin}:${tools}`, HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'C.UTF-8' }

    saved = Object.fromEntries(SAVED.map((key) => [key, process.env[key]]))
    // worfy's own environment, as from Finder: no node on PATH. HOME is the temporary one, so a
    // script that did get this environment could still not read the real ~/.claude.
    process.env.PATH = tools
    process.env.HOME = home
    // harnessWorkspaceOf reads the app's Claude home; the Harness home is then inside it.
    process.env.WORFY_CLAUDE_HOME = claudeHome
    delete process.env.WORFY_HARNESS_HOME
  })

  afterAll(() => {
    for (const key of SAVED) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    removeTestTree(scratch)
  })

  /** The Epic and the Ticket of the Silent Project, with what worfy adds from the Tickets root. */
  const expectSilentEpic = (model: Pick<WorkflowModel, 'epics' | 'tickets' | 'error'>): void => {
    expect(model.error).toBeNull()
    expect(model.epics).toEqual([expect.objectContaining({ epic: 'demo', title: 'Epic of the Silent Project' })])
    expect(model.tickets).toEqual([expect.objectContaining({ epic: 'demo', num: 1, state: 'open', files: ['src/a.ts'], filesListed: true })])
  }

  it('the PATH of this process has no node, and the environment handed to the readers has', () => {
    // On Linux node may lie in a system folder; the PATH here is a folder of links, so it does not.
    expect(commandPath('node', process.env.PATH ?? '')).toBeNull()
    expect(commandPath('bash', process.env.PATH ?? '')).not.toBeNull()
    expect(commandPath('node', withNode.PATH ?? '')).not.toBeNull()
    // Without node `epic-status` refuses with exit code 3 and names node (slice 2 of the ticket);
    // before, it answered with no Epics and exit code 0, which is what worfy showed from Finder.
    const bare = spawnSync(join(harnessHome, 'plugin', 'bin', 'epic-status'), ['--json'], { cwd: repo, env: { ...withNode, PATH: tools, HARNESS_HOME: harnessHome }, encoding: 'utf8' })
    expect({ status: bare.status, stdout: bare.stdout }).toEqual({ status: 3, stdout: '' })
    expect(bare.stderr).toMatch(/node is not on PATH/)
  })

  it('readWorkflow: the model has the Epic and the Ticket of the Silent Project', async () => {
    const { model } = await readWorkflow({ root: repo, claudeHome, env: source })
    expectSilentEpic(model)
    expect(model.branchErrors).toEqual([])
  })

  it('epicStatusRunner: epic-status finds the Tickets root of the Silent Project', async () => {
    const checkout = await readCheckout(repo, epicStatusRunner(claudeHome, source), join(folder, '.scratch'))
    expectSilentEpic(checkout)
  })

  it('readProjectLayout: the layout is silent and the Tickets root is in the Workflow folder', async () => {
    const reasons: string[] = []
    const layout = await readProjectLayout({ root: repo, claudeHome, env: withNode, log: (message) => reasons.push(message) })
    expect(layout).toMatchObject({ root: repo, mode: 'silent', workflowFolder: folder, ticketsRoot: join(folder, '.scratch'), reason: null })
    expect(layout.repos).toEqual([{ name: 'silent-app', path: repo }])
    expect(reasons).toEqual([])
  })

  it('the layout cache reads the layout with the environment of its source', async () => {
    const cache = new LayoutCache({ claudeHome: () => claudeHome, env: source })
    expect(await cache.get(repo)).toMatchObject({ mode: 'silent', ticketsRoot: join(folder, '.scratch'), reason: null })
  })

  it('the watcher and the hub read the Silent Project with the environment of their source', async () => {
    const watcher = await WorkflowWatcher.start({ root: repo, claudeHome, env: source, onChange: () => undefined })
    try {
      expectSilentEpic(watcher.current)
    } finally {
      await watcher.close()
    }
    const hub = new WorkflowHub({ claudeHome, env: source })
    try {
      expectSilentEpic(await hub.open(repo, { id: 1, send: () => undefined }))
    } finally {
      await hub.closeAll()
    }
  })

  it('harnessWorkspaceOf: the folder above the repositories of one Project is found', async () => {
    const workspaceOf = harnessWorkspaceOf(source)
    expect(await workspaceOf(workspace)).toBe(workspace)
    // A repository of a Project is not a folder above several, and a folder of no Project is none.
    expect(await workspaceOf(repo)).toBeNull()
    expect(await workspaceOf(scratch)).toBeNull()
  })

  it('nothing is written into the repository, the Workflow folder or the Harness home', async () => {
    const before = { repo: listing(repo), folder: listing(folder), harness: listing(harnessHome) }
    await readWorkflow({ root: repo, claudeHome, env: source })
    await harnessWorkspaceOf(source)(workspace)
    expect({ repo: listing(repo), folder: listing(folder), harness: listing(harnessHome) }).toEqual(before)
  })

  // Last in this file: it adds a Ticket to the Workflow folder, and it leaves the app's source
  // holding the environment it captured.
  it("the app's own source: node added to the login shell's .profile after the start shows the Epics without a restart, and a Ticket written after that shows too", async () => {
    const until = async (done: () => boolean, what: string, ms = 20_000): Promise<void> => {
      const end = Date.now() + ms
      while (!done()) {
        if (Date.now() > end) throw new Error(`not within ${ms} ms: ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    const profile = join(home, '.profile')
    // The login shell of the app (`$SHELL -ilc`, src/main/agent/env.ts) reads this file; the PATH it
    // sets is the whole PATH, so nothing of /etc/profile adds a node.
    writeFileSync(profile, `PATH='${tools}'; export PATH\n`)
    process.env.SHELL = '/bin/sh'
    const second = join(folder, '.scratch', 'demo', 'issues', '02-second.md')
    const watcher = await WorkflowWatcher.start({ root: repo, claudeHome, env: harnessScriptEnv, layoutRetryMs: 100, onChange: () => undefined })
    try {
      expect(watcher.current.epics).toEqual([])
      expect(watcher.current.error?.message).toMatch(/^worfy could not ask the Harness where the workflow of this Project lives: the profile script failed with exit code 127: .*node/)
      expect(commandPath('node', (await harnessScriptEnv()).PATH ?? '')).toBeNull()

      // The user adds node in an rc file, as nvm, fnm, volta, asdf and mise do, and worfy keeps running.
      writeFileSync(profile, `PATH='${nodeBin}:${tools}'; export PATH\n`)
      await until(() => watcher.current.epics.length > 0, 'the Epic after node was added')
      expectSilentEpic(watcher.current)
      expect(commandPath('node', (await harnessScriptEnv()).PATH ?? '')).not.toBeNull()

      // The watch started with the answer: a Ticket written now is read without a retry.
      writeFileSync(second, '# 02 — Second\n\nType: task\nStatus: open\nBlocked by: —\n')
      await until(() => watcher.current.tickets.some((ticket) => ticket.num === 2), 'the Ticket written after the recovery', 10_000)
    } finally {
      await watcher.close()
      rmSync(second, { force: true })
    }
  }, 60_000)
})
