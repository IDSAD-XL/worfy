// What harness-migrate.test.ts and harness-migrate-boundaries.test.ts both need: the sandbox each
// test runs in, and the helpers that build a plan, choose its rows and read the result. It is not a
// test file. The tests were split in two for worfy-windows ticket 28: the gate warns about a file
// longer than 1000 lines.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative, sep } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import type { HarnessState } from '../../src/shared/ipc/harness'
import type { MigrationChoice, MigrationPlan, MigrationSelection } from '../../src/shared/ipc/harness-migration'
import type { ApplyOptions } from '../../src/main/harness/migrate/apply'
import { removeTestTree } from '../remove'
import { buildPlan, hookRecords, type PlanOptions } from '../../src/main/harness/migrate/plan'

export const REPO = join(__dirname, '..', '..')
const FIXTURE = join(REPO, 'test', 'fixtures', 'claude-home-legacy')
const INSTALLED: HarnessState = { kind: 'installed', version: '0.2.0+aaaaaaa', enabled: true }

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

// The sandbox of the test that is running. makeSandbox sets it; a file that imports it reads the
// value of that moment.
export let sandbox: Sandbox

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

export function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: options.cwd, env: options.env ?? sandbox.env, input: options.input ?? '' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export function git(dir: string, ...args: string[]): string {
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

export function makeSandbox({ qmdInPlugin = false }: { qmdInPlugin?: boolean } = {}): Sandbox {
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

/** Makes a sandbox before each test of the file it is called in, and removes it after. */
export function useSandbox(): void {
  beforeEach(() => {
    makeSandbox()
  })

  // Not rmSync: the sandbox holds a git repository, whose objects are read-only files. Under the
  // Node of Electron 44 on Windows rmSync stops at such a file with EPERM, which failed the test and
  // left the folder behind (worfy-windows tickets 23 and 26).
  afterEach(() => {
    removeTestTree(sandbox.root)
  })
}

/**
 * Files (hash and mode) and folders of a tree: equal maps mean byte-equal trees. `.git` folders
 * and backups of a move are left out unless asked: a restore leaves its revert in the history.
 */
export function treeOf(dir: string, { skip = (rel: string) => rel.split(sep).includes('.git') || /(^|\/)worfy-harness\/backup-/.test(rel) } = {}): Record<string, string> {
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
export const everything = { skip: () => false }

export function planOptions(extra: Partial<PlanOptions> = {}): PlanOptions {
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

export const plan = (extra: Partial<PlanOptions> = {}): MigrationPlan => buildPlan(planOptions(extra)).view

/** Every row id with a choice: `remove` where offered (or what `pick` says), `keep` elsewhere. */
export function selection(view: MigrationPlan, pick: (id: string) => MigrationChoice | undefined = () => undefined, fields: MigrationSelection['profiles'] = {}): MigrationSelection {
  const rows = [...view.rows, ...(view.claudeMd?.sections ?? []), ...view.profiles]
  const choices = Object.fromEntries(rows.map((row) => [row.id, pick(row.id) ?? (row.choices.includes('remove') ? 'remove' : 'keep')]))
  const profiles = Object.fromEntries(view.profiles.map((profile) => [profile.name, fields[profile.name] ?? profile.fields]))
  return { choices, profiles }
}

export function applyOptions(extra: Partial<ApplyOptions> = {}): ApplyOptions {
  const rest = omit(planOptions() as unknown as Record<string, unknown>, 'pluginState') as unknown as Omit<PlanOptions, 'pluginState'>
  return { ...rest, pluginStatus: () => Promise.resolve(INSTALLED), confirm: () => Promise.resolve(true), now: () => new Date('2026-10-08T10:20:30Z'), ...extra }
}

export const read = (path: string): string => readFileSync(path, 'utf8')
export const readJson = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>
export const hookCommands = (settingsPath: string): string[] => hookRecords(readJson(settingsPath)).map((hook) => hook.command)
export const backupDir = (): string => join(sandbox.harnessHome, 'backup-2026-10-08-10-20-30')

/** `value` without `keys`. */
export function omit(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
}

/** The `node` of PATH, as a person would run restore.mjs. */
export function findNode(): string {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, 'node')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('no node in PATH')
}
