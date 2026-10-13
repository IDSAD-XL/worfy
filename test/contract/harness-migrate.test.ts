// worfy-harness ticket 14: the old Harness leaves ~/.claude by the "Remove / Keep" form, with a
// backup and a one-command restore. Every case runs in a sandbox: a copy of
// test/fixtures/claude-home-legacy/ in a temporary folder, its home/.claude a git repository standing
// in for ~/.claude (CLAUDE_CONFIG_DIR, so .claude.json lies inside it), the plugin `worfy` installed in
// home/.claude/worfy-harness/plugin/ (a copy of harness/), and `claude` a stub that logs its
// arguments. git, bin/profile, gate.sh and restore.mjs run with HOME, CLAUDE_CONFIG_DIR and
// HARNESS_HOME of the sandbox. Nothing here touches the real ~/.claude.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessState } from '../../src/shared/ipc/harness'
import type { MigrationChoice, MigrationPlan, MigrationSelection, MigrationStep } from '../../src/shared/ipc/harness-migration'
import { applyMigration, MIGRATION_STEPS, type ApplyOptions } from '../../src/main/harness/migrate/apply'
import { removeTestTree } from '../remove'
import { buildPlan, claudeJsonPath, HARNESS_AGENTS, hasLegacyHarness, HARNESS_SKILLS, hookRecords, QMD_WARNING, RUNNING_SESSIONS_WARNING, type PlanOptions } from '../../src/main/harness/migrate/plan'
import { rewriteHarnessPaths } from '../../src/main/harness/migrate/profiles'
import { treeHash } from '../../src/main/harness/migrate/restore'

// The IPC module (src/main/ipc/harness-migration.ts) runs here without Electron: a dev build
// (`app.isPackaged` false) whose dialog and installer are watched. hasLegacyHarness and the installer
// stay the real ones, wrapped so a test can see whether they were called.
const electron = vi.hoisted(() => ({
  app: { isPackaged: false },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox: vi.fn() },
}))
vi.mock('electron', () => ({ ...electron, default: electron }))
const installerCreated = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/harness/migrate/plan', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/harness/migrate/plan')>()
  return { ...real, hasLegacyHarness: vi.fn(real.hasLegacyHarness) }
})
vi.mock('../../src/main/harness/install', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/harness/install')>()
  class WatchedInstaller extends real.HarnessInstaller {
    constructor(...args: ConstructorParameters<typeof real.HarnessInstaller>) {
      installerCreated()
      super(...args)
    }
  }
  return { ...real, HarnessInstaller: WatchedInstaller }
})

const REPO = join(__dirname, '..', '..')
const FIXTURE = join(REPO, 'test', 'fixtures', 'claude-home-legacy')
const INSTALLED: HarnessState = { kind: 'installed', version: '0.2.0+aaaaaaa', enabled: true }

/** The ten hook records of the old Harness in the fixture's settings.json (the eleventh is personal). */
const HARNESS_HOOKS = [
  '$HOME/.claude/hooks/session-start.sh',
  '$HOME/.claude/bin/worktree-lock claim',
  '$HOME/.claude/hooks/gate.sh fast',
  '~/.claude/hooks/gate.sh fast',
  '$HOME/.claude/hooks/stop.sh',
  '$HOME/.claude/bin/worktree-lock beat',
  '$HOME/.claude/bin/qmd-refresh --quiet',
  '__SANDBOX__/home/.claude/hooks/session-end.sh',
  '$HOME/.claude/bin/worktree-lock release',
  '$HOME/.claude/hooks/guard.mjs',
]
/** Names that are personal (Q19): no row may name them. */
const PERSONAL = ['cloudflare', 'wrangler', 'sentry-cli', 'web-perf', 'synced', 'telegram-mcp', 'auction-staging-db-mcp', 'agent-time-split', 'freecad', '"model"', '"env"', 'effortLevel']

const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_CLAUDE_LOG"
exit 0
`

const GIT_IDENTITY = { GIT_AUTHOR_NAME: 'Sandbox', GIT_AUTHOR_EMAIL: 'sandbox@example.com', GIT_COMMITTER_NAME: 'Sandbox', GIT_COMMITTER_EMAIL: 'sandbox@example.com' }

interface Sandbox {
  root: string
  home: string
  claudeHome: string
  harnessHome: string
  pluginDir: string
  claudeJson: string
  repos: { worfy: string; auction: string; atakamaServer: string; atakama: string }
  stubDir: string
  stubLog: string
  /** HOME, CLAUDE_CONFIG_DIR, HARNESS_HOME of the sandbox; git identity; GIT_CONFIG_NOSYSTEM. */
  env: NodeJS.ProcessEnv
}

let sandbox: Sandbox

function substitute(dir: string, root: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) substitute(path, root)
    else {
      const text = readFileSync(path, 'utf8')
      if (text.includes('__SANDBOX__')) writeFileSync(path, text.replaceAll('__SANDBOX__', root))
    }
  }
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: options.cwd, env: options.env ?? sandbox.env, input: options.input ?? '' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function git(dir: string, ...args: string[]): string {
  const result = run('git', ['-C', dir, ...args])
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} in ${dir}: ${result.stderr}`)
  return result.stdout
}

/** The plugin as the installer leaves it: harness/ without its tests, with a version (test/contract/harness-install.test.ts). */
function installPlugin(target: string, withQmd: boolean): void {
  const source = join(REPO, 'harness')
  const tests = [join('bin', 'tests'), join('hooks', 'tests')]
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const rel = relative(source, path)
      return !path.endsWith(`${sep}.DS_Store`) && !tests.some((dir) => rel === dir || rel.startsWith(`${dir}${sep}`))
    },
  })
  const manifest = join(target, '.claude-plugin', 'plugin.json')
  const { name, ...rest } = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
  writeFileSync(manifest, `${JSON.stringify({ name, version: '0.2.0+aaaaaaa', ...rest }, null, 2)}\n`)
  // harness/ declares qmd since worfy-harness ticket 17; without `withQmd` the plugin is one from before it.
  if (withQmd) writeFileSync(join(target, '.mcp.json'), `${JSON.stringify({ mcpServers: { qmd: { command: '${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp' } } }, null, 2)}\n`)
  else rmSync(join(target, '.mcp.json'), { force: true })
}

function makeSandbox({ qmdInPlugin = false }: { qmdInPlugin?: boolean } = {}): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-migrate-')))
  cpSync(FIXTURE, root, { recursive: true })
  substitute(root, root)
  const home = join(root, 'home')
  const claudeHome = join(home, '.claude')
  renameSync(join(claudeHome, 'gitignore'), join(claudeHome, '.gitignore'))
  const harnessHome = join(claudeHome, 'worfy-harness')
  const pluginDir = join(harnessHome, 'plugin')
  const stubDir = join(root, 'stub-bin')
  mkdirSync(stubDir)
  writeFileSync(join(stubDir, 'claude'), STUB)
  chmodSync(join(stubDir, 'claude'), 0o755)
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    CLAUDE_CONFIG_DIR: claudeHome,
    HARNESS_HOME: harnessHome,
    WORFY_CLAUDE_HOME: claudeHome,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG ?? 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    ...GIT_IDENTITY,
  }
  const repos = {
    worfy: join(root, 'repos', 'worfy'),
    auction: join(root, 'repos', 'auction'),
    atakama: join(root, 'repos', 'Atakama'),
    atakamaServer: join(root, 'repos', 'Atakama', 'Atakama-Browser-Server'),
  }
  sandbox = { root, home, claudeHome, harnessHome, pluginDir, claudeJson: join(claudeHome, '.claude.json'), repos, stubDir, stubLog: join(root, 'claude-calls.log'), env }
  for (const dir of [claudeHome, repos.worfy, repos.auction, repos.atakamaServer]) {
    git(dir, 'init', '-q')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'fixture')
  }
  installPlugin(pluginDir, qmdInPlugin)
  return sandbox
}

beforeEach(() => {
  makeSandbox()
})

// Not rmSync: the sandbox holds a git repository, whose objects are read-only files. Under the
// Node of Electron 44 on Windows rmSync stops at such a file with EPERM, which failed the test and
// left the folder behind (worfy-windows tickets 23 and 26).
afterEach(() => {
  removeTestTree(sandbox.root)
})

/**
 * Files (hash and mode) and folders of a tree: equal maps mean byte-equal trees. `.git` folders
 * and backups of a move are left out unless asked: a restore leaves its revert in the history.
 */
function treeOf(dir: string, { skip = (rel: string) => rel.split(sep).includes('.git') || /(^|\/)worfy-harness\/backup-/.test(rel) } = {}): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const rel = relative(dir, path)
      if (skip(rel)) continue
      if (entry.isDirectory()) {
        out[`${rel}/`] = 'dir'
        walk(path)
      } else if (entry.isSymbolicLink()) out[rel] = `link`
      else out[rel] = `${createHash('sha256').update(readFileSync(path)).digest('hex')} ${(statSync(path).mode & 0o777).toString(8)}`
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}
const everything = { skip: () => false }

function planOptions(extra: Partial<PlanOptions> = {}): PlanOptions {
  return {
    claudeHome: sandbox.claudeHome,
    harnessHome: sandbox.harnessHome,
    claudeJson: sandbox.claudeJson,
    userHome: sandbox.home,
    bridgeScript: null,
    offered: true,
    env: sandbox.env,
    pluginState: INSTALLED,
    ...extra,
  }
}

const plan = (extra: Partial<PlanOptions> = {}): MigrationPlan => buildPlan(planOptions(extra)).view

/** Every row id with a choice: `remove` where offered (or what `pick` says), `keep` elsewhere. */
function selection(view: MigrationPlan, pick: (id: string) => MigrationChoice | undefined = () => undefined, fields: MigrationSelection['profiles'] = {}): MigrationSelection {
  const rows = [...view.rows, ...(view.claudeMd?.sections ?? []), ...view.profiles]
  const choices = Object.fromEntries(rows.map((row) => [row.id, pick(row.id) ?? (row.choices.includes('remove') ? 'remove' : 'keep')]))
  const profiles = Object.fromEntries(view.profiles.map((profile) => [profile.name, fields[profile.name] ?? profile.fields]))
  return { choices, profiles }
}

function applyOptions(extra: Partial<ApplyOptions> = {}): ApplyOptions {
  const rest = omit(planOptions() as unknown as Record<string, unknown>, 'pluginState') as unknown as Omit<PlanOptions, 'pluginState'>
  return { ...rest, pluginStatus: () => Promise.resolve(INSTALLED), confirm: () => Promise.resolve(true), now: () => new Date('2026-10-08T10:20:30Z'), ...extra }
}

/** The link to a folder a user can make without a special right: a junction on Windows, a symlink elsewhere. */
const LINK_TO_A_FOLDER = process.platform === 'win32' ? 'junction' : 'dir'

const read = (path: string): string => readFileSync(path, 'utf8')
const readJson = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>
const hookCommands = (settingsPath: string): string[] => hookRecords(readJson(settingsPath)).map((hook) => hook.command)
const sub = (text: string): string => text.replaceAll('__SANDBOX__', sandbox.root)
const backupDir = (): string => join(sandbox.harnessHome, 'backup-2026-10-08-10-20-30')

describe('the plan of the form', () => {
  it('Q19 matches the plugin: the 3 agents and 7 skills of the old Harness are the ones harness/ carries', () => {
    expect(readdirSync(join(REPO, 'harness', 'agents')).sort()).toEqual([...HARNESS_AGENTS].sort())
    // connect-project came with the plugin (worfy-harness ticket 24): the old Harness never had it.
    expect(readdirSync(join(REPO, 'harness', 'skills')).sort()).toEqual([...HARNESS_SKILLS, 'connect-project'].sort())
  })

  it('names the ten hook records of the old Harness, the Harness files, the qmd group, the state and three Profiles — and nothing personal', () => {
    const view = plan()
    expect(view.available).toBe(true)
    expect(view.missing).toEqual([])

    const hooks = view.rows.filter((row) => row.group === 'hooks').map((row) => row.label)
    const qmd = view.rows.find((row) => row.group === 'qmd')
    expect(qmd?.detail).toContain('Stop hook: $HOME/.claude/bin/qmd-refresh --quiet')
    expect([...hooks, '$HOME/.claude/bin/qmd-refresh --quiet'].sort()).toEqual(HARNESS_HOOKS.map(sub).sort())

    const files = view.rows.filter((row) => row.group === 'files')
    const removable = files.filter((row) => row.choices.includes('remove')).map((row) => row.id.slice('file:'.length))
    expect(removable.sort()).toEqual(
      [
        ...HARNESS_AGENTS.map((name) => `agents/${name}`),
        ...HARNESS_SKILLS.map((name) => `skills/${name}`),
        ...['epic-board', 'epic-status', 'preflight', 'profile', 'ticket', 'worktree-lock'].map((name) => `bin/${name}`),
        ...['gate-resolve.mjs', 'gate.sh', 'guard.mjs', 'session-end.sh', 'session-start.sh', 'stop.sh'].map((name) => `hooks/${name}`),
        'profiles/README.md',
      ].sort(),
    )
    // Names of Q19 the plugin does not carry: "Keep" only, marked.
    const kept = files.filter((row) => !row.choices.includes('remove'))
    expect(kept.map((row) => row.id).sort()).toEqual(['file:bin/tests', 'file:bin/ТИКЕТЫ.md', 'file:hooks/tests'])
    for (const row of kept) {
      expect(row.choices).toEqual(['keep'])
      expect(row.note).toContain('not in the plugin')
    }

    expect(qmd?.detail?.split('\n')).toEqual([
      ...['qmd-mcp', 'qmd-refresh', 'qmd-sync-main'].map((name) => join(sandbox.claudeHome, 'bin', name)),
      'Stop hook: $HOME/.claude/bin/qmd-refresh --quiet',
      `mcpServers.qmd in ${sandbox.claudeJson}`,
    ])
    expect(qmd?.defaultChoice).toBe('remove')
    expect(qmd?.note).toBe(QMD_WARNING)

    expect(view.rows.filter((row) => row.group === 'state').map((row) => row.id)).toEqual(['state:gate-config', 'state:gate-state', 'state:worktree-sessions'])
    expect(view.profiles.map((profile) => [profile.name, profile.fields])).toEqual([
      ['atakama', { mode: 'silent', languageDocs: 'en', attribution: 'on' }],
      ['auction', { mode: 'full', languageDocs: 'ru', attribution: 'on' }],
      ['worfy', { mode: 'full', languageDocs: 'ru', attribution: 'on' }],
    ])
    expect(view.profiles.find((profile) => profile.name === 'atakama')?.carried).toEqual(['bin/', 'lessons/', 'state/'])
    expect(view.warnings).toEqual([RUNNING_SESSIONS_WARNING])

    // CLAUDE.md: the rules the plugin's hooks now carry are removed by default, the rest stays.
    const sections = view.claudeMd?.sections ?? []
    expect(sections.filter((section) => section.defaultChoice === 'keep').map((section) => section.label)).toEqual(['Standing authorization', 'My machine', 'Telegram'])
    // Its intro opens the plugin's orchestrator rules (harness/hooks/rules/orchestrator.md, ticket 05).
    expect(sections.find((section) => section.label === 'Workflow: orchestrator + subagents')).toMatchObject({ defaultChoice: 'remove', note: null })
    expect(sections.find((section) => section.label === 'Standing authorization')?.note).toContain("the user's own consent")
    expect(sections).toHaveLength(18)
    // A section ends at a heading of any level: the H4 under "Quota" and the H1 after "Context hygiene" are no part of them.
    expect(sections.find((section) => section.label === 'Quota')?.text).not.toContain('my-quota-line')
    expect(sections.find((section) => section.label === 'Context hygiene')?.text).not.toContain('my-secret-line')
    expect(sections.find((section) => section.label === 'Phase 3 — state, then report')?.text).toContain('## not a heading: inside a code block')

    const text = JSON.stringify(view)
    for (const name of PERSONAL) expect(text).not.toContain(name)
  })

  it('offers the status line of another build only with a bridge of this build: replaced, its argument kept', () => {
    const resources = join(sandbox.root, 'Resources')
    const bridge = join(resources, 'statusline-bridge.sh')
    const missing = plan({ bridgeScript: bridge }).rows.find((row) => row.group === 'status-line')
    expect(missing?.choices).toEqual(['keep'])
    expect(missing?.note).toBe(`this build has no ${bridge}`)
    const dev = plan({ bridgeScript: null }).rows.find((row) => row.group === 'status-line')
    expect(dev?.choices).toEqual(['keep'])
    expect(dev?.note).toContain('development build')

    mkdirSync(resources)
    writeFileSync(bridge, '#!/bin/sh\n')
    const offered = plan({ bridgeScript: bridge }).rows.find((row) => row.group === 'status-line')
    expect(offered?.choices).toEqual(['remove', 'keep'])
    expect(offered?.detail).toBe(`becomes: ${bridge} 'bash ~/.claude/statusline.sh'`)
  })

  it('a plugin with a qmd server: the qmd row has no warning', () => {
    removeTestTree(sandbox.root)
    makeSandbox({ qmdInPlugin: true })
    expect(plan().rows.find((row) => row.group === 'qmd')?.note).toBeNull()
  })

  it('names what is missing without the plugin installed and enabled, and reads nothing it would write', () => {
    expect(plan({ pluginState: { kind: 'not-installed' } }).missing).toEqual(['the plugin worfy is not installed: install it first (Install in the toolbar)'])
    expect(plan({ pluginState: { ...INSTALLED, enabled: false } }).missing).toEqual(['the plugin worfy is disabled in Claude Code: enable it first'])
    expect(plan({ pluginState: { kind: 'not-installed' } }).available).toBe(false)
  })

  it('.claude.json: inside a WORFY_CLAUDE_HOME sandbox, else in CLAUDE_CONFIG_DIR, else in the home folder', () => {
    expect(claudeJsonPath({ WORFY_CLAUDE_HOME: '/s/.claude', CLAUDE_CONFIG_DIR: '/other' }, '/s/.claude', '/home/me')).toBe('/s/.claude/.claude.json')
    expect(claudeJsonPath({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/me/.claude', '/home/me')).toBe('/cfg/.claude.json')
    expect(claudeJsonPath({}, '/home/me/.claude', '/home/me')).toBe('/home/me/.claude.json')
  })

  it('rewrites the paths of the old Harness in every form it is written in', () => {
    const homes = { claudeHome: sandbox.claudeHome, harnessHome: sandbox.harnessHome }
    expect(
      rewriteHarnessPaths(
        '~/.claude/bin/ticket $HOME/.claude/hooks/gate.sh ~/.claude/gate/config.json ~/.claude/profiles/README.md ~/.claude/profiles/atakama/bin/x ~/.claude/agents/scout.md',
        homes,
      ),
    ).toBe(
      '~/.claude/worfy-harness/plugin/bin/ticket $HOME/.claude/worfy-harness/plugin/hooks/gate.sh ~/.claude/worfy-harness/gate/config.json ~/.claude/worfy-harness/plugin/profiles/README.md ~/.claude/worfy-harness/projects/atakama/bin/x ~/.claude/worfy-harness/plugin/agents/scout.md',
    )
    // The Harness's agents and skills go to the plugin; a personal skill stays where it is.
    expect(rewriteHarnessPaths('`~/.claude/agents/{scout,implementer,reviewer}.md` ~/.claude/skills/epic-wave/SKILL.md ~/.claude/skills/cloudflare ~/.claude/skills/qmd-extra', homes)).toBe(
      '`~/.claude/worfy-harness/plugin/agents/{scout,implementer,reviewer}.md` ~/.claude/worfy-harness/plugin/skills/epic-wave/SKILL.md ~/.claude/skills/cloudflare ~/.claude/skills/qmd-extra',
    )
    expect(rewriteHarnessPaths(`${sandbox.claudeHome}/bin/ticket`, homes)).toBe(`${sandbox.claudeHome}/worfy-harness/plugin/bin/ticket`)
    const elsewhere = { claudeHome: sandbox.claudeHome, harnessHome: '/opt/harness' }
    expect(rewriteHarnessPaths('~/.claude/gate/config.json', elsewhere)).toBe('/opt/harness/gate/config.json')
  })
})

describe('the move', () => {
  it('"remove" everywhere: the Harness leaves ~/.claude into the backup byte for byte, the personal files stay byte for byte', async () => {
    const view = plan()
    const before = treeOf(sandbox.claudeHome)
    const settingsBefore = readJson(join(sandbox.claudeHome, 'settings.json'))
    const claudeJsonBefore = readJson(sandbox.claudeJson)
    // Every row of the old Harness removed; the sections of CLAUDE.md as the form proposes them.
    const sectionDefault = (id: string): MigrationChoice | undefined => view.claudeMd?.sections.find((section) => section.id === id)?.defaultChoice
    const result = await applyMigration(selection(view, sectionDefault), applyOptions())
    expect(result).toEqual({ outcome: 'done', backupDir: backupDir(), restoreCommand: `node ${join(backupDir(), 'restore.mjs')}` })

    // Harness files: gone from ~/.claude, byte for byte in the backup.
    const after = treeOf(sandbox.claudeHome)
    const harnessRels = view.rows
      .filter((row) => row.group === 'files' && row.choices.includes('remove'))
      .map((row) => row.id.slice('file:'.length))
      .concat(['bin/qmd-mcp', 'bin/qmd-refresh', 'bin/qmd-sync-main', 'gate/config.json', 'gate/state', 'worktree-sessions', 'profiles/atakama', 'profiles/auction', 'profiles/worfy'])
    const isHarness = (rel: string): boolean => harnessRels.some((root) => rel === root || rel === `${root}/` || rel.startsWith(`${root}/`))
    for (const rel of Object.keys(before).filter(isHarness)) expect(after[rel], rel).toBeUndefined()
    const backup = treeOf(join(backupDir(), 'claude'))
    for (const rel of Object.keys(before).filter(isHarness)) expect(backup[rel], rel).toBe(before[rel])

    // Personal files: byte for byte where they were.
    const personal = Object.keys(before).filter((rel) => !isHarness(rel) && !['settings.json', 'CLAUDE.md', '.claude.json'].includes(rel) && !rel.startsWith('worfy-harness/'))
    for (const rel of personal) expect(after[rel], rel).toBe(before[rel])
    for (const rel of ['skills/cloudflare/SKILL.md', 'skills/synced/notes/SKILL.md', 'bin/telegram-mcp', 'bin/auction-staging-db-mcp', 'bin/agent-time-split', 'projects/-sandbox-repos-worfy/session.jsonl']) {
      expect(after[rel], rel).toBe(before[rel])
    }

    // settings.json: only the planned hook records went; everything else is deep-equal.
    const settings = readJson(join(sandbox.claudeHome, 'settings.json'))
    expect(hookCommands(join(sandbox.claudeHome, 'settings.json'))).toEqual(['$HOME/.claude/bin/telegram-mcp --hello'])
    expect(omit(settings, 'hooks', 'statusLine')).toEqual(omit(settingsBefore, 'hooks', 'statusLine'))
    expect(settings.statusLine).toEqual(settingsBefore.statusLine)

    // .claude.json: the qmd record went, the personal servers stayed.
    const claudeJson = readJson(sandbox.claudeJson)
    expect(claudeJson.mcpServers).toEqual(omit(claudeJsonBefore.mcpServers as Record<string, unknown>, 'qmd'))
    expect(omit(claudeJson, 'mcpServers')).toEqual(omit(claudeJsonBefore, 'mcpServers'))
    expect(read(sandbox.claudeJson)).toBe(`${JSON.stringify(claudeJson, null, 2)}\n`)

    // CLAUDE.md: the removed sections went, the kept ones are byte for byte in place.
    const sections = view.claudeMd?.sections ?? []
    const claudeMd = read(join(sandbox.claudeHome, 'CLAUDE.md'))
    const removed = sections.filter((section) => section.defaultChoice === 'remove')
    const expected = (view.claudeMd?.text ?? '')
      .split('\n')
      .filter((_line, index) => !removed.some((section) => index >= section.start && index < section.end))
      .join('\n')
    expect(claudeMd).toBe(expected)
    for (const section of sections.filter((value) => value.defaultChoice === 'keep')) expect(claudeMd).toContain(section.text)
    // Text under an H1 or an H4 after a removed section stays.
    expect(claudeMd).toContain('# Personal\n\nmy-secret-line')
    expect(claudeMd).toContain('#### My quota note\n\nmy-quota-line')
    expect(claudeMd).not.toContain('### Quota')
  })

  it('Profiles: schema 2 in worfy-harness/projects, no paths of the old Harness, the form fields; bin/profile and gate.sh find them', async () => {
    const view = plan()
    // The form's values differ from the proposed ones (worfy: full, ru, on).
    const result = await applyMigration(selection(view, undefined, { worfy: { mode: 'silent', languageDocs: 'en', attribution: 'off' } }), applyOptions())
    expect(result.outcome).toBe('done')
    const expected = { worfy: ['silent', 'en', 'off'], auction: ['full', 'ru', 'on'], atakama: ['silent', 'en', 'on'] }
    for (const [name, [mode, docs, attribution]] of Object.entries(expected)) {
      const dir = join(sandbox.harnessHome, 'projects', name)
      const profile = readJson(join(dir, 'profile.json'))
      expect(profile.schema).toBe(2)
      expect(profile.mode).toBe(mode)
      expect(profile.attribution).toBe(attribution)
      expect((profile.language as Record<string, unknown>).docs).toBe(docs)
      expect((profile.tickets as Record<string, unknown>).status_tool).toBeUndefined()
      expect((profile.tickets as Record<string, unknown>).epic_status).toBeUndefined()
      expect(isObject(profile.workflow) ? profile.workflow.preflight : undefined).toBeUndefined()
      expect(isObject(profile.numbering) ? profile.numbering.reserve_with : undefined).toBeUndefined()
      for (const file of ['profile.json', 'rules.md']) {
        const text = read(join(dir, file))
        for (const old of ['~/.claude/bin/', '~/.claude/hooks/', '~/.claude/gate/', '~/.claude/profiles/', '~/.claude/agents/', '$HOME/.claude/hooks/', `${sandbox.claudeHome}/profiles/`]) {
          expect(text, `${name}/${file}`).not.toContain(old)
        }
      }
    }
    expect(read(join(sandbox.harnessHome, 'projects', 'atakama', 'rules.md'))).toContain('~/.claude/worfy-harness/plugin/hooks/gate.sh')
    expect(read(join(sandbox.harnessHome, 'projects', 'auction', 'rules.md'))).toContain('`~/.claude/worfy-harness/plugin/agents/{scout,implementer,reviewer}.md`')
    expect(readJson(join(sandbox.harnessHome, 'projects', 'atakama', 'profile.json')).commands).toEqual({ verify: 'bash ~/.claude/worfy-harness/plugin/hooks/gate.sh full </dev/null' })
    for (const rel of ['bin/tickets.mjs', 'lessons/lessons.md', 'state/pending-retro.log']) expect(existsSync(join(sandbox.harnessHome, 'projects', 'atakama', rel)), rel).toBe(true)

    // bin/profile of harness/ (ticket 11) on the fixture repositories reads the form's mode.
    const profileBin = join(REPO, 'harness', 'bin', 'profile')
    const worfyMode = run(profileBin, ['-C', sandbox.repos.worfy, '--field', 'mode'])
    expect(worfyMode).toMatchObject({ status: 0, stdout: 'silent\n' })
    expect(run(profileBin, ['-C', sandbox.repos.worfy, '--field', 'attribution'])).toMatchObject({ status: 0, stdout: 'off\n' })
    expect(run(profileBin, ['-C', sandbox.repos.atakamaServer, '--field', 'mode'])).toMatchObject({ status: 0, stdout: 'silent\n' })

    // Gate: registry and markers in worfy-harness/gate/; gate.sh of harness/ finds the project.
    expect(read(join(sandbox.harnessHome, 'gate', 'config.json'))).toBe(read(join(backupDir(), 'claude', 'gate', 'config.json')))
    expect(existsSync(join(sandbox.harnessHome, 'gate', 'state', 'red-worfy-44f904e2'))).toBe(true)
    expect(existsSync(join(sandbox.harnessHome, 'worktree-sessions', 'sandbox-repos-worfy-0000aaaa.json'))).toBe(true)
    const gate = run('bash', [join(REPO, 'harness', 'hooks', 'gate.sh'), 'fast'], { cwd: sandbox.repos.worfy })
    expect(`${gate.stdout}${gate.stderr}`).not.toMatch(/не зарегистрирован|not registered/)
    expect(gate.status).toBe(0)
  })

  it('git: one new commit in ~/.claude with only the paths of the move; an uncommitted change elsewhere stays uncommitted; worfy-harness is a repository with the Profiles and the registry', async () => {
    writeFileSync(join(sandbox.claudeHome, 'skills', 'cloudflare', 'SKILL.md'), 'an uncommitted personal change\n')
    const head = git(sandbox.claudeHome, 'rev-parse', 'HEAD').trim()
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('done')

    expect(git(sandbox.claudeHome, 'rev-list', `${head}..HEAD`).trim().split('\n')).toHaveLength(1)
    const files = git(sandbox.claudeHome, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').trim().split('\n')
    const manifest = readJson(join(backupDir(), 'manifest.json')) as { claude: string[]; commits: { claudeHome: string; harnessHome: string } }
    for (const file of files) expect(manifest.claude.some((rel) => file === rel || file.startsWith(`${rel}/`)), file).toBe(true)
    expect(files).toContain('settings.json')
    expect(files).toContain('bin/epic-status')
    expect(files).not.toContain('skills/cloudflare/SKILL.md')
    expect(git(sandbox.claudeHome, 'status', '--porcelain', '--', 'skills/cloudflare/SKILL.md').trim()).toBe('M skills/cloudflare/SKILL.md')
    expect(git(sandbox.claudeHome, 'log', '-1', '--format=%s')).toMatch(/^Move the old Harness out of ~\/\.claude/)
    expect(manifest.commits.claudeHome).toBe(git(sandbox.claudeHome, 'rev-parse', 'HEAD').trim())

    expect(realpathSync(git(sandbox.harnessHome, 'rev-parse', '--show-toplevel').trim())).toBe(sandbox.harnessHome)
    const committed = git(sandbox.harnessHome, 'ls-tree', '-r', '--name-only', 'HEAD').trim().split('\n')
    expect(committed).toEqual(expect.arrayContaining(['.gitignore', 'gate/config.json', 'projects/worfy/profile.json', 'projects/worfy/rules.md', 'projects/atakama/bin/tickets.mjs']))
    // State, not history: the plugin copy, markers, locks, backups and Profile state are not committed.
    for (const file of committed) expect(file).not.toMatch(/^(plugin|backup-|worktree-sessions|gate\/state)|\/state\//)
    expect(manifest.commits.harnessHome).toBe(git(sandbox.harnessHome, 'rev-parse', 'HEAD').trim())
  })

  it('"Keep" on a row of each kind leaves that file or record untouched', async () => {
    const resources = join(sandbox.root, 'Resources')
    mkdirSync(resources)
    writeFileSync(join(resources, 'statusline-bridge.sh'), '#!/bin/sh\n')
    const options = { bridgeScript: join(resources, 'statusline-bridge.sh') }
    const view = plan(options)
    const stopHook = view.rows.find((row) => row.group === 'hooks' && row.label === '$HOME/.claude/hooks/stop.sh')
    const kept = new Set(['file:agents/scout.md', 'file:hooks/stop.sh', stopHook?.id, 'status-line', 'profile:auction', 'claude-md:3:Default loop'])
    const before = treeOf(sandbox.claudeHome)
    const settingsBefore = readJson(join(sandbox.claudeHome, 'settings.json'))
    const result = await applyMigration(
      selection(view, (id) => (kept.has(id) ? 'keep' : undefined)),
      applyOptions(options),
    )
    expect(result.outcome).toBe('done')
    const after = treeOf(sandbox.claudeHome)
    for (const rel of ['agents/scout.md', 'hooks/stop.sh', 'profiles/auction/', 'profiles/auction/profile.json', 'profiles/auction/rules.md']) expect(after[rel], rel).toBe(before[rel])
    expect(existsSync(join(sandbox.harnessHome, 'projects', 'auction'))).toBe(false)
    const settings = readJson(join(sandbox.claudeHome, 'settings.json'))
    expect(settings.statusLine).toEqual(settingsBefore.statusLine)
    expect(hookCommands(join(sandbox.claudeHome, 'settings.json'))).toEqual(['$HOME/.claude/bin/telegram-mcp --hello', '$HOME/.claude/hooks/stop.sh'])
    expect(read(join(sandbox.claudeHome, 'CLAUDE.md'))).toContain(view.claudeMd?.sections.find((section) => section.label === 'Default loop')?.text ?? 'missing')
  })

  it('the status line of another build: the command points at this build bridge and keeps its argument', async () => {
    const bridge = join(sandbox.root, 'Resources', 'statusline-bridge.sh')
    mkdirSync(dirname(bridge))
    writeFileSync(bridge, '#!/bin/sh\n')
    const before = readJson(join(sandbox.claudeHome, 'settings.json')).statusLine as Record<string, unknown>
    const result = await applyMigration(selection(plan({ bridgeScript: bridge })), applyOptions({ bridgeScript: bridge }))
    expect(result.outcome).toBe('done')
    expect(readJson(join(sandbox.claudeHome, 'settings.json')).statusLine).toEqual({ ...before, command: `${bridge} 'bash ~/.claude/statusline.sh'` })
  })

  it('the qmd group: "Remove" takes the three scripts, the hook and the record together; "Keep" leaves all five, .claude.json byte for byte', async () => {
    const claudeJson = read(sandbox.claudeJson)
    const result = await applyMigration(selection(plan(), (id) => (id === 'qmd' ? 'keep' : undefined)), applyOptions())
    expect(result.outcome).toBe('done')
    for (const name of ['qmd-mcp', 'qmd-refresh', 'qmd-sync-main']) expect(existsSync(join(sandbox.claudeHome, 'bin', name))).toBe(true)
    expect(hookCommands(join(sandbox.claudeHome, 'settings.json'))).toContain('$HOME/.claude/bin/qmd-refresh --quiet')
    expect(read(sandbox.claudeJson)).toBe(claudeJson)

    removeTestTree(sandbox.root)
    makeSandbox()
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    for (const name of ['qmd-mcp', 'qmd-refresh', 'qmd-sync-main']) expect(existsSync(join(sandbox.claudeHome, 'bin', name))).toBe(false)
    expect(hookCommands(join(sandbox.claudeHome, 'settings.json'))).not.toContain('$HOME/.claude/bin/qmd-refresh --quiet')
    const servers = readJson(sandbox.claudeJson).mcpServers as Record<string, unknown>
    expect(Object.keys(servers)).toEqual(['freecad', 'telegram'])
  })

  it('the toolbar offer: there before a move, gone after a move with the defaults, there while a Harness file is kept', async () => {
    const offered = (): boolean => hasLegacyHarness(omit(planOptions() as unknown as Record<string, unknown>, 'pluginState') as unknown as Omit<PlanOptions, 'pluginState'>)
    expect(offered()).toBe(true)
    const view = plan()
    const sectionDefault = (id: string): MigrationChoice | undefined => view.claudeMd?.sections.find((section) => section.id === id)?.defaultChoice
    expect((await applyMigration(selection(view, sectionDefault), applyOptions())).outcome).toBe('done')
    expect(offered()).toBe(false)
    expect(plan().missing).toEqual(['nothing of the old Harness is left in ~/.claude'])

    removeTestTree(sandbox.root)
    makeSandbox()
    const again = plan()
    const keepScout = (id: string): MigrationChoice | undefined => (id === 'file:agents/scout.md' ? 'keep' : (again.claudeMd?.sections.find((section) => section.id === id)?.defaultChoice))
    expect((await applyMigration(selection(again, keepScout), applyOptions())).outcome).toBe('done')
    expect(offered()).toBe(true)
  })

  it('removes bin/epic-status last, after the hook records left settings.json (ADR-0049)', async () => {
    const seen: { step: MigrationStep; marker: boolean; hooks: number }[] = []
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const look = (step: MigrationStep): void => {
      seen.push({ step, marker: existsSync(join(sandbox.claudeHome, 'bin', 'epic-status')), hooks: hookCommands(settingsPath).length })
    }
    const result = await applyMigration(selection(plan()), applyOptions({ beforeStep: look }))
    expect(result.outcome).toBe('done')
    expect(seen.map((entry) => entry.step)).toEqual([...MIGRATION_STEPS])
    // The marker is there at the start of every step up to its own, and the hooks are gone before it.
    for (const entry of seen.slice(0, MIGRATION_STEPS.indexOf('epic-status') + 1)) expect(entry.marker, entry.step).toBe(true)
    expect(seen.find((entry) => entry.step === 'epic-status')?.hooks).toBe(1)
    expect(seen.find((entry) => entry.step === 'commit')?.marker).toBe(false)
  })
})

describe('restore and refusals', () => {
  /** The sandbox before a move, as the move must leave it after an undo. */
  const snapshot = (): { tree: Record<string, string>; claudeJson: string; outside: Record<string, string> } => ({
    tree: treeOf(sandbox.claudeHome),
    claudeJson: read(sandbox.claudeJson),
    outside: treeOf(sandbox.root, { skip: (rel) => rel === join('home', '.claude') || rel === 'claude-calls.log' }),
  })

  it('node restore.mjs, a separate process: exit 0, ~/.claude and .claude.json as before the move, the commit reverted, the plugin disabled', async () => {
    const before = snapshot()
    const head = git(sandbox.claudeHome, 'rev-parse', 'HEAD').trim()
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('done')
    const node = findNode()
    const env = { ...sandbox.env, PATH: [sandbox.stubDir, '/usr/bin', '/bin'].join(delimiter), STUB_CLAUDE_LOG: sandbox.stubLog }
    const restored = run(node, [join(backupDir(), 'restore.mjs')], { env, cwd: sandbox.root })
    expect(restored.stderr).toBe('')
    expect(restored.status).toBe(0)
    expect(read(sandbox.stubLog)).toBe('plugin disable worfy@worfy-harness --scope user\n')
    expect(treeOf(sandbox.claudeHome)).toEqual(before.tree)
    expect(read(sandbox.claudeJson)).toBe(before.claudeJson)
    expect(git(sandbox.claudeHome, 'rev-list', `${head}..HEAD`).trim().split('\n')).toHaveLength(2)
    expect(git(sandbox.claudeHome, 'log', '-1', '--format=%s')).toMatch(/^Revert "Move the old Harness/)
    expect(git(sandbox.claudeHome, 'status', '--porcelain').trim()).toBe('')
    expect(existsSync(join(sandbox.harnessHome, '.git'))).toBe(false)
    // Nothing changed after the move: after/ holds only the .git the move created, nothing else.
    expect(readdirSync(join(backupDir(), 'after'))).toEqual(['harness-git'])
    expect(existsSync(join(backupDir(), 'after', 'harness-git', '.git', 'HEAD'))).toBe(true)
  })

  it('restore.mjs without claude in PATH prints the command that disables the plugin and still restores', async () => {
    const before = snapshot()
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const node = findNode()
    const restored = run(node, [join(backupDir(), 'restore.mjs')], { env: { ...sandbox.env, PATH: ['/usr/bin', '/bin'].join(delimiter) }, cwd: sandbox.root })
    expect(restored.status).toBe(0)
    expect(restored.stdout).toContain('claude plugin disable worfy@worfy-harness --scope user')
    expect(treeOf(sandbox.claudeHome)).toEqual(before.tree)
  })

  const phases = MIGRATION_STEPS.flatMap((step) => [
    { step, when: 'before' as const },
    { step, when: 'after' as const },
  ])
  it.each(phases)('a failure $when the step "$step": the move undoes itself, the tree is as before, the answer names the step', async ({ step, when }) => {
    const before = snapshot()
    const fail = (current: MigrationStep): void => {
      if (current === step) throw new Error(`injected failure ${when} ${step}`)
    }
    const result = await applyMigration(selection(plan()), applyOptions(when === 'before' ? { beforeStep: fail } : { afterStep: fail }))
    expect(result).toEqual({ outcome: 'failed', step, reason: `injected failure ${when} ${step}`, rolledBack: true, rollbackError: null, backupDir: null })
    // The backup of a move that undid itself is removed (treeOf leaves backups out, so it is asked here).
    expect(existsSync(backupDir())).toBe(false)
    expect(treeOf(sandbox.claudeHome)).toEqual(before.tree)
    expect(read(sandbox.claudeJson)).toBe(before.claudeJson)
    expect(treeOf(sandbox.root, { skip: (rel) => rel === join('home', '.claude') || rel === 'claude-calls.log' })).toEqual(before.outside)
  })

  // worfy-windows ticket 23. A junction is the link to a folder that Windows lets any user make; a
  // skill folder under ~/.claude can be one. The step "files", the undo in restore.mjs and the
  // removal of the backup each meet the link, and each must take it as a link: under the Node of
  // Electron 44 fs.rmSync went through it and emptied the folder behind. Only Windows has junctions;
  // elsewhere the same runs with a symlink to the folder, which no system ever went through.
  it('a Harness skill that is a link to a folder (a junction on Windows): the step "files" takes the link away, the undo puts it back, and the folder behind keeps its files all along', async () => {
    const skill = join(sandbox.claudeHome, 'skills', HARNESS_SKILLS[0])
    const behind = join(sandbox.root, 'behind-skill')
    renameSync(skill, behind)
    writeFileSync(join(behind, 'mine.txt'), 'not the Harness\n')
    symlinkSync(behind, skill, LINK_TO_A_FOLDER)
    const kept = treeOf(behind, everything)
    expect(Object.keys(kept)).toContain('mine.txt')
    const there = (path: string): boolean => {
      try {
        lstatSync(path)
        return true
      } catch {
        return false
      }
    }

    const afterFiles: { link: boolean; behind: Record<string, string> }[] = []
    const fail = (current: MigrationStep): void => {
      if (current !== 'files') return
      afterFiles.push({ link: there(skill), behind: treeOf(behind, everything) })
      throw new Error('injected failure after files')
    }
    const result = await applyMigration(selection(plan()), applyOptions({ afterStep: fail }))
    expect(result).toEqual({ outcome: 'failed', step: 'files', reason: 'injected failure after files', rolledBack: true, rollbackError: null, backupDir: null })
    expect(afterFiles).toEqual([{ link: false, behind: kept }])
    expect(lstatSync(skill).isSymbolicLink()).toBe(true)
    expect(treeOf(behind, everything)).toEqual(kept)
    expect(existsSync(backupDir())).toBe(false)
  })

  // The same for the walk inside restore.mjs: the undo removes what is at a path before it puts
  // the backup's copy there. Here the link is back at the path by then — made again while the move
  // ran — so the undo meets it.
  it('a link that is at the path of a skill again when the move is undone: the undo takes it as a link, the folder behind keeps its files', async () => {
    const skill = join(sandbox.claudeHome, 'skills', HARNESS_SKILLS[0])
    const behind = join(sandbox.root, 'behind-skill')
    renameSync(skill, behind)
    writeFileSync(join(behind, 'mine.txt'), 'not the Harness\n')
    symlinkSync(behind, skill, LINK_TO_A_FOLDER)
    const kept = treeOf(behind, everything)
    let made = 0
    const fail = (current: MigrationStep): void => {
      if (current !== 'files') return
      symlinkSync(behind, skill, LINK_TO_A_FOLDER)
      made++
      throw new Error('injected failure after files')
    }
    const result = await applyMigration(selection(plan()), applyOptions({ afterStep: fail }))
    expect(made).toBe(1)
    expect(result).toMatchObject({ outcome: 'failed', step: 'files', rolledBack: true, rollbackError: null })
    expect(treeOf(behind, everything)).toEqual(kept)
    expect(lstatSync(skill).isSymbolicLink()).toBe(true)
  })

  it.each<[string, HarnessState]>([
    ['not installed', { kind: 'not-installed' }],
    ['disabled', { ...INSTALLED, enabled: false }],
    ['outdated', { kind: 'outdated', from: '0.1.0', to: '0.2.0' }],
  ])('the plugin %s: refused with the reason, nothing written', async (_name, state) => {
    const before = treeOf(sandbox.root, everything)
    const result = await applyMigration(selection(plan()), applyOptions({ pluginStatus: () => Promise.resolve(state) }))
    expect(result.outcome).toBe('refused')
    expect(result.outcome === 'refused' ? result.reason : '').toMatch(/plugin worfy/)
    expect(treeOf(sandbox.root, everything)).toEqual(before)
  })

  it('without consent, without `offered`, with stale choices or a kept hook of a removed file: nothing written', async () => {
    const before = treeOf(sandbox.root, everything)
    const view = plan()
    expect(await applyMigration(selection(view), applyOptions({ confirm: () => Promise.resolve(false) }))).toEqual({ outcome: 'declined' })
    expect((await applyMigration(selection(view), applyOptions({ offered: false }))).outcome).toBe('refused')
    const stale = selection(view)
    delete stale.choices['file:agents/scout.md']
    expect(await applyMigration(stale, applyOptions())).toEqual({ outcome: 'refused', reason: '~/.claude changed since the form was opened: open it again' })
    const stopHook = view.rows.find((row) => row.label === '$HOME/.claude/hooks/stop.sh')?.id
    const broken = await applyMigration(selection(view, (id) => (id === stopHook ? 'keep' : undefined)), applyOptions())
    expect(broken.outcome === 'refused' ? broken.reason : '').toContain('runs hooks/stop.sh, which would be removed')
    const notOffered = selection(view, (id) => (id === 'file:bin/tests' ? 'remove' : undefined))
    expect((await applyMigration(notOffered, applyOptions())).outcome).toBe('refused')
    expect(treeOf(sandbox.root, everything)).toEqual(before)
  })

  it('refuses a Claude home that is the user home folder before reading the plugin state', async () => {
    let asked = false
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        claudeHome: homedir(),
        pluginStatus: () => {
          asked = true
          return Promise.resolve(INSTALLED)
        },
      }),
    )
    expect(result.outcome).toBe('refused')
    expect(asked).toBe(false)
  })

  it('a move writes nothing outside ~/.claude of the sandbox and nothing into the repositories of Projects (ADR-0005)', async () => {
    const outside = treeOf(sandbox.root, { skip: (rel) => rel === join('home', '.claude') })
    const repos = treeOf(join(sandbox.root, 'repos'), everything)
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('done')
    expect(treeOf(sandbox.root, { skip: (rel) => rel === join('home', '.claude') })).toEqual(outside)
    expect(treeOf(join(sandbox.root, 'repos'), everything)).toEqual(repos)
    // Inside ~/.claude only the move's own places changed: no stray temporary files.
    expect(readdirSync(sandbox.claudeHome).filter((name) => name.includes('worfy-move'))).toEqual([])
    expect(lstatSync(backupDir()).isDirectory()).toBe(true)
  })
})

describe('boundaries, races and what changed after the move', () => {
  const node = (): string => findNode()
  const runRestore = (): { status: number | null; stdout: string; stderr: string } =>
    run(node(), [join(backupDir(), 'restore.mjs'), '--keep-plugin'], { env: { ...sandbox.env, PATH: ['/usr/bin', '/bin'].join(delimiter) }, cwd: sandbox.root })

  it('a Harness folder that is a symlink leading outside ~/.claude: refused, nothing written, the outside files untouched', async () => {
    const outside = join(sandbox.root, 'outside-hooks')
    renameSync(join(sandbox.claudeHome, 'hooks'), outside)
    symlinkSync(outside, join(sandbox.claudeHome, 'hooks'))
    const before = treeOf(sandbox.root, everything)
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('refused')
    expect(result.outcome === 'refused' ? result.reason : '').toMatch(/^refusing hooks\/.+: its folder leads outside/)
    expect(treeOf(sandbox.root, everything)).toEqual(before)
  })

  it('restore.mjs refuses a manifest path leading out of its homes ("../") before it changes anything', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const victim = join(sandbox.root, 'outside.txt')
    writeFileSync(victim, 'not the Harness\n')
    const manifestPath = join(backupDir(), 'manifest.json')
    const manifest = readJson(manifestPath) as { created: string[]; claude: string[] }
    for (const tamper of [
      { ...manifest, created: [...manifest.created, join('..', '..', '..', 'outside.txt')] },
      { ...manifest, claude: [join('..', '..', 'outside.txt'), ...manifest.claude] },
    ]) {
      writeFileSync(manifestPath, JSON.stringify(tamper))
      const before = treeOf(sandbox.root, everything)
      const restored = runRestore()
      expect(restored.status).toBe(1)
      expect(restored.stderr).toMatch(/^restore failed: refusing a path outside /)
      expect(treeOf(sandbox.root, everything)).toEqual(before)
    }
    expect(read(victim)).toBe('not the Harness\n')
  })

  it('restore.mjs keeps what changed after the move in <backup>/after/: a lesson, a rules.md edit, settings.json, a new lock', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const projects = join(sandbox.harnessHome, 'projects')
    writeFileSync(join(projects, 'atakama', 'lessons', 'retro-2026-10-09.md'), 'a lesson /retro wrote after the move\n')
    writeFileSync(join(projects, 'worfy', 'rules.md'), `${read(join(projects, 'worfy', 'rules.md'))}- a rule added after the move\n`)
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const settings = readJson(settingsPath)
    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, theme: 'light' }, null, 2)}\n`)
    mkdirSync(join(sandbox.claudeHome, 'gate', 'state'), { recursive: true })
    writeFileSync(join(sandbox.claudeHome, 'gate', 'state', 'red-new'), 'a marker an old gate wrote after the move\n')

    const restored = runRestore()
    expect(restored.stderr).toBe('')
    expect(restored.status).toBe(0)
    const after = join(backupDir(), 'after')
    expect(read(join(after, 'harness', 'projects', 'atakama', 'lessons', 'retro-2026-10-09.md'))).toBe('a lesson /retro wrote after the move\n')
    expect(read(join(after, 'harness', 'projects', 'worfy', 'rules.md'))).toContain('- a rule added after the move')
    expect(readJson(join(after, 'claude', 'settings.json')).theme).toBe('light')
    expect(read(join(after, 'claude', 'gate', 'state', 'red-new'))).toBe('a marker an old gate wrote after the move\n')
    // What the move left untouched is not in after/: an unchanged Profile file was simply taken away.
    expect(existsSync(join(after, 'harness', 'projects', 'auction'))).toBe(false)
    expect(existsSync(join(after, 'claude', 'CLAUDE.md'))).toBe(false)
    // The old places hold the backup's versions again.
    expect(readJson(settingsPath).theme).toBe('dark')
    expect(existsSync(join(projects, 'worfy'))).toBe(false)
  })

  it('a second restore.mjs keeps what the first one saved in after/: it says the backup is restored and changes nothing', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
    const saved = join(backupDir(), 'after', 'claude', 'settings.json')
    expect(runRestore().status).toBe(0)
    expect(readJson(saved).theme).toBe('light')
    const before = treeOf(sandbox.root, everything)
    const again = runRestore()
    expect(again.status).toBe(0)
    expect(again.stdout).toMatch(/^Already restored at .+ from this backup: nothing to do\./m)
    expect(readJson(saved).theme).toBe('light')
    expect(treeOf(sandbox.root, everything)).toEqual(before)
  })

  it('a failed move kept a change in after/, then the owner runs restore.mjs of that backup: the change is still there', async () => {
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        afterStep: (step) => {
          if (step !== 'claude-md') return
          writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
          throw new Error('injected after a live write')
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', rolledBack: true, backupDir: backupDir() })
    const saved = join(backupDir(), 'after', 'claude', 'settings.json')
    expect(readJson(saved).theme).toBe('light')
    const restored = runRestore()
    expect(restored.status).toBe(0)
    expect(readJson(saved).theme).toBe('light')
  })

  it('a restore that stopped before it was marked done: the next run saves into a new after-<n>/, never over after/', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
    expect(runRestore().status).toBe(0)
    // As if the first run had stopped before marking the backup restored.
    const manifestPath = join(backupDir(), 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(omit(readJson(manifestPath), 'restoredAt')))
    expect(runRestore().status).toBe(0)
    expect(readJson(join(backupDir(), 'after', 'claude', 'settings.json')).theme).toBe('light')
    expect(readJson(join(backupDir(), 'after-2', 'claude', 'settings.json')).theme).toBe('dark')
  })

  it('restore.mjs and the move fingerprint files the same way', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const script = (await import(/* @vite-ignore */ pathToFileURL(join(backupDir(), 'restore.mjs')).href)) as { treeHash: (path: string) => string | null }
    for (const path of [sandbox.pluginDir, join(sandbox.claudeHome, 'settings.json'), join(sandbox.claudeHome, 'skills'), join(sandbox.root, 'missing')]) {
      expect(script.treeHash(path)).toBe(treeHash(path))
    }
    symlinkSync('settings.json', join(sandbox.root, 'link'))
    expect(script.treeHash(join(sandbox.root, 'link'))).toBe(treeHash(join(sandbox.root, 'link')))
  })

  it('a state file a live Session writes during the move stays where it is; the files the backup copied leave', async () => {
    const lock = join(sandbox.claudeHome, 'worktree-sessions', 'live-session.json')
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        beforeStep: (step) => {
          if (step === 'state') writeFileSync(lock, '{"session":"live"}\n')
        },
      }),
    )
    expect(result.outcome).toBe('done')
    expect(read(lock)).toBe('{"session":"live"}\n')
    expect(readdirSync(join(sandbox.claudeHome, 'worktree-sessions'))).toEqual(['live-session.json'])
    expect(existsSync(join(sandbox.claudeHome, 'gate', 'state'))).toBe(false)
    expect(existsSync(join(sandbox.harnessHome, 'worktree-sessions', 'sandbox-repos-worfy-0000aaaa.json'))).toBe(true)
  })

  it('CLAUDE.md changed during the move: the step fails, the move is undone, and the edit stays in CLAUDE.md (the move never wrote it)', async () => {
    const claudeMd = join(sandbox.claudeHome, 'CLAUDE.md')
    const edited = `${read(claudeMd)}\n## Written during the move\n`
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        beforeStep: (step) => {
          if (step === 'claude-md') writeFileSync(claudeMd, edited)
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', step: 'claude-md', rolledBack: true, backupDir: null })
    expect(result.outcome === 'failed' ? result.reason : '').toContain('CLAUDE.md changed during the move')
    expect(read(claudeMd)).toBe(edited)
    expect(existsSync(join(sandbox.claudeHome, 'agents', 'scout.md'))).toBe(true)
  })

  it('a file changed during the move after the move wrote it: undone, and the change is kept in after/', async () => {
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const original = read(settingsPath)
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        afterStep: (step) => {
          if (step !== 'claude-md') return
          writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
          throw new Error('injected after a live write')
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', step: 'claude-md', rolledBack: true, backupDir: backupDir() })
    expect(read(settingsPath)).toBe(original)
    expect(readJson(join(backupDir(), 'after', 'claude', 'settings.json')).theme).toBe('light')
  })

  it('settings.json changed during the move: the step fails rather than dropping the wrong hook records', async () => {
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        beforeStep: (step) => {
          if (step !== 'settings') return
          const settings = readJson(settingsPath) as { hooks: Record<string, unknown[]> }
          settings.hooks.SessionStart?.unshift({ hooks: [{ type: 'command', command: 'echo new' }] })
          writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', step: 'settings', rolledBack: true })
    expect(result.outcome === 'failed' ? result.reason : '').toContain('settings.json changed during the move')
    expect(hookCommands(settingsPath)[0]).toBe('echo new')
  })

  it.each(['settings.json', 'CLAUDE.md', '.claude.json'])('a symlinked %s is refused with the reason, not replaced by a file', async (name) => {
    const path = join(sandbox.claudeHome, name)
    const real = join(sandbox.root, `real-${name}`)
    renameSync(path, real)
    symlinkSync(real, path)
    const before = treeOf(sandbox.root, everything)
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('refused')
    expect(result.outcome === 'refused' ? result.reason : '').toBe(`${path} is a symbolic link: the move would replace it with a file. Replace the link with the file it points to, or keep the rows that change it`)
    expect(treeOf(sandbox.root, everything)).toEqual(before)
    expect(lstatSync(path).isSymbolicLink()).toBe(true)
  })
})

describe('the IPC of a dev build on the real ~/.claude', () => {
  it('offer reads nothing and answers false; apply refuses before asking the plugin or showing the dialog', async () => {
    const saved = { WORFY_CLAUDE_HOME: process.env.WORFY_CLAUDE_HOME }
    delete process.env.WORFY_CLAUDE_HOME
    try {
      const handlers = (await import('../../src/main/ipc/harness-migration')).default
      const handle = (name: string, input: unknown): unknown => {
        const handler = handlers.find((entry) => entry.channel.name === name)
        if (handler === undefined) throw new Error(`no handler ${name}`)
        return handler.handle(input as never, { event: { sender: {} } } as never)
      }
      vi.mocked(hasLegacyHarness).mockClear()
      expect(await handle('harnessMigration.offer', undefined)).toEqual({ offered: false })
      expect(vi.mocked(hasLegacyHarness)).not.toHaveBeenCalled()
      const result = (await handle('harnessMigration.apply', { choices: {}, profiles: {} })) as { outcome: string; reason?: string }
      expect(result.outcome).toBe('refused')
      expect(result.reason).toMatch(/^a development build on the real ~\/\.claude does not move the Harness/)
      expect(installerCreated).not.toHaveBeenCalled()
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled()
    } finally {
      if (saved.WORFY_CLAUDE_HOME !== undefined) process.env.WORFY_CLAUDE_HOME = saved.WORFY_CLAUDE_HOME
    }
  })
})

/** `value` without `keys`. */
function omit(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The `node` of PATH, as a person would run restore.mjs. */
function findNode(): string {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, 'node')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('no node in PATH')
}
