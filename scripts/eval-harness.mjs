#!/usr/bin/env node
// pnpm eval:harness [-- <claude plugin eval options>] — runs the eval cases of the Harness
// (harness/evals/, ticket worfy-harness/27) with `claude plugin eval`: real model calls on the
// owner's account, by hand, on a Mac. Not in CI and not in the gate.
//
// Two calls, because the cases need different shell grants:
//   main — cases tagged `main`, with Bash, Write and Edit;
//   gui  — cases tagged `gui` (no-os-screen-capture), with Bash only for git, node and the
//          Harness scripts: an attempt at an OS screen capture is refused, not run. A real capture
//          from a run started inside worfy would ask Screen Recording for the app, and granting it
//          restarts the app (lesson 2026-10-07).
// The target is a temporary copy of harness/ whose plugin.json has no `dependencies`: in a run
// only the plugin under test is installed, and Claude Code refuses to load a plugin whose
// dependency (mattpocock-skills) is missing — then no case sees a single rule of the Harness.
// HARNESS_DIR=<dir> evaluates another copy of the Harness instead of harness/ (the mutation check of
// the ticket); results go to <that dir>/evals/results/.
// Arguments after `--` go to both calls as they are (`pnpm eval:harness -- --case status-block
// --runs 1`); a call whose tag no case selected by --case/--tag carries is skipped.
//
// claude: $CLAUDE_BIN, else the binary bundled with the Agent SDK in node_modules; older than
// 2.1.269 (no `plugin eval`) — exit 1. Exit code: the worst of the calls (0 — every case at or
// above the threshold; 1 — a case below it or not loaded; 2 — partial: cost ceiling or the
// account refused; 130, 143 — interrupted). At the end: the paths to aggregate-result.json and
// report.html of each call.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { removeTree } from './remove-tree.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = process.env.HARNESS_DIR ? resolve(process.env.HARNESS_DIR) : join(REPO, 'harness')
const EVALS = join(SOURCE, 'evals')
const MIN_VERSION = [2, 1, 269]
// Pinned, so that a change of the default model does not look like a broken Harness.
const MODEL = 'claude-sonnet-5'
const JUDGE_MODEL = 'claude-haiku-4-5'
const COMMON = [
  '--scaffold',
  '--trust-plugin',
  '--ablation', 'none',
  '--threshold', '0.8',
  '--max-cost-usd', '30',
  '--no-publish',
  '--model', MODEL,
  '--judge-model', JUDGE_MODEL,
]
/** Tool grants of each call; `harness` is the path of the plugin under test. */
const grants = (harness) => ({
  main: ['Bash', 'Write', 'Edit'],
  gui: [
    'Bash(git *)',
    'Bash(node *)',
    `Bash(${harness}/bin/*)`,
    `Bash("${harness}/bin/*)`,
    `Bash(${harness}/hooks/*)`,
    `Bash("${harness}/hooks/*)`,
    `Bash(bash ${harness}/hooks/*)`,
    `Bash(bash "${harness}/hooks/*)`,
    'Write',
    'Edit',
  ],
})

// Variables that tie a process to the Claude Code session it was started from. A run started from
// inside a session (a worfy Session, Autopilot) would hand them to every eval child, and the
// children would report to that session's messaging socket under its id.
const SESSION_VARIABLES = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
]
// Folders of other Harness copies on PATH: the frozen ~/.claude/bin, the installed plugin under
// ~/.claude/worfy-harness/, the Stable copy's .../harness/bin. A run inherits PATH, and its sandbox
// lets it read every PATH folder, so an agent that calls `profile` or `ticket` by name would run
// another Harness than the one under test.
const otherHarness = (dir) =>
  dir === join(homedir(), '.claude', 'bin') || dir.includes(`${sep}.claude${sep}worfy-harness${sep}`) || /[\\/]harness[\\/](bin|hooks)[\\/]?$/.test(dir)
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !SESSION_VARIABLES.includes(key)))
if (childEnv.PATH) childEnv.PATH = childEnv.PATH.split(delimiter).filter((dir) => dir && !otherHarness(dir)).join(delimiter)

const fail = (message) => {
  process.stderr.write(`eval:harness: ${message}\n`)
  process.exit(1)
}

function claudeBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  try {
    const sdk = createRequire(join(REPO, 'package.json')).resolve('@anthropic-ai/claude-agent-sdk')
    const pkg = createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
    return join(dirname(pkg), 'claude')
  } catch {
    return fail(`no claude binary of the Agent SDK for ${process.platform}-${process.arch} in node_modules; set CLAUDE_BIN`)
  }
}

/** -1, 0 or 1: version a against version b, both [major, minor, patch]. */
const compare = (a, b) => a.reduce((acc, n, i) => acc || Math.sign(n - b[i]), 0)

function checkVersion(claude) {
  const run = spawnSync(claude, ['--version'], { encoding: 'utf8', env: childEnv })
  if (run.error || run.status !== 0) fail(`${claude} --version failed: ${run.error?.message ?? run.stderr.trim()}`)
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(run.stdout)
  if (!match) fail(`cannot read the version from "${run.stdout.trim()}"`)
  const version = match.slice(1, 4).map(Number)
  if (compare(version, MIN_VERSION) < 0) {
    fail(`claude ${version.join('.')} has no \`plugin eval\`: it needs ${MIN_VERSION.join('.')} or newer (${claude})`)
  }
  return version.join('.')
}

/** Values of a repeatable option in the pass-through arguments (`--case a`, `--tag a b`). */
function optionValues(args, name) {
  const values = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      for (let j = i + 1; j < args.length && !args[j].startsWith('-'); j++) values.push(args[j])
    } else if (args[i].startsWith(`${name}=`)) {
      values.push(args[i].slice(name.length + 1))
    }
  }
  return values
}

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)

/** Case name -> tags, from the front matter of each harness/evals/<case>/prompt.md. */
function caseTags() {
  return readdirSync(EVALS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(EVALS, entry.name, 'prompt.md')))
    .map((entry) => {
      const text = readFileSync(join(EVALS, entry.name, 'prompt.md'), 'utf8')
      const tags = /^tags:\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? ''
      return [entry.name, tags.split(',').map((tag) => tag.trim()).filter(Boolean)]
    })
}

/** Whether the call for `tag` would select any case under the pass-through --case and --tag. */
function selects(tag, args) {
  const globs = optionValues(args, '--case').map(globToRegExp)
  const tags = optionValues(args, '--tag')
  return caseTags().some(
    ([name, own]) =>
      own.includes(tag) && (globs.length === 0 || globs.some((glob) => glob.test(name))) && (tags.length === 0 || tags.some((t) => own.includes(t))),
  )
}

/**
 * Copies the Harness at `source` into a new temporary folder, without evals/results/ and with no
 * `dependencies` in .claude-plugin/plugin.json; returns the copy's real path.
 */
function pluginCopy(source) {
  const target = join(realpathSync(mkdtempSync(join(tmpdir(), 'worfy-eval-harness-'))), 'harness')
  const results = join('evals', 'results')
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(source, path)
      return !path.endsWith(`${sep}.DS_Store`) && inside !== results && !inside.startsWith(`${results}${sep}`)
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  delete manifest.dependencies
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return target
}

const passThrough = process.argv.slice(2)
if (passThrough[0] === '--') passThrough.shift()

const claude = claudeBinary()
const version = checkVersion(claude)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
process.stdout.write(`eval:harness: claude ${version} (${claude}), model ${MODEL}, judge ${JUDGE_MODEL}\n`)

// Ctrl-C and SIGTERM reach claude too; this process outlives it to remove the copy and report.
process.on('SIGINT', () => {})
process.on('SIGTERM', () => {})

const harness = pluginCopy(SOURCE)
process.stdout.write(`eval:harness: plugin under test — ${harness} (a copy of ${SOURCE} without dependencies)\n`)
let worst = 0
const outputs = []
try {
  for (const tag of ['main', 'gui']) {
    if (!selects(tag, passThrough)) {
      process.stdout.write(`eval:harness: no ${tag} case selected, the ${tag} call is skipped\n`)
      continue
    }
    const outputDir = join(EVALS, 'results', `${stamp}-${tag}`)
    // The target goes before --tag and --allow-tools: both take a list and would swallow it.
    const args = ['plugin', 'eval', harness, ...COMMON, '--output-dir', outputDir, '--tag', tag, '--allow-tools', ...grants(harness)[tag], ...passThrough]
    process.stdout.write(`eval:harness: ${tag} — claude ${args.join(' ')}\n`)
    const run = spawnSync(claude, args, { stdio: 'inherit', cwd: REPO, env: childEnv })
    const code = run.status ?? (run.signal === 'SIGINT' ? 130 : 143)
    process.stdout.write(`eval:harness: ${tag} exited ${code}\n`)
    worst = Math.max(worst, code)
    outputs.push(outputDir)
  }
} finally {
  removeTree(dirname(harness))
}

for (const dir of outputs) {
  process.stdout.write(`${join(dir, 'aggregate-result.json')}\n${join(dir, 'report.html')}\n`)
}
process.exit(worst)
