// worfy-harness ticket 14: the old Harness leaves ~/.claude by the "Remove / Keep" form, with a
// backup and a one-command restore. Every case runs in a sandbox: a copy of
// test/fixtures/claude-home-legacy/ in a temporary folder, its home/.claude a git repository standing
// in for ~/.claude (CLAUDE_CONFIG_DIR, so .claude.json lies inside it), the plugin `worfy` installed in
// home/.claude/worfy-harness/plugin/ (a copy of harness/), and `claude` a stub that logs its
// arguments. git, bin/profile, gate.mjs and restore.mjs run with HOME (and USERPROFILE, the home
// folder of node on Windows), CLAUDE_CONFIG_DIR and HARNESS_HOME of the sandbox. Nothing here
// touches the real ~/.claude.
//
// The cases about boundaries, races and changes after the move are in
// harness-migrate-boundaries.test.ts, and the sandbox is in harness-migrate-harness.ts
// (worfy-windows ticket 28: the gate's bound of 1000 lines).
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessState } from '../../src/shared/ipc/harness'
import type { MigrationChoice, MigrationStep } from '../../src/shared/ipc/harness-migration'
import { applyMigration, MIGRATION_STEPS } from '../../src/main/harness/migrate/apply'
import { quarantined } from '../quarantine'
import { removeTestTree } from '../remove'
import { claudeJsonPath, HARNESS_AGENTS, hasLegacyHarness, HARNESS_SKILLS, QMD_WARNING, RUNNING_SESSIONS_WARNING, type PlanOptions } from '../../src/main/harness/migrate/plan'
import { rewriteHarnessPaths } from '../../src/main/harness/migrate/profiles'
import { applyOptions, backupDir, everything, fileId, findNode, git, hookCommands, makeSandbox, omit, pathWithoutClaude, plan, planOptions, posix, read, readJson, REPO, run, sandbox, selection, treeOf, useSandbox } from './harness-migrate-harness'
import { ms } from '../time-scale'

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
// node:fs as it is, except that realpathSync.native can be made to throw for the paths under one
// folder, as it does on a volume the native call cannot read (some RAM or virtual drives).
const nativeFails = vi.hoisted(() => ({ under: null as string | null }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const realpathSync = Object.assign((path: string) => actual.realpathSync(path), {
    native: (path: string) => {
      // git prints `/` on Windows, worfy's own paths have `\`.
      const spelling = (path: string): string => path.replaceAll('\\', '/').toLowerCase()
      if (nativeFails.under !== null && spelling(path).startsWith(spelling(nativeFails.under))) {
        throw Object.assign(new Error(`EIO: i/o error, realpath '${path}'`), { code: 'EIO' })
      }
      return actual.realpathSync.native(path)
    },
  })
  return { ...actual, realpathSync, default: { ...actual, realpathSync } }
})

useSandbox()

// The same value as in harness-migrate-harness.ts, declared here too: TypeScript knows that it is the
// "installed" kind only in the file that declares it, and `{ ...INSTALLED, enabled: false }` needs that.
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

/** The link to a folder a user can make without a special right: a junction on Windows, a symlink elsewhere. */
const LINK_TO_A_FOLDER = process.platform === 'win32' ? 'junction' : 'dir'

const sub = (text: string): string => text.replaceAll('__SANDBOX__', sandbox.root)

/**
 * A path as the form shows it: under the user's home folder it starts with `~` (plan.ts, shown).
 * The sandbox lies under it on Windows, where the temporary folder is in the profile folder.
 */
const shown = (path: string): string => (path.startsWith(homedir() + sep) ? `~${path.slice(homedir().length)}` : path)

/**
 * The bridge file of a build on this system and the command the form writes for it with the
 * fixture's argument: the sh entry on macOS; on Windows the .mjs that node runs, its path with
 * forward slashes in double quotes (worfy-windows ticket 13).
 */
const BRIDGE_FILE = process.platform === 'win32' ? 'statusline-bridge.mjs' : 'statusline-bridge.sh'
const bridgeLine = (bridge: string): string =>
  process.platform === 'win32' ? `node '${bridge.replaceAll('\\', '/')}' 'bash ~/.claude/statusline.sh'` : `${bridge} 'bash ~/.claude/statusline.sh'`

describe('the plan of the form', () => {
  it('Q19 matches the plugin: the 3 agents and 7 skills of the old Harness are the ones harness/ carries', () => {
    expect(readdirSync(join(REPO, 'harness', 'agents')).sort()).toEqual([...HARNESS_AGENTS].sort())
    // connect-project came with the plugin (worfy-harness ticket 24), max-review with worfy-review ticket 07:
    // gate-queue with worfy-windows ticket 17: the old Harness never had them, so the migration plan does not offer to remove them.
    expect(readdirSync(join(REPO, 'harness', 'skills')).sort()).toEqual([...HARNESS_SKILLS, 'connect-project', 'gate-queue', 'max-review'].sort())
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
    const removable = files.filter((row) => row.choices.includes('remove')).map((row) => row.id)
    expect(removable.sort()).toEqual(
      [
        ...HARNESS_AGENTS.map((name) => `agents/${name}`),
        ...HARNESS_SKILLS.map((name) => `skills/${name}`),
        ...['epic-board', 'epic-status', 'preflight', 'profile', 'ticket', 'worktree-lock'].map((name) => `bin/${name}`),
        ...['gate-resolve.mjs', 'gate.sh', 'guard.mjs', 'session-end.sh', 'session-start.sh', 'stop.sh'].map((name) => `hooks/${name}`),
        'profiles/README.md',
      ]
        .map(fileId)
        .sort(),
    )
    // Names of Q19 the plugin does not carry: "Keep" only, marked.
    const kept = files.filter((row) => !row.choices.includes('remove'))
    expect(kept.map((row) => row.id).sort()).toEqual(['bin/tests', 'bin/ТИКЕТЫ.md', 'hooks/tests'].map(fileId).sort())
    for (const row of kept) {
      expect(row.choices).toEqual(['keep'])
      expect(row.note).toContain('not in the plugin')
    }

    expect(qmd?.detail?.split('\n')).toEqual([
      ...['qmd-mcp', 'qmd-refresh', 'qmd-sync-main'].map((name) => shown(join(sandbox.claudeHome, 'bin', name))),
      'Stop hook: $HOME/.claude/bin/qmd-refresh --quiet',
      `mcpServers.qmd in ${shown(sandbox.claudeJson)}`,
    ])
    expect(qmd?.defaultChoice).toBe('remove')
    expect(qmd?.note).toBe(QMD_WARNING)

    expect(view.rows.filter((row) => row.group === 'state').map((row) => row.id)).toEqual(['state:gate-config', 'state:gate-state', 'state:worktree-sessions'])
    expect(view.profiles.map((profile) => [profile.name, profile.fields])).toEqual([
      // `attribution` follows the proposed mode: off for Silent, on for Full.
      ['atakama', { mode: 'silent', languageDocs: 'en', attribution: 'off' }],
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
    const bridge = join(resources, BRIDGE_FILE)
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
    expect(offered?.detail).toBe(`becomes: ${bridgeLine(bridge)}`)
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
    // Joined with the separator of the system; CLAUDE_CONFIG_DIR resolved (on Windows `/cfg` gets a drive).
    expect(claudeJsonPath({ WORFY_CLAUDE_HOME: '/s/.claude', CLAUDE_CONFIG_DIR: '/other' }, '/s/.claude', '/home/me')).toBe(join('/s/.claude', '.claude.json'))
    expect(claudeJsonPath({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/me/.claude', '/home/me')).toBe(join(resolve('/cfg'), '.claude.json'))
    expect(claudeJsonPath({}, '/home/me/.claude', '/home/me')).toBe(join('/home/me', '.claude.json'))
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
    // The other home is resolved (on Windows it gets a drive); the rest of the path keeps its `/`.
    expect(rewriteHarnessPaths('~/.claude/gate/config.json', elsewhere)).toBe(`${resolve('/opt/harness')}/gate/config.json`)
  })

  it('attribution: a value the old Profile names is proposed as written, in both modes', () => {
    // Without the field the proposal follows the mode (the test above: atakama off, worfy on).
    const legacy = (name: string): string => join(sandbox.claudeHome, 'profiles', name, 'profile.json')
    writeFileSync(legacy('atakama'), JSON.stringify({ ...readJson(legacy('atakama')), attribution: 'on' }))
    writeFileSync(legacy('worfy'), JSON.stringify({ ...readJson(legacy('worfy')), attribution: 'off' }))
    // A value that is neither `on` nor `off` is not a choice: the mode decides.
    writeFileSync(legacy('auction'), JSON.stringify({ ...readJson(legacy('auction')), attribution: 'maybe' }))
    expect(plan().profiles.map((profile) => [profile.name, profile.fields.mode, profile.fields.attribution])).toEqual([
      ['atakama', 'silent', 'on'],
      ['auction', 'full', 'on'],
      ['worfy', 'full', 'off'],
    ])
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
    // A path with a character outside [\w./+@-] (on Windows the drive colon and the backslashes) is quoted: in double quotes on Windows.
    const script = join(backupDir(), 'restore.mjs')
    expect(result).toEqual({ outcome: 'done', backupDir: backupDir(), restoreCommand: process.platform === 'win32' ? `node "${script}"` : `node ${script}` })

    // Harness files: gone from ~/.claude, byte for byte in the backup.
    const after = treeOf(sandbox.claudeHome)
    const harnessRels = view.rows
      .filter((row) => row.group === 'files' && row.choices.includes('remove'))
      .map((row) => posix(row.id.slice('file:'.length)))
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

  it('Profiles: schema 2 in worfy-harness/projects, no paths of the old Harness, the form fields; bin/profile and gate.mjs find them', async () => {
    const view = plan()
    // The form's values differ from the proposed ones (worfy: full, ru, on).
    const result = await applyMigration(selection(view, undefined, { worfy: { mode: 'silent', languageDocs: 'en', attribution: 'off' } }), applyOptions())
    expect(result.outcome).toBe('done')
    const expected = { worfy: ['silent', 'en', 'off'], auction: ['full', 'ru', 'on'], atakama: ['silent', 'en', 'off'] }
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

    // bin/profile of harness/ (ticket 11) on the fixture repositories reads the form's mode. Started
    // as `node <script>`, as worfy starts the Harness scripts (ADR-0055): Windows has no shebang.
    const profileBin = join(REPO, 'harness', 'bin', 'profile')
    const worfyMode = run(findNode(), [profileBin, '-C', sandbox.repos.worfy, '--field', 'mode'])
    expect(worfyMode).toMatchObject({ status: 0, stdout: 'silent\n' })
    expect(run(findNode(), [profileBin, '-C', sandbox.repos.worfy, '--field', 'attribution'])).toMatchObject({ status: 0, stdout: 'off\n' })
    expect(run(findNode(), [profileBin, '-C', sandbox.repos.atakamaServer, '--field', 'mode'])).toMatchObject({ status: 0, stdout: 'silent\n' })
    // atakama moved with the proposed fields: Silent, so its attribution is off.
    expect(run(findNode(), [profileBin, '-C', sandbox.repos.atakamaServer, '--field', 'attribution'])).toMatchObject({ status: 0, stdout: 'off\n' })

    // Gate: registry and markers in worfy-harness/gate/; gate.mjs of harness/ finds the project.
    expect(read(join(sandbox.harnessHome, 'gate', 'config.json'))).toBe(read(join(backupDir(), 'claude', 'gate', 'config.json')))
    expect(existsSync(join(sandbox.harnessHome, 'gate', 'state', 'red-worfy-44f904e2'))).toBe(true)
    expect(existsSync(join(sandbox.harnessHome, 'worktree-sessions', 'sandbox-repos-worfy-0000aaaa.json'))).toBe(true)
    // The node of PATH, as a hook runs the gate — not process.execPath: that is Electron here (the
    // tests run under its Node), and in the closed environment of the sandbox it would start as
    // an app and never return. The time limit makes a start that hangs a failed test. SIGKILL, not
    // the SIGTERM of spawnSync: the gate has a handler of its own for SIGTERM, and that handler does
    // not run while the gate itself waits in spawnSync for git or a script that hangs.
    const gate = run(findNode(), [join(REPO, 'harness', 'hooks', 'gate.mjs'), 'fast'], { cwd: sandbox.repos.worfy, timeout: ms(60_000), killSignal: 'SIGKILL' })
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
    // git writes paths with `/`; the manifest with the separator of the system.
    for (const file of files) expect(manifest.claude.map(posix).some((rel) => file === rel || file.startsWith(`${rel}/`)), file).toBe(true)
    expect(files).toContain('settings.json')
    expect(files).toContain('bin/epic-status')
    expect(files).not.toContain('skills/cloudflare/SKILL.md')
    expect(git(sandbox.claudeHome, 'status', '--porcelain', '--', 'skills/cloudflare/SKILL.md').trim()).toBe('M skills/cloudflare/SKILL.md')
    expect(git(sandbox.claudeHome, 'log', '-1', '--format=%s')).toMatch(/^Move the old Harness out of ~\/\.claude/)
    expect(manifest.commits.claudeHome).toBe(git(sandbox.claudeHome, 'rev-parse', 'HEAD').trim())

    expect(realpathSync.native(git(sandbox.harnessHome, 'rev-parse', '--show-toplevel').trim())).toBe(realpathSync.native(sandbox.harnessHome))
    const committed = git(sandbox.harnessHome, 'ls-tree', '-r', '--name-only', 'HEAD').trim().split('\n')
    expect(committed).toEqual(expect.arrayContaining(['.gitignore', 'gate/config.json', 'projects/worfy/profile.json', 'projects/worfy/rules.md', 'projects/atakama/bin/tickets.mjs']))
    // State, not history: the plugin copy, markers, locks, backups and Profile state are not committed.
    for (const file of committed) expect(file).not.toMatch(/^(plugin|backup-|worktree-sessions|gate\/state)|\/state\//)
    expect(manifest.commits.harnessHome).toBe(git(sandbox.harnessHome, 'rev-parse', 'HEAD').trim())
  })

  // On a disk that ignores letter case (macOS, Windows) the folders may come in another case than git
  // prints them. The plain realpath keeps the case as typed, so before slice 3g of worfy-windows
  // ticket 14 ~/.claude did not count as the top of its repository and its commit was skipped.
  it('git: ~/.claude written in another letter case still gets its one commit', async (context) => {
    const other = join(dirname(sandbox.root), basename(sandbox.root).toUpperCase())
    context.skip(!existsSync(other), 'the disk tells letter case apart')
    const shout = (path: string): string => other + path.slice(sandbox.root.length)
    const homes = { claudeHome: shout(sandbox.claudeHome), harnessHome: shout(sandbox.harnessHome), claudeJson: shout(sandbox.claudeJson), userHome: shout(sandbox.home) }
    const head = git(sandbox.claudeHome, 'rev-parse', 'HEAD').trim()
    const result = await applyMigration(selection(plan(homes)), applyOptions(homes))
    expect(result.outcome).toBe('done')
    expect(git(sandbox.claudeHome, 'rev-list', '--count', `${head}..HEAD`).trim()).toBe('1')
    expect(git(sandbox.claudeHome, 'log', '-1', '--format=%s')).toMatch(/^Move the old Harness out of ~\/\.claude/)
  })

  // The plain realpath keeps an 8.3 short name or a `subst` drive, so it can only stand in when the
  // sandbox has neither (the runner's TEMP is C:\Users\RUNNER~1).
  it('git: when realpath(3) cannot read ~/.claude, the plain realpath still finds it is the top of its repository', async (context) => {
    context.skip(realpathSync(sandbox.root) !== realpathSync.native(sandbox.root), 'the sandbox is in an 8.3 short or subst spelling')
    const head = git(sandbox.claudeHome, 'rev-parse', 'HEAD').trim()
    nativeFails.under = sandbox.root
    try {
      expect(() => realpathSync.native(sandbox.claudeHome)).toThrow('EIO')
      const result = await applyMigration(selection(plan()), applyOptions())
      expect(result.outcome).toBe('done')
    } finally {
      nativeFails.under = null
    }
    // rev-list prints nothing when there is no new commit, and ''.split('\n') still has one item.
    expect(git(sandbox.claudeHome, 'rev-list', '--count', `${head}..HEAD`).trim()).toBe('1')
    expect(git(sandbox.claudeHome, 'log', '-1', '--format=%s')).toMatch(/^Move the old Harness out of ~\/\.claude/)
  })

  it('"Keep" on a row of each kind leaves that file or record untouched', async () => {
    const resources = join(sandbox.root, 'Resources')
    mkdirSync(resources)
    writeFileSync(join(resources, 'statusline-bridge.sh'), '#!/bin/sh\n')
    const options = { bridgeScript: join(resources, 'statusline-bridge.sh') }
    const view = plan(options)
    const stopHook = view.rows.find((row) => row.group === 'hooks' && row.label === '$HOME/.claude/hooks/stop.sh')
    const kept = new Set([fileId('agents/scout.md'), fileId('hooks/stop.sh'), stopHook?.id, 'status-line', 'profile:auction', 'claude-md:3:Default loop'])
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
    const bridge = join(sandbox.root, 'Resources', BRIDGE_FILE)
    mkdirSync(dirname(bridge))
    writeFileSync(bridge, '#!/bin/sh\n')
    const before = readJson(join(sandbox.claudeHome, 'settings.json')).statusLine as Record<string, unknown>
    const result = await applyMigration(selection(plan({ bridgeScript: bridge })), applyOptions({ bridgeScript: bridge }))
    expect(result.outcome).toBe('done')
    expect(readJson(join(sandbox.claudeHome, 'settings.json')).statusLine).toEqual({ ...before, command: bridgeLine(bridge) })
  })

  // Windows: 29.9 s in a full run on the PC (main aa27fa89, 2026-10-19 22:55-23:20); twice that.
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
  }, process.platform === 'win32' ? ms(60_000) : undefined)

  quarantined('harness-migrate-toolbar-offer')('the toolbar offer: there before a move, gone after a move with the defaults, there while a Harness file is kept', async () => {
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
    const keepScout = (id: string): MigrationChoice | undefined => (id === fileId('agents/scout.md') ? 'keep' : (again.claudeMd?.sections.find((section) => section.id === id)?.defaultChoice))
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
    outside: treeOf(sandbox.root, { skip: (rel) => rel === 'home/.claude' || rel === 'claude-calls.log' }),
  })

  // On Windows the stand-in claude is not called: restore.mjs starts `claude` by name without a shell
  // (restore.ts, spawnSync), and there that finds only a claude.exe or claude.com, never the
  // `#!/bin/sh` stand-in. So on Windows the run has no claude on PATH and the test checks the printed
  // disable command instead of the stand-in's log; every other check runs on all systems.
  it('node restore.mjs, a separate process: exit 0, ~/.claude and .claude.json as before the move, the commit reverted, the plugin disabled', async () => {
    const before = snapshot()
    const head = git(sandbox.claudeHome, 'rev-parse', 'HEAD').trim()
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('done')
    const node = findNode()
    const windows = process.platform === 'win32'
    const PATH = windows ? pathWithoutClaude() : [sandbox.stubDir, '/usr/bin', '/bin'].join(delimiter)
    const env = { ...sandbox.env, PATH, STUB_CLAUDE_LOG: sandbox.stubLog }
    const restored = run(node, [join(backupDir(), 'restore.mjs')], { env, cwd: sandbox.root })
    expect(restored.stderr).toBe('')
    expect(restored.status).toBe(0)
    if (windows) expect(restored.stdout).toContain('claude plugin disable worfy@worfy-harness --scope user')
    else expect(read(sandbox.stubLog)).toBe('plugin disable worfy@worfy-harness --scope user\n')
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
    const restored = run(node, [join(backupDir(), 'restore.mjs')], { env: { ...sandbox.env, PATH: pathWithoutClaude() }, cwd: sandbox.root })
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
    expect(treeOf(sandbox.root, { skip: (rel) => rel === 'home/.claude' || rel === 'claude-calls.log' })).toEqual(before.outside)
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
    ['outdated', { kind: 'outdated', from: '0.1.0', to: '0.2.0', sameVersion: false }],
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
    delete stale.choices[fileId('agents/scout.md')]
    expect(await applyMigration(stale, applyOptions())).toEqual({ outcome: 'refused', reason: '~/.claude changed since the form was opened: open it again' })
    const stopHook = view.rows.find((row) => row.label === '$HOME/.claude/hooks/stop.sh')?.id
    const broken = await applyMigration(selection(view, (id) => (id === stopHook ? 'keep' : undefined)), applyOptions())
    expect(broken.outcome === 'refused' ? broken.reason : '').toContain(`runs ${join('hooks', 'stop.sh')}, which would be removed`)
    const notOffered = selection(view, (id) => (id === fileId('bin/tests') ? 'remove' : undefined))
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

  // On Windows one folder has spellings that are not links: another letter case, `/` for `\`, an
  // 8.3 short name, a `subst` drive. The plain realpath keeps them as typed, so the home folder in
  // another spelling went past the refusal. The case spelling is the one every disk that ignores
  // letter case has; the home folder of this PC has no 8.3 name and no `subst` drive over it.
  const homeSpelledOtherwise = (): string | null => {
    const home = homedir()
    const swapped = home === home.toUpperCase() ? home.toLowerCase() : home.toUpperCase()
    const spelled = process.platform === 'win32' ? swapped.replaceAll('\\', '/') : swapped
    try {
      const [a, b] = [statSync(home), statSync(spelled)]
      return a.ino === b.ino && a.dev === b.dev ? spelled : null
    } catch {
      return null
    }
  }
  /** Options whose plugin state and confirmation fail the test: a move that went past the home check stops there. */
  const stopPastTheHomeCheck = (claudeHome: string): { options: ReturnType<typeof applyOptions>; asked: () => boolean } => {
    let asked = false
    const options = applyOptions({
      claudeHome,
      pluginStatus: () => {
        asked = true
        return Promise.reject(new Error('the move went past the check of the home folder'))
      },
      confirm: () => Promise.reject(new Error('the move went past the check of the home folder')),
    })
    return { options, asked: () => asked }
  }

  it('refuses the user home folder in another spelling: another letter case, and `/` on Windows', async (context) => {
    const spelled = homeSpelledOtherwise()
    context.skip(spelled === null, 'the disk of the home folder tells letter case apart')
    if (spelled === null) return
    const { options, asked } = stopPastTheHomeCheck(spelled)
    expect(await applyMigration(selection(plan()), options)).toEqual({ outcome: 'refused', reason: `the Claude home ${spelled} is not a folder the move may write in` })
    expect(asked()).toBe(false)
  })

  it('refuses the user home folder when realpath(3) cannot read it, through the plain realpath', async () => {
    const { options, asked } = stopPastTheHomeCheck(homedir())
    const chosen = selection(plan())
    nativeFails.under = homedir()
    try {
      expect(() => realpathSync.native(homedir())).toThrow('EIO')
      expect(await applyMigration(chosen, options)).toEqual({ outcome: 'refused', reason: `the Claude home ${homedir()} is not a folder the move may write in` })
    } finally {
      nativeFails.under = null
    }
    expect(asked()).toBe(false)
  })

  it('a move writes nothing outside ~/.claude of the sandbox and nothing into the repositories of Projects (ADR-0005)', async () => {
    const outside = treeOf(sandbox.root, { skip: (rel) => rel === 'home/.claude' })
    const repos = treeOf(join(sandbox.root, 'repos'), everything)
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('done')
    expect(treeOf(sandbox.root, { skip: (rel) => rel === 'home/.claude' })).toEqual(outside)
    expect(treeOf(join(sandbox.root, 'repos'), everything)).toEqual(repos)
    // Inside ~/.claude only the move's own places changed: no stray temporary files.
    expect(readdirSync(sandbox.claudeHome).filter((name) => name.includes('worfy-move'))).toEqual([])
    expect(lstatSync(backupDir()).isDirectory()).toBe(true)
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

describe('the consent dialog', () => {
  it('names the same quoted restore command as the form after the move', async () => {
    const { migrationConfirmationText } = await import('../../src/main/ipc/harness-migration')
    // Only the text is built: nothing is read from the folder. A fixed one, so the expected quoting
    // does not depend on where the repository is (a quote in its path).
    const dir = process.platform === 'win32' ? 'C:\\backup with space' : '/backup with space'
    const script = join(dir, 'restore.mjs')
    const { detail } = migrationConfirmationText({ removed: 1, hooks: 0, sections: 0, moved: 0, statusLine: false, qmd: false, backupDir: dir })
    expect(detail).toContain(`To undo the move: ${process.platform === 'win32' ? `node "${script}"` : `node '${script}'`}\n`)
  })
})

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
