// The parity suite of the workflow guarantees on Codex (worfy-multi-vendor ticket 45; the spec's section on
// the workflow guarantees on Codex): Codex keeps exactly the guarantees of the Harness that Claude Code keeps today, and
// no stricter one. GUARANTEES below is the table: each row names the guarantee, the scenario that shows it
// on Codex and the Claude test that proves the same guarantee under Claude Code. The checks of the table:
//   - every guarantee the Harness README lists under «On Codex» has a row, and every row that names one
//     names a guarantee the README still lists: a new guarantee without a row is red here;
//   - every Claude test a row names exists and still has the check the row cites (a line of it, by its
//     text, not its number): a renamed test or a dropped check is red until the table follows;
//   - every row passes its scenario, below.
// Not rows, on purpose: what the README names as weaker on Codex (the mcp__* tools and spawn_agent of a
// read-only agent), and what Codex is held to beyond Claude Code (the interactive shell an agent of the
// Harness may not open, a reviewer's shell writes): a row may ask of Codex only what its Claude test
// proves of Claude Code.
//
// The scenarios run on the fake app-server (WORFY_CODEX=fake, test/fixtures/codex-app-server/), which
// runs the hooks of the plugins in CODEX_HOME as the pinned Codex runs them and keeps the sandbox of a
// thread (ticket 44), with the scripts parity-*.jsonl of test/fixtures/codex-scripts/. The Harness is
// installed into a temporary CODEX_HOME by worfy's own installer (src/main/harness/codex-install.ts,
// ticket 35), with a stand-in `codex` CLI that lays the plugin into Codex's plugin cache, and its hooks
// are approved the way a user approves them in /hooks (approvePluginHooks). Each run has a gate
// registry, a gate state, a Harness home and a HOME of its own, and a stand-in for bin/profile: the
// hooks read and write nothing of the machine's own Harness, ~/.claude or ~/.codex. The real Codex
// never runs. The Claude side is not touched: the fake of Claude Code runs no hooks.
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { accountAuth, ghRunner } from '../../src/main/github/prs'
import { CODEX_AGENT_PREFIX } from '../../src/main/harness/codex-agents'
import { CodexHarness } from '../../src/main/harness/codex-install'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexLaunch } from '../../src/main/vendors/codex/launch'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { approvePluginHooks, type HookRun } from '../fixtures/codex-app-server/hook-runner.mjs'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const WINDOWS = process.platform === 'win32'
/** One deadline for all the messages a scenario waits for: its Stops run the gate. */
const TURN_MS = ms(60_000)
const SETUP_MS = ms(90_000)
/** The most a SessionEnd hook gets on Codex (hook-runner.mjs, timeoutSec): Codex's own limit, not a test limit, so not scaled. */
const CODEX_SESSION_END_MS = 3000
const ACCOUNT = 'octo-org'
const TOKEN = 'token-of-octo-org'

/** A Claude test that proves a guarantee under Claude Code: the file, and the text of the check the row relies on. */
interface ClaudeProof {
  file: string
  check: string
}

interface Guarantee {
  row: number
  guarantee: string
  /** The guarantee of the README's «On Codex» table this row stands for; null for a row the README does not list. */
  readme: string | null
  codex: string
  /** The Claude tests; none only where Claude Code has nothing to prove (`claudeNone` says why). */
  claude: ClaudeProof[]
  claudeNone?: string
}

const GUARANTEES: Guarantee[] = [
  {
    row: 1,
    guarantee: 'reviewer and scout edit no file with an edit tool',
    readme: 'A read-only reviewer and scout',
    codex: 'apply_patch (a fileChange item) of worfy-reviewer and worfy-scout is denied and no file changes; their shell commands run, as Bash of a Claude reviewer does',
    claude: [
      { file: 'harness/bin/tests/agents-text.test.sh', check: "TOOLS='tools: Read, Grep, Glob, Bash, mcp__plugin_worfy_qmd__query, mcp__plugin_worfy_qmd__get, mcp__plugin_worfy_qmd__multi_get, mcp__plugin_worfy_qmd__status'" },
      { file: 'harness/bin/tests/agents-text.test.sh', check: 'for a in reviewer scout; do' },
    ],
  },
  {
    row: 2,
    guarantee: 'a turn does not end while the gate is red',
    readme: 'The gate before the work ends',
    codex: 'Stop with a red gate keeps the turn going with the reason; with a green gate the turn ends',
    claude: [
      { file: 'harness/bin/tests/harness-home.test.sh', check: 'check "default: stop.mjs reads the red marker from the new place (exit 2)"' },
      { file: 'harness/hooks/tests/gate-notverified.test.sh', check: 'check "stop: broken config + red marker -> red message"' },
      // The two halves in one cycle of the gate (red holds, a later green lets go): added by this ticket.
      { file: 'harness/hooks/tests/stop-gate-cycle.test.sh', check: 'ok "red gate: Stop exits 2 with the reason on stderr, the turn goes on"' },
      { file: 'harness/hooks/tests/stop-gate-cycle.test.sh', check: 'ok "green gate: Stop exits 0 and says nothing, the turn ends"' },
    ],
  },
  {
    row: 3,
    guarantee: 'a Subagent does not end its work while the gate is red',
    readme: 'The gate before the work ends',
    codex: 'SubagentStop of worfy-implementer with a red gate keeps its turn going with the reason; with a green gate it ends',
    claude: [
      { file: 'harness/hooks/tests/rules-hooks.test.sh', check: 'TaskCompleted||$R/hooks/gate.sh" fast|900' },
      { file: 'harness/hooks/tests/rules-hooks.test.sh', check: 'TeammateIdle||$R/hooks/gate.sh" fast|900' },
      { file: 'harness/hooks/tests/gate-verdict.test.sh', check: 'verdict "red run (full) -> outcome red, exit 2, profile full"' },
      // hooks.json starts the gate through gate.sh: its red is exit 2 as gate.mjs's is.
      { file: 'harness/hooks/tests/gate-shim.test.sh', check: 'same "red, and the profile argument is passed on: exit 2 and «red (full)» by both names" 2' },
    ],
  },
  {
    row: 4,
    guarantee: 'the Bash guard',
    readme: 'The Bash guard',
    codex: 'the commands the Claude test refuses (`git reset --hard`, a pipe that loses the exit code) are denied, of the main agent and of a reviewer; the same pipe under `set -o pipefail` runs',
    claude: [
      { file: 'harness/hooks/tests/guard-silent.test.sh', check: `expect "full: git reset --hard is still refused" deny "$FR" 'git reset --hard' 'reset --hard'` },
      { file: 'harness/hooks/tests/guard-silent.test.sh', check: `expect "full: a pipe that eats the exit code is still refused" deny "$FR" 'pnpm test | tail -5' 'pipe eats the exit code'` },
    ],
  },
  {
    row: 5,
    guarantee: 'the rule on writes to ~/.claude',
    readme: null,
    codex: 'the TOML agents worfy-implementer and worfy-reviewer the installer writes carry the rule the Claude test finds in implementer.md and reviewer.md',
    claude: [
      { file: 'harness/bin/tests/agents-text.test.sh', check: "WRITE_RULE='Write to the Claude configuration directory only if the brief says `Write to ~/.claude: allowed`.'" },
      { file: 'harness/bin/tests/agents-text.test.sh', check: 'for a in implementer reviewer; do' },
    ],
  },
  {
    row: 6,
    guarantee: 'a review verdict in the PR',
    readme: 'Review verdicts',
    codex: 'worfy-reviewer posts its verdict with `gh pr comment`, the guard lets it run, and the gh of that shell has GH_TOKEN of the Profile\'s account from the environment of the app-server process',
    claude: [
      { file: 'harness/hooks/tests/gh-token-env.test.sh', check: 'ok "account with login: sourcing the env file gives GH_TOKEN from gh"' },
      { file: 'harness/bin/tests/max-review.test.sh', check: `check "max-review: written as a PR comment" has 'gh pr comment <N> --body "MAX-REVIEW: VERIFIED"'` },
    ],
  },
  {
    row: 7,
    guarantee: 'the Harness rules at the start of a Session and of a Subagent',
    readme: 'Rules at the start',
    codex: 'SessionStart gives the parts orchestrator and common, SubagentStart of a reviewer and a scout gives common, each as the Claude test expects it: the part file with the plugin root filled in',
    claude: [
      { file: 'harness/hooks/tests/rules-hooks.test.sh', check: 'for ev in SessionStart SubagentStart; do' },
      { file: 'harness/hooks/tests/rules-hooks.test.sh', check: `expected="$(sed 's#\${CLAUDE_PLUGIN_ROOT}#/opt/worfy-plugin#g' "$RULES/$part.md")"` },
      { file: 'harness/hooks/tests/rules-hooks.test.sh', check: 'SubagentStart||$N/hooks/inject-rules.mjs" common|10' },
    ],
  },
  {
    row: 8,
    guarantee: 'Session bookkeeping',
    readme: 'Session bookkeeping',
    codex: 'SessionEnd, when worfy closes the app-server, records the Session for /retro and ends within the 3 s Codex gives it',
    claude: [{ file: 'harness/hooks/tests/session-hooks.test.sh', check: 'ok "session-end appends time<TAB>cwd ($n lines)"' }],
  },
  {
    row: 9,
    guarantee: 'the hooks are on',
    readme: null,
    codex: 'without an approval of their hashes the fake runs no hook of the Harness, and with plugin contents changed after the approval none runs either: rows 1–8 then do not hold, which is why a Run on Codex refuses to start without the approval (ticket 39)',
    claude: [],
    claudeNone: 'the hooks of a Claude Code plugin are always on',
  },
]

// --- The table -----------------------------------------------------------------------------------------

/** The first column of the table of the README's «## On Codex» section. */
function readmeGuarantees(): string[] {
  const text = readFileSync(join(HARNESS, 'README.md'), 'utf8').replace(/\r\n/g, '\n')
  const start = text.indexOf('\n## On Codex\n')
  expect(start, 'harness/README.md has a section «## On Codex»').toBeGreaterThan(-1)
  const section = text.slice(start + 1).split(/\n## /)[0] ?? ''
  const table = section.split('\n').filter((line) => line.startsWith('|'))
  // The header, the separator, then one row per guarantee.
  return table.slice(2).map((line) => (line.split('|')[1] ?? '').trim())
}

/** A comment line of a shell or TypeScript test: a check cited there would prove nothing. */
const COMMENT_LINE = /^\s*(#|\/\/|\*)/

describe('the table of guarantees', () => {
  it('has the rows 1 to 9 in order, each with a Claude test or the reason Claude Code needs none', () => {
    expect(GUARANTEES.map((row) => row.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (const row of GUARANTEES) expect(row.claude.length > 0 || (row.claudeNone ?? '') !== '', `row ${row.row}`).toBe(true)
  })

  it('has a row for every guarantee the Harness README lists «On Codex», and names none the README dropped', () => {
    const listed = readmeGuarantees()
    expect(listed.length).toBeGreaterThan(0)
    const named = new Set(GUARANTEES.map((row) => row.readme).filter((name): name is string => name !== null))
    expect(listed.filter((name) => !named.has(name)), 'guarantees of the README without a row').toEqual([])
    expect([...named].filter((name) => !listed.includes(name)), 'rows that name a guarantee the README does not list').toEqual([])
  })

  it('names Claude tests that exist and still have the check the row relies on', () => {
    for (const row of GUARANTEES) {
      for (const proof of row.claude) {
        const file = join(REPO, proof.file)
        expect(existsSync(file), `row ${row.row}: ${proof.file} exists`).toBe(true)
        const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
        expect(lines.findIndex((line) => !COMMENT_LINE.test(line) && line.includes(proof.check)), `row ${row.row}: ${proof.file} has the check ${proof.check}`).toBeGreaterThan(-1)
      }
    }
  })

  it('takes the commands of row 4 from its Claude test: the scenario runs the same ones', () => {
    const scripted = scriptSteps('parity-guards').filter((step) => step.tool === 'Bash').map((step) => (step.input as { command: string }).command)
    for (const [command] of refusedByClaude()) expect(scripted).toContain(command)
  })
})

// --- The world: the Harness installed into Codex, the projects, the runs -------------------------------

interface Message {
  id?: number | string
  method?: string
  params?: Record<string, unknown> & { item?: Record<string, unknown> & { id?: string; type?: string }; run?: HookRun; threadId?: string; turnId?: string | null }
  result?: unknown
  error?: { code: number; message: string }
}

interface ScriptStep {
  tool?: string
  input?: unknown
  [key: string]: unknown
}

const scriptSteps = (name: string): ScriptStep[] =>
  readFileSync(join(REPO, 'test', 'fixtures', 'codex-scripts', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ScriptStep)

/** The commands row 4's Claude test refuses, each with the words its refusal must say: [command, words]. */
function refusedByClaude(): [string, string][] {
  const text = readFileSync(join(REPO, 'harness', 'hooks', 'tests', 'guard-silent.test.sh'), 'utf8')
  return GUARANTEES[3]!.claude.map((proof) => {
    expect(text).toContain(proof.check)
    const quoted = [...proof.check.matchAll(/'([^']*)'/g)].map((match) => match[1] as string)
    return [quoted[0] as string, quoted[1] as string]
  })
}

// Codex's side of the install (worfy-multi-vendor ticket 35's commands): the state of marketplaces and
// plugins in STUB_STATE, outside CODEX_HOME. `plugin add` of a plugin from a local marketplace lays the
// marketplace folder (the plugin, source "./") into <CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/local,
// where the fake's hook engine finds installed plugins (hook-runner.mjs, installedPlugins), as
// harness-codex-hooks.test.ts lays it out by hand.
const CODEX_STUB = `
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
const path = process.env.STUB_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') {
  process.stdout.write(JSON.stringify({ marketplaces: Object.entries(state.marketplaces).map(([name, source]) => ({ name, path: source })) }))
} else if (command === 'plugin marketplace add') {
  state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
} else if (command === 'plugin add') {
  const [name, market] = args[2].split('@')
  const source = state.marketplaces[market]
  if (source === undefined) {
    process.stderr.write('marketplace ' + market + ' not found\\n')
    process.exit(1)
  }
  if (isAbsolute(source)) {
    cpSync(source, join(process.env.CODEX_HOME, 'plugins', 'cache', market, name, 'local'), { recursive: true })
    state.plugins[args[2]] = manifest(source, 'plugin.json').version
  } else state.plugins[args[2]] = '1.4.0'
} else if (command === 'plugin list') {
  const marketplaces = Object.keys(state.marketplaces).map((market) => ({
    name: market,
    plugins: Object.entries(state.plugins).filter(([id]) => id.endsWith('@' + market)).map(([id, version]) => ({ id, name: id.split('@')[0], localVersion: version, installed: true, enabled: true })),
  }))
  process.stdout.write(JSON.stringify({ marketplaces }))
} else {
  process.stderr.write('codex stand-in: unsupported command: ' + args.join(' ') + '\\n')
  process.exit(2)
}
writeFileSync(path, JSON.stringify(state))
`

// The gh of a Session's shell and of worfy's token lookup: logs "<GH_TOKEN or <unset>>\\t<arg>…" to
// GH_STUB_LOG; `auth token -u <GH_STUB_ACCOUNT>` prints GH_STUB_TOKEN, `pr comment` posts nothing and
// prints the URL of a comment.
const GH_STUB = `
import { appendFileSync, writeSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.GH_STUB_LOG, [process.env.GH_TOKEN ?? '<unset>', ...args].join('\\t') + '\\n')
if (args[0] === 'auth' && args[1] === 'token' && args[2] === '-u' && args[3] === process.env.GH_STUB_ACCOUNT) {
  writeSync(1, process.env.GH_STUB_TOKEN + '\\n')
  process.exit(0)
}
if (args[0] === 'pr' && args[1] === 'comment') {
  writeSync(1, 'https://github.com/' + process.env.GH_STUB_ACCOUNT + '/fixture/pull/' + args[2] + '#issuecomment-1\\n')
  process.exit(0)
}
writeSync(2, 'gh stand-in: unsupported command: ' + args.join(' ') + '\\n')
process.exit(2)
`

let root: string
/** CODEX_HOME with the Harness installed and its hooks approved; and the same install before the approval. */
let approvedHome: string
let unapprovedHome: string
let ghStub: string

const pluginRootOf = (codexHome: string) => join(codexHome, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local')

/** A Harness copy of this build as the app bundles it: harness/ without its tests, with a version stamped. */
function bundle(target: string): void {
  const tests = [join('bin', 'tests'), join('hooks', 'tests')]
  cpSync(HARNESS, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(HARNESS, path)
      return !path.endsWith(`${sep}.DS_Store`) && !tests.some((dir) => inside === dir || inside.startsWith(`${dir}${sep}`))
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const { name, ...rest } = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  writeFileSync(manifestPath, `${JSON.stringify({ name, version: '0.45.0+parity1', ...rest }, null, 2)}\n`)
}

beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-parity-')))
  const bundled = join(root, 'bundled')
  bundle(bundled)
  // <harnessHome>/plugin: the copy the Claude install keeps, Codex's local marketplace (install.ts).
  const pluginDir = join(root, 'harness-home', 'plugin')
  cpSync(bundled, pluginDir, { recursive: true })
  const stubs = join(root, 'stubs')
  mkdirSync(stubs)
  writeFileSync(join(stubs, 'codex.mjs'), CODEX_STUB)
  ghStub = join(stubs, 'gh.mjs')
  writeFileSync(ghStub, GH_STUB)
  unapprovedHome = join(root, 'codex-unapproved')
  mkdirSync(unapprovedHome)
  const installer = new CodexHarness({
    bundledDir: bundled,
    pluginDir,
    codex: join(stubs, 'codex.mjs'),
    env: { PATH: process.env.PATH, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), CODEX_HOME: unapprovedHome, STUB_STATE: join(stubs, 'codex-state.json') },
    codexHome: unapprovedHome,
    recordFile: join(root, 'data', 'harness-codex.json'),
  })
  const plan = await installer.plan()
  expect(plan, 'the installer has something to do in an empty CODEX_HOME').not.toBeNull()
  await installer.apply(plan!)
  expect((await installer.status())?.state).toEqual({ kind: 'installed', version: '0.45.0+parity1' })
  expect(existsSync(join(pluginRootOf(unapprovedHome), 'hooks', 'hooks.json'))).toBe(true)
  // The user approves the hooks in Codex's /hooks: the same install, then the approval.
  approvedHome = join(root, 'codex-home')
  cpSync(unapprovedHome, approvedHome, { recursive: true })
  expect(approvePluginHooks(approvedHome).length).toBeGreaterThan(0)
}, SETUP_MS)

afterAll(() => removeTestTree(root))

interface Project {
  dir: string
  work: string
  state: string
  profileDir: string
  env: NodeJS.ProcessEnv
}

/** Variables of the test's own environment that would point a hook at the machine's own Harness, gate, gh or qmd. */
const MACHINE_VARIABLES = /^(CLAUDE_|HARNESS_HOME$|EVAL_HARNESS_HOME$|GATE_|GH_TOKEN$|GITHUB_TOKEN$|QMD_|XDG_|WORFY_CODEX)/i

/**
 * A registered project for one run: a git worktree with status.txt, whose first line is what its one gate
 * script `check` passes on (ok) or fails on; its registry, gate state, Harness home, HOME and a stand-in
 * bin/profile that names a profile with session.retro_reminder_after. `env` is the environment of the fake.
 */
function project(name: string): Project {
  const dir = join(root, name)
  const work = join(dir, 'project')
  mkdirSync(work, { recursive: true })
  writeFileSync(join(work, 'package.json'), '{ "name": "fixture", "scripts": { "check": "true" } }\n')
  writeFileSync(join(work, 'README.md'), '# Project\n')
  writeFileSync(join(work, 'status.txt'), 'ok\n')
  const git = (...args: string[]) => spawnSync('git', ['-C', work, ...args], { stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  const status = join(work, 'status.txt')
  const pm = join(dir, WINDOWS ? 'fakepm.cmd' : 'fakepm')
  writeFileSync(
    pm,
    WINDOWS ? `@echo off\r\nset /p m=<"${status}"\r\nif "%m%"=="ok" exit /b 0\r\necho Tests 1 failed\r\nexit /b 1\r\n` : `#!/bin/sh\n[ "$(head -n 1 "${status}")" = ok ] && exit 0\necho "Tests 1 failed"\nexit 1\n`,
  )
  if (!WINDOWS) chmodSync(pm, 0o755)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ repos: [{ key: 'p', match: work, pm, root: { fast: ['check'] }, workspace: {} }] }))
  const profileDir = join(dir, 'profile')
  mkdirSync(profileDir)
  const profileBin = join(dir, 'profile.mjs')
  writeFileSync(profileBin, `process.stdout.write(${JSON.stringify(JSON.stringify({ name: 'fixture', session: { retro_reminder_after: 3 }, _resolved: { name: 'fixture', dir: profileDir } }))})\n`)
  const home = join(dir, 'home')
  mkdirSync(home)
  const own = Object.fromEntries(Object.entries(process.env).filter(([key]) => !MACHINE_VARIABLES.test(key)))
  const env: NodeJS.ProcessEnv = {
    ...own,
    WORFY_CODEX: 'fake',
    HOME: home,
    // os.homedir() on Windows.
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    HARNESS_HOME: join(dir, 'harness-home'),
    CLAUDE_GATE_CONFIG: join(dir, 'config.json'),
    CLAUDE_GATE_STATE: join(dir, 'state'),
    CLAUDE_PROFILE_BIN: profileBin,
    GATE_SCOPE: 'all',
  }
  return { dir, work, state: join(dir, 'state'), profileDir, env }
}

/** What one run of the fake sent, and how it ended. */
class Played {
  constructor(
    readonly seen: Message[],
    readonly stderr: string,
  ) {}

  /** The hook runs of `event` (camelCase, as the protocol names it) that completed, in order. */
  runs(event: string, threadId?: string): HookRun[] {
    return this.seen
      .filter((message) => message.method === 'hook/completed' && message.params?.run?.eventName === event && (threadId === undefined || message.params.threadId === threadId))
      .map((message) => message.params?.run as HookRun)
  }

  /** The PreToolUse runs of the tool call `itemId`. */
  toolRuns(itemId: string): HookRun[] {
    return this.runs('preToolUse').filter((run) => run.id.endsWith(`:${itemId}`))
  }

  started(itemId: string): boolean {
    return this.seen.some((message) => message.method === 'item/started' && message.params?.item?.id === itemId)
  }

  completed(itemId: string): Record<string, unknown> | undefined {
    return this.seen.find((message) => message.method === 'item/completed' && message.params?.item?.id === itemId)?.params?.item
  }

  /** The indexes of the messages that match, in order. */
  where(match: (message: Message) => boolean): number[] {
    return this.seen.flatMap((message, index) => (match(message) ? [index] : []))
  }

  turnsCompleted(threadId: string): number[] {
    return this.where((message) => message.method === 'turn/completed' && message.params?.threadId === threadId)
  }

  hookPrompts(threadId: string): { index: number; texts: string[] }[] {
    return this.where((message) => message.method === 'item/completed' && message.params?.item?.type === 'hookPrompt' && message.params.threadId === threadId).map((index) => ({
      index,
      texts: ((this.seen[index]?.params?.item?.fragments ?? []) as { text: string }[]).map((fragment) => fragment.text),
    }))
  }

  hookStarts(): number {
    return this.where((message) => message.method === 'hook/started').length
  }
}

/**
 * The messages of one scenario as they come, with one deadline for every wait of the scenario (waits do not
 * stack), and a wait that fails at once on a hook prompt the script does not expect: a Stop that holds a
 * turn it should let end makes a held turn red in seconds, not at the deadline.
 */
class Watch {
  readonly seen: Message[] = []
  private readonly deadline = Date.now() + TURN_MS
  private readonly prompts = new Map<string, number>()
  private failure: string | undefined
  private wake: () => void = () => undefined

  /** `maxPrompts`: how many hook prompts (turns a Stop held) each thread may get by the script. */
  constructor(
    private readonly maxPrompts: number,
    private readonly stderr: () => string = () => '',
  ) {}

  add(message: Message): void {
    this.seen.push(message)
    if (message.method === 'item/completed' && message.params?.item?.type === 'hookPrompt') {
      const thread = String(message.params.threadId)
      const count = (this.prompts.get(thread) ?? 0) + 1
      this.prompts.set(thread, count)
      if (count > this.maxPrompts) this.fail(`hook prompt ${count} on ${thread}, where the script expects at most ${this.maxPrompts}: a Stop held a turn it should have let end`)
    }
    this.wake()
  }

  /** Makes every wait fail at once with `why` (the first reason stays). */
  fail(why: string): void {
    this.failure ??= why
    this.wake()
  }

  /** The first message that matches; rejects at the scenario's deadline or at the first failure. */
  next(match: (message: Message) => boolean): Promise<Message> {
    return new Promise((resolve, reject) => {
      const stop = (why: string) => {
        clearTimeout(timer)
        this.wake = () => undefined
        reject(new Error(`${why}; the fake sent ${JSON.stringify(this.seen).slice(-4000)}; stderr: ${this.stderr()}`))
      }
      const timer = setTimeout(() => stop('the fake sent no such message before the deadline of the scenario'), Math.max(0, this.deadline - Date.now()))
      const look = () => {
        if (this.failure !== undefined) return stop(this.failure)
        const found = this.seen.find(match)
        if (found === undefined) return
        clearTimeout(timer)
        this.wake = () => undefined
        resolve(found)
      }
      this.wake = look
      look()
    })
  }
}

const mainTurnDone = (message: Message) => message.method === 'turn/completed' && message.params?.threadId === 'thr_fake_1'

/**
 * Plays the script `script` on the fake with `codexHome` as worfy does, for one turn: initialize, thread/start
 * in the project's worktree, turn/start; then closes its stdin (the end of the Session: SessionEnd runs) and
 * waits for it to exit. `endMs`: from the close to the exit. `maxPrompts`: the hook prompts the script
 * expects on each thread (Watch).
 */
async function play(script: string, codexHome: string, p: Project, maxPrompts = 0): Promise<Played & { endMs: number; code: number | null }> {
  const launch = codexLaunch({ runtime: RUNTIME, appPath: REPO, env: { ...p.env, WORFY_CODEX_SCRIPT: script, CODEX_HOME: codexHome } })
  const child = spawn(scriptNode(), launch.args, { cwd: p.work, env: launch.env, stdio: 'pipe' })
  child.stdin.on('error', () => undefined)
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const watch = new Watch(maxPrompts, () => stderr)
  const seen = watch.seen
  createInterface({ input: child.stdout }).on('line', (line) => watch.add(JSON.parse(line) as Message))
  const exit = new Promise<number | null>((resolve) =>
    child.on('exit', (code) => {
      // Before the turn ended this fails the waits at once; after the close nothing waits any more.
      watch.fail(`the fake exited with code ${String(code)} before the turn ended`)
      resolve(code)
    }),
  )
  const next = (match: (message: Message) => boolean) => watch.next(match)
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`)
  try {
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'worfy', version: '0.0.0' } } })
    await next((message) => message.id === 1)
    send({ method: 'initialized' })
    send({ id: 2, method: 'thread/start', params: { cwd: p.work } })
    await next((message) => message.id === 2)
    send({ id: 3, method: 'turn/start', params: { threadId: 'thr_fake_1', input: [{ type: 'text', text: 'Work' }] } })
    await next((message) => message.id === 3)
    await next(mainTurnDone)
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  }
  const closed = Date.now()
  child.stdin.end()
  const code = await exit
  const played = new Played(seen, stderr)
  return Object.assign(played, { endMs: Date.now() - closed, code })
}

/** rules/<part>.md of the installed plugin as inject-rules.mjs hands it over: the plugin root filled in. */
const rulesPart = (codexHome: string, part: string) =>
  readFileSync(join(pluginRootOf(codexHome), 'hooks', 'rules', `${part}.md`), 'utf8')
    .replace(/\n+$/, '')
    .split('${CLAUDE_PLUGIN_ROOT}')
    .join(pluginRootOf(codexHome))

const contexts = (runs: HookRun[]) => runs.flatMap((run) => run.entries.filter((entry) => entry.kind === 'context').map((entry) => entry.text))
const statuses = (runs: HookRun[]) => runs.map((run) => run.status)
const reasons = (runs: HookRun[]) => runs.filter((run) => run.status === 'blocked').flatMap((run) => run.entries.map((entry) => entry.text))

/**
 * The checks of each row that ran, and those that passed: the last test checks that every row ran checks and
 * that all of them passed. A check skipped because its scenario failed in beforeAll is not counted, and that
 * failure makes the file red on its own. `row` only hands its parameters on to `it`, so the test of spawns at
 * load (test/unit/e2e-no-spawn-on-load.test.ts) knows its callback runs later.
 */
const ran = new Map<number, number>()
const passed = new Map<number, number>()
const count = (counts: Map<number, number>, n: number) => counts.set(n, (counts.get(n) ?? 0) + 1)
const row = (n: number, title: string, check: () => void | Promise<void>, timeout?: number) =>
  it(
    `row ${n}: ${title}`,
    async () => {
      count(ran, n)
      await check()
      count(passed, n)
    },
    timeout,
  )

// --- Rows 1, 4, 7, 8: the guards, the rules at the start, the end of the Session -----------------------

describe('a turn with a reviewer and a scout (parity-guards.jsonl)', () => {
  let p: Project
  let run: Played & { endMs: number; code: number | null }
  beforeAll(async () => {
    p = project('guards')
    run = await play('parity-guards', approvedHome, p)
  }, SETUP_MS)

  row(1, 'worfy-reviewer and worfy-scout edit no file with apply_patch; their shell commands run', () => {
    for (const [id, agent] of [
      ['patch_sub_1', 'worfy-reviewer'],
      ['patch_sub_2', 'worfy-reviewer'],
      ['patch_sub_3', 'worfy-scout'],
    ] as const) {
      expect(statuses(run.toolRuns(id)), id).toEqual(['blocked'])
      expect(reasons(run.toolRuns(id))[0], id).toMatch(new RegExp(`^${agent} edits no file`))
      expect(run.started(id), `${id} never starts`).toBe(false)
      expect(run.completed(id), `${id} never completes`).toBeUndefined()
    }
    // No file of theirs changed: the added ones are not there, the updated one is as it was.
    expect(existsSync(join(p.work, 'review.txt'))).toBe(false)
    expect(existsSync(join(p.work, 'scout.txt'))).toBe(false)
    expect(readFileSync(join(p.work, 'README.md'), 'utf8')).toBe('# Project\n')
    // Their shell commands run, as Bash of a reviewer and a scout does under Claude Code.
    for (const id of ['cmd_sub_1', 'cmd_sub_3']) {
      expect(statuses(run.toolRuns(id)), id).toEqual(['completed'])
      expect(run.completed(id)?.status, id).toBe('completed')
    }
    // The refusal is by the agent, not by the tool: the main agent's apply_patch is written.
    expect(statuses(run.toolRuns('patch_1'))).toEqual(['completed'])
    expect(readFileSync(join(p.work, 'main.txt'), 'utf8')).toBe('main\n')
  })

  row(4, 'the Bash guard denies what it denies under Claude Code, to the main agent and to a reviewer', () => {
    const [[reset, resetWords], [pipe, pipeWords]] = refusedByClaude() as [[string, string], [string, string]]
    const commandOf = (id: string) => (scriptSteps('parity-guards').find((step) => (step.params as { item?: { id?: string } } | undefined)?.item?.id === id)?.input as { command: string }).command
    expect([commandOf('cmd_1'), commandOf('cmd_2'), commandOf('cmd_sub_2')]).toEqual([reset, pipe, reset])
    for (const [id, words] of [
      ['cmd_1', resetWords],
      ['cmd_2', pipeWords],
      ['cmd_sub_2', resetWords],
    ] as const) {
      expect(statuses(run.toolRuns(id)), id).toEqual(['blocked'])
      expect(reasons(run.toolRuns(id))[0], id).toContain(words)
      expect(run.started(id), `${id} never starts`).toBe(false)
    }
    // The same pipe with its exit code kept runs.
    expect(statuses(run.toolRuns('cmd_3'))).toEqual(['completed'])
    expect(run.completed('cmd_3')?.status).toBe('completed')
  })

  row(7, 'SessionStart and SubagentStart give the rules of the Harness, as under Claude Code', () => {
    const started = contexts(run.runs('sessionStart'))
    expect(started).toContain(rulesPart(approvedHome, 'orchestrator'))
    expect(started).toContain(rulesPart(approvedHome, 'common'))
    for (const thread of ['thr_sub_1', 'thr_sub_2']) expect(contexts(run.runs('subagentStart', thread)), thread).toEqual([rulesPart(approvedHome, 'common')])
    expect(statuses(run.runs('sessionStart')).every((status) => status === 'completed')).toBe(true)
  })

  row(8, 'SessionEnd records the Session for /retro and ends within the 3 s Codex gives it', () => {
    expect(run.code).toBe(0)
    const log = join(p.profileDir, 'state', 'pending-retro.log')
    expect(existsSync(log), 'pending-retro.log of the profile').toBe(true)
    const lines = readFileSync(log, 'utf8').split('\n')
    expect(lines).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\t/), ''])
    expect(lines[0]?.split('\t')[1]).toBe(p.work)
    // Codex kills a SessionEnd hook at 3 s (the fake too): a process that ended sooner had hooks that ended sooner.
    expect(run.endMs).toBeLessThan(CODEX_SESSION_END_MS)
  })
})

// --- Row 7, the size: under Codex's additionalContextLimit -------------------------------------------------

/**
 * Codex's additionalContextLimit when a hook sets none, as hooks.json does not: "`null` uses 2,500 tokens"
 * (the pinned schema, src/main/vendors/codex/protocol/json/codex_app_server_protocol.v2.schemas.json,
 * ConfiguredHookHandler). A context over it is spilled to a file and the model gets a preview.
 */
const CODEX_CONTEXT_LIMIT_TOKENS = 2500
/**
 * A plugin root as long as a real one (74 characters): the plugin cache of a CODEX_HOME under a typical user
 * home on Windows. The temporary root of this test is longer than any real one and would count against the
 * rules what a user never has.
 */
const REAL_PLUGIN_ROOT = 'C:\\Users\\firstname.lastname\\.codex\\plugins\\cache\\worfy-harness\\worfy\\local'
/** Approximate, bytes/4, as Codex's estimator is not in the repo. */
const approximateTokens = (text: string) => Buffer.byteLength(text, 'utf8') / 4
/** Where inject-rules.mjs cuts the part common with the user's rules: LIMIT, in characters (code points). */
const USER_RULES_CUT = 10_000
/** The sentence of the README's «On Codex» known gap that names this overflow (whitespace folded). */
const README_USER_RULES_GAP = 'User rules can push the part `common` over the limit, and it then spills:'

describe('the rules contexts on Codex, against the additionalContextLimit Codex spills at', () => {
  /** The additionalContext inject-rules.mjs of the installed plugin gives for `part` on `event`, with `userRules` in the slot of the user's own rules. */
  function context(part: string, event: string, userRules?: string): string {
    const harnessHome = mkdtempSync(join(root, 'rules-size-'))
    if (userRules !== undefined) {
      mkdirSync(join(harnessHome, 'user'))
      writeFileSync(join(harnessHome, 'user', 'rules.md'), userRules)
    }
    const own = Object.fromEntries(Object.entries(process.env).filter(([key]) => !MACHINE_VARIABLES.test(key)))
    const result = spawnSync(scriptNode(), [join(pluginRootOf(approvedHome), 'hooks', 'inject-rules.mjs'), part], {
      input: JSON.stringify({ hook_event_name: event, cwd: root }),
      env: { ...own, CLAUDE_PLUGIN_ROOT: REAL_PLUGIN_ROOT, HARNESS_HOME: harnessHome },
      encoding: 'utf8',
    })
    expect([result.status, result.stderr]).toEqual([0, ''])
    return (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
  }

  // At this commit the margin is about 1 %: orchestrator 2481 tokens by bytes/4 with this root (about 2467
  // with a 60-character macOS root), common 1493. None of the three holds a path of the machine: they are the
  // same on every runner. The suite checks the size, not the spill.
  row(7, `the Harness's own rules contexts fit Codex's limit of ${CODEX_CONTEXT_LIMIT_TOKENS} tokens (approximate, bytes/4, as Codex's estimator is not in the repo)`, () => {
    const contexts = [
      ['SessionStart orchestrator', context('orchestrator', 'SessionStart')],
      ['SessionStart common', context('common', 'SessionStart')],
      ['SubagentStart common', context('common', 'SubagentStart')],
    ] as const
    expect(contexts[0][1]).toContain(REAL_PLUGIN_ROOT)
    const sizes = contexts.map(([name, text]) => `${name}: ${approximateTokens(text)}`)
    expect(
      contexts.filter(([, text]) => approximateTokens(text) > CODEX_CONTEXT_LIMIT_TOKENS).map(([name]) => name),
      `over ${CODEX_CONTEXT_LIMIT_TOKENS} approximate tokens; sizes: ${sizes.join(', ')}`,
    ).toEqual([])
  })

  // A known gap, not a row. inject-rules.mjs cuts common plus the user's rules at 10,000 characters (code
  // points), whatever they are; Codex's 2,500 tokens are about 10,000 bytes, and common has multi-byte
  // characters (20 of them, 40 bytes more), so a full slot is always over, about 2,510. The cut keeps whole
  // lines and its closing line names the user-rules file: with long filler lines how much is left unused
  // depended on the length of that path, a temporary folder of the runner (2499.25 on the Mac, 2504.25 on
  // Linux CI). Lines of one character leave at most two characters unused (a line and its line break), so
  // the size no longer depends on it.
  it('known gap: common with a full user-rules slot is over Codex\'s limit and spills; the README names it', () => {
    const full = context('common', 'SubagentStart', 'x\n'.repeat(6000))
    expect(full).toMatch(/\(The user rules are cut here to fit the session hook limit; the whole file: /)
    expect([...full].length, 'the slot is full: within two characters of the cut').toBeGreaterThanOrEqual(USER_RULES_CUT - 2)
    expect(approximateTokens(full)).toBeGreaterThan(CODEX_CONTEXT_LIMIT_TOKENS)
    const readme = readFileSync(join(HARNESS, 'README.md'), 'utf8').replace(/\s+/g, ' ')
    expect(readme).toContain(README_USER_RULES_GAP)
  })
})

// --- Rows 2, 3: the gate before the end of the work ------------------------------------------------------

describe('a turn whose implementer and main agent each break the work, then fix it (parity-gate.jsonl)', () => {
  let p: Project
  let run: Played
  beforeAll(async () => {
    p = project('gate')
    // One held turn on each thread, the red one: a second is a Stop that held a green turn.
    run = await play('parity-gate', approvedHome, p, 1)
  }, SETUP_MS)

  /** A red Stop (SubagentStop) of `threadId` kept the turn going with the gate's reason, the fix ran, then a green one ended it. */
  function heldThenEnded(threadId: string, event: string, fix: string) {
    const prompts = run.hookPrompts(threadId)
    expect(prompts.map((prompt) => prompt.texts), `${threadId}: one hook prompt, the gate's reason`).toEqual([[expect.stringMatching(/^The quality gate is red \(failed at .+\)\. Run `node ".+gate\.mjs" fast/)]])
    const ends = run.turnsCompleted(threadId)
    expect(ends, `${threadId}: the turn ends once`).toHaveLength(1)
    const fixed = run.where((message) => message.method === 'item/completed' && message.params?.item?.id === fix)
    expect(fixed, `${threadId}: the fix ran in the continued turn`).toHaveLength(1)
    expect(prompts[0]!.index).toBeLessThan(fixed[0]!)
    expect(fixed[0]!).toBeLessThan(ends[0]!)
    expect(run.runs(event, threadId).filter((hook) => hook.status === 'blocked')).toHaveLength(1)
  }

  row(3, 'SubagentStop of worfy-implementer holds its turn while the gate is red and lets it end once green', () => {
    heldThenEnded('thr_sub_3', 'subagentStop', 'patch_sub_2')
  })

  row(2, 'Stop holds the turn while the gate is red and lets it end once green', () => {
    heldThenEnded('thr_fake_1', 'stop', 'patch_2')
    expect(readFileSync(join(p.work, 'status.txt'), 'utf8')).toBe('ok\n')
    // The hooks ran the gate themselves: the last verdict of the worktree is green.
    const verdicts = readdirSync(p.state).filter((name) => name.startsWith('verdict-'))
    expect(verdicts).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(p.state, verdicts[0] as string), 'utf8'))).toMatchObject({ outcome: 'green', profile: 'fast', key: 'p' })
  })
})

// --- Row 5: the agents' text ---------------------------------------------------------------------------

/** developer_instructions of a TOML agent file the installer wrote (codexAgentToml: a literal or a basic string). */
function developerInstructions(toml: string): string {
  const literal = /^developer_instructions = '''\n([\s\S]*?)'''$/m.exec(toml)
  if (literal !== null) return literal[1] as string
  const basic = /^developer_instructions = (".*")$/m.exec(toml)
  expect(basic, 'developer_instructions in the agent file').not.toBeNull()
  return JSON.parse(basic![1] as string) as string
}

describe('the agents the installer wrote into CODEX_HOME', () => {
  row(5, 'worfy-implementer and worfy-reviewer carry the rule on writes to ~/.claude the Claude test finds', () => {
    const claudeTest = readFileSync(join(REPO, 'harness', 'bin', 'tests', 'agents-text.test.sh'), 'utf8')
    const rule = /^WRITE_RULE='(.*)'$/m.exec(claudeTest)?.[1]
    expect(rule, 'the rule of the Claude test').toBeTruthy()
    const agents = /^for a in (implementer reviewer); do$/m.exec(claudeTest)?.[1]?.split(' ')
    expect(agents).toEqual(['implementer', 'reviewer'])
    for (const agent of agents!) {
      const file = join(approvedHome, 'agents', `${CODEX_AGENT_PREFIX}${agent}.toml`)
      const lines = developerInstructions(readFileSync(file, 'utf8')).split('\n')
      // At the start of a list item, as the Claude test asks of the .md.
      expect(lines.some((line) => line.startsWith('- ') && line.includes(rule!)), `${CODEX_AGENT_PREFIX}${agent}`).toBe(true)
    }
  })
})

// --- Row 6: the review verdict -------------------------------------------------------------------------

describe('a reviewer that posts its verdict in a Session worfy starts (parity-verdict.jsonl)', () => {
  let p: Project
  let run: Played
  let processEnv: NodeJS.ProcessEnv
  let ghLog: string
  const children: ChildProcess[] = []

  beforeAll(async () => {
    p = project('verdict')
    ghLog = join(p.dir, 'gh.log')
    const watch = new Watch(0)
    // worfy's own lookup of the token: `gh auth token -u <account>` through the stand-in, as appGhToken does with WORFY_GH.
    const auth = accountAuth({ account: () => Promise.resolve(ACCOUNT), run: ghRunner({ command: ghStub, env: () => Promise.resolve({ ...p.env, GH_STUB_LOG: ghLog, GH_STUB_ACCOUNT: ACCOUNT, GH_STUB_TOKEN: TOKEN }) }) })
    const part = codexSessions(() =>
      Promise.resolve({
        runtime: RUNTIME,
        appPath: REPO,
        clientVersion: '9.9.9',
        env: { ...p.env, WORFY_CODEX_SCRIPT: 'parity-verdict', CODEX_HOME: approvedHome, GH_STUB_LOG: ghLog, GH_STUB_ACCOUNT: ACCOUNT },
        ghToken: async (cwd: string) => (await auth(cwd)).GH_TOKEN ?? null,
        spawnProcess: (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
          processEnv = options.env as NodeJS.ProcessEnv
          const child = spawn(scriptNode(), [...args], options)
          children.push(child)
          if (child.stdout !== null)
            createInterface({ input: child.stdout }).on('line', (line) => watch.add(JSON.parse(line) as Message))
          return child
        },
      }),
    )
    const handle = await part.start({
      sessionId: 'worfy-session-1',
      cwd: p.work,
      settings: DEFAULT_SETTINGS,
      unattended: false,
      orchestrator: false,
      permissions: { ask: () => Promise.resolve(null), askQuestions: () => Promise.resolve({ outcome: 'cancelled' }) },
      refused: () => undefined,
      stderr: () => undefined,
      spawned: () => undefined,
    })
    try {
      await handle.send({ text: 'Review the PR', attachments: [] })
      await watch.next(mainTurnDone)
    } finally {
      handle.close()
      for (const child of children) {
        if (child.pid === undefined || hasExited(child)) continue
        await new Promise<void>((resolve) => child.once('exit', () => resolve()))
      }
    }
    run = new Played(watch.seen, '')
  }, SETUP_MS)

  row(6, 'worfy-reviewer posts its verdict with gh, and that gh has GH_TOKEN of the Profile\'s account', () => {
    // The guard lets the verdict command run, and the fake runs the tool.
    expect(statuses(run.toolRuns('cmd_sub_1'))).toEqual(['completed'])
    expect(run.completed('cmd_sub_1')?.status).toBe('completed')
    const command = (scriptSteps('parity-verdict').find((step) => step.tool === 'Bash')?.input as { command: string }).command
    expect(command).toBe('gh pr comment 7 --body VERIFIED')
    // The token worfy found for the account is in the environment of the app-server process, so in every shell of the Session.
    expect(processEnv.GH_TOKEN).toBe(TOKEN)
    // The fake runs no command: the test runs it as that shell would, with the process's environment.
    const [, ...args] = command.split(' ')
    const posted = spawnSync(scriptNode(), [ghStub, ...args], { env: processEnv, encoding: 'utf8' })
    expect([posted.status, posted.stderr]).toEqual([0, ''])
    const calls = readFileSync(ghLog, 'utf8').trim().split('\n')
    expect(calls).toEqual([`<unset>\tauth\ttoken\t-u\t${ACCOUNT}`, `${TOKEN}\tpr\tcomment\t7\t--body\tVERIFIED`])
  })
})

// --- Row 9: hooks run only once approved ---------------------------------------------------------------

describe('the same turn before the hooks are approved, and after the plugin changed under the approval', () => {
  let p: Project
  let unapproved: Played
  let changed: Played
  let changedProject: Project
  beforeAll(async () => {
    p = project('unapproved')
    unapproved = await play('parity-guards', unapprovedHome, p)
    const changedHome = join(root, 'codex-changed')
    cpSync(approvedHome, changedHome, { recursive: true })
    writeFileSync(join(pluginRootOf(changedHome), 'README.md'), `${readFileSync(join(pluginRootOf(changedHome), 'README.md'), 'utf8')}\nA line the approval did not see.\n`)
    changedProject = project('changed')
    changed = await play('parity-guards', changedHome, changedProject)
  }, SETUP_MS)

  row(9, 'without an approval the fake runs no hook of the Harness, so rows 1–8 do not hold (a Run on Codex refuses to start then: ticket 39)', () => {
    // Not registered at all: no hook starts, and the reviewer's edit and the refused command go through.
    expect(unapproved.hookStarts()).toBe(0)
    expect(readFileSync(join(p.work, 'review.txt'), 'utf8')).toBe('review\n')
    expect(unapproved.completed('cmd_1')?.status).toBe('completed')
    // Approved, then changed: every hook fails as Codex fails it, decides nothing, and the edit goes through.
    const failed = changed.runs('preToolUse')
    expect(failed.length).toBeGreaterThan(0)
    for (const hook of failed) expect([hook.status, hook.entries]).toEqual(['failed', [{ kind: 'error', text: 'plugin contents changed; hook approval required' }]])
    expect(readFileSync(join(changedProject.work, 'review.txt'), 'utf8')).toBe('review\n')
  })
})

describe('the table, once every scenario ran', () => {
  it('every row passed all its checks', () => {
    const rows = GUARANTEES.map((guarantee) => guarantee.row)
    expect([...ran.keys()].sort((a, b) => a - b)).toEqual(rows)
    expect(rows.filter((n) => passed.get(n) !== ran.get(n)), 'rows with a check that did not pass').toEqual([])
  })
})
