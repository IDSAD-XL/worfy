#!/usr/bin/env bash
# The owner's machine after the move to the plugin (worfy-harness ticket 26, item 3): read only.
#
#   e3-owner-check.sh <journal>
#
# <journal> is the journal of one Autopilot run after the move (Ticket 16):
# ~/Library/Application Support/worfy/autopilot/<run>.jsonl.
#
# Checks:
#   - ~/.claude holds only personal files. What is the Harness's follows the move form
#     (src/main/harness/migrate/plan.ts, Ticket 14), whose lists are read from that file, not kept
#     as a second list here. A violation is what the form offers to remove: an entry of agents/,
#     skills/, bin/ or hooks/ that the installed plugin carries under the same name (the personal
#     scripts of bin/ aside), the qmd scripts of bin/, profiles/README.md when the plugin has one,
#     and the sections of CLAUDE.md the move removes by default (imported, not personal, carried by
#     the plugin's rules). What the plugin does not ship — bin/tests, hooks/tests, a file under
#     another name — the form only keeps, so it is no violation;
#   - the plugin itself is in <Claude home>/worfy-harness/plugin: without it nothing above can be told;
#   - no hook record of settings.json runs a file in ~/.claude that is not there;
#   - .claude.json has no MCP server record of qmd (Q15);
#   - `claude plugin list --json` names worfy@… enabled;
#   - the journal: the run started after Ticket 16 became done (the commit time of its
#     `Status: done` line); it has no `refused-dialog` and no `human-input` line; a Wave ran — a
#     `wave-finished` line before `run-stopped`, or a graceful Stop that found Tickets in work
#     (`wave-started`, then `run-stopping` with a non-empty `inWork`, then `run-stopped` with reason
#     `user-stop`: a Wave stopped that way journals no `wave-finished`, src/shared/autopilot/cycle.ts);
#     and it ended — a `run-stopped` line followed only by what a stopped run still writes
#     (`background-tasks`, `orchestrator-returned`, `tasks-killed`).
#
# Exit codes: 0 — all of it holds; 1 — the violations, one line each; 2 — usage error, or a file
# the check needs could not be read (that is not a pass).
#
# Paths: the Claude home is $CLAUDE_CONFIG_DIR or ~/.claude; .claude.json is
# $CLAUDE_CONFIG_DIR/.claude.json or ~/.claude.json (as Claude Code reads them); the plugin is
# <Claude home>/worfy-harness/plugin. E3_CLAUDE replaces `claude` and E3_HARNESS_DONE_AT (ISO time)
# the time Ticket 16 became done — for test/contract/e3-owner-check.test.ts. Nothing is written.
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: e3-owner-check.sh <journal of one Autopilot run>" >&2
  exit 2
fi

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export E3_REPO=$REPO
export E3_JOURNAL=$1

if [ -z "${E3_HARNESS_DONE_AT:-}" ]; then
  ticket=$(ls "$REPO"/.scratch/worfy-harness/issues/16-*.md 2>/dev/null | head -n 1 || true)
  [ -n "$ticket" ] || {
    echo "e3-owner-check: Ticket 16 not found in $REPO/.scratch/worfy-harness/issues" >&2
    exit 2
  }
  grep -q '^Status: done' "$ticket" || {
    echo "1 violation:"
    echo "Ticket 16 is not done: $(grep -m1 '^Status:' "$ticket" || echo 'no Status line')"
    exit 1
  }
  # The first commit that added the `Status: done` line: its commit time.
  E3_HARNESS_DONE_AT=$(git -C "$REPO" log --format=%cI -S'Status: done' -- "${ticket#"$REPO"/}" | tail -n 1)
  [ -n "$E3_HARNESS_DONE_AT" ] || {
    echo "e3-owner-check: no commit adds 'Status: done' to $ticket" >&2
    exit 2
  }
fi
export E3_HARNESS_DONE_AT

exec node - <<'JS'
"use strict"
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const env = process.env
const home = env.HOME || os.homedir()
const claudeHome = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, ".claude")
const claudeJson = env.CLAUDE_CONFIG_DIR ? path.join(claudeHome, ".claude.json") : path.join(home, ".claude.json")
const plugin = path.join(claudeHome, "worfy-harness", "plugin")
const planFile = path.join(env.E3_REPO, "src", "main", "harness", "migrate", "plan.ts")

const die = (msg) => {
  process.stderr.write(`e3-owner-check: ${msg}\n`)
  process.exit(2)
}
const violations = []
const shown = (p) => (p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p)

// ── The manifest of the move form, read from plan.ts ──
let planText
try {
  planText = fs.readFileSync(planFile, "utf8")
} catch (error) {
  die(`the manifest ${planFile} could not be read: ${error.message}`)
}
const strings = (body) => [...body.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2])
function list(name) {
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(planText)
  if (!m) die(`${name} not found in ${planFile}`)
  const values = strings(m[1])
  if (values.length === 0) die(`${name} in ${planFile} is empty`)
  return values
}
function objectBody(name) {
  const m = new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(planText)
  if (!m) die(`${name} not found in ${planFile}`)
  return m[1]
}
const PERSONAL_BIN = list("PERSONAL_BIN")
const QMD_BINS = list("QMD_BINS")
const IMPORTED = list("IMPORTED_CLAUDE_MD_HEADINGS")
const PERSONAL_RULES = [...objectBody("PERSONAL_RULES").matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1])
const CARRIED_BY_INTRO = Object.fromEntries([...objectBody("CARRIED_BY_INTRO").matchAll(/^\s*'([^']+)':\s*join\(([^)]*)\)/gm)].map((m) => [m[1], strings(m[2])]))
if (PERSONAL_RULES.length === 0 || Object.keys(CARRIED_BY_INTRO).length === 0) die(`PERSONAL_RULES or CARRIED_BY_INTRO in ${planFile} could not be read`)

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir).filter((name) => name !== ".DS_Store").sort()
  } catch {
    return []
  }
}
const exists = (p) => fs.existsSync(p)

// ── Files of the Harness in the Claude home ──
// The move form offers "Remove" only for what the plugin carries under the same name
// (`removable: inPlugin` in buildPlan); the rest it keeps, and so does this check.
if (!exists(path.join(plugin, ".claude-plugin", "plugin.json"))) violations.push(`the Harness plugin is not in ${shown(plugin)}: nothing to compare ${shown(claudeHome)} with`)
for (const dir of ["agents", "skills", "bin", "hooks"]) {
  for (const name of listDir(path.join(claudeHome, dir))) {
    const rel = path.join(dir, name)
    const where = shown(path.join(claudeHome, rel))
    if (dir === "bin" && PERSONAL_BIN.includes(name)) continue
    if (dir === "bin" && QMD_BINS.includes(name)) violations.push(`a qmd script of the old Harness is still there: ${where}`)
    else if (exists(path.join(plugin, rel))) violations.push(`a file of the Harness is still there: ${where}`)
  }
}
const readme = path.join("profiles", "README.md")
if (exists(path.join(claudeHome, readme)) && exists(path.join(plugin, readme))) violations.push(`a file of the Harness is still there: ${shown(path.join(claudeHome, readme))}`)

// ── CLAUDE.md: the sections the move removes by default ──
function sections(text) {
  const out = []
  let fence = null
  for (const line of text.split("\n")) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker[0]
      else if (marker[0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) out.push(m[2])
  }
  return out
}
const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8")
  } catch {
    return null
  }
}
const claudeMd = readText(path.join(claudeHome, "CLAUDE.md"))
if (claudeMd !== null) {
  const pluginHeadings = new Set()
  const rules = path.join(plugin, "hooks", "rules")
  for (const name of listDir(rules)) if (name.endsWith(".md")) for (const h of sections(readText(path.join(rules, name)) ?? "")) pluginHeadings.add(h)
  for (const heading of sections(claudeMd)) {
    if (!IMPORTED.includes(heading) || PERSONAL_RULES.includes(heading)) continue
    const intro = CARRIED_BY_INTRO[heading]
    const carried = pluginHeadings.has(heading) || (Array.isArray(intro) && exists(path.join(plugin, ...intro)))
    if (carried) violations.push(`a rule of the Harness is still in ${shown(path.join(claudeHome, "CLAUDE.md"))}: "${heading}"`)
  }
}

// ── settings.json: hook records that run a removed file ──
const readJson = (p) => {
  const text = readText(p)
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    die(`${p} is not JSON: ${error.message}`)
  }
}
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v)
function target(command) {
  const text = command.trimStart()
  let head
  if (text[0] === '"' || text[0] === "'") {
    const end = text.indexOf(text[0], 1)
    head = end > 0 ? text.slice(1, end) : text
  } else head = /^\S+/.exec(text)?.[0] ?? ""
  if (head === "~" || head.startsWith("~/")) head = path.join(home, head.slice(1))
  else if (head.startsWith("$HOME/")) head = path.join(home, head.slice(6))
  else if (head.startsWith("${HOME}/")) head = path.join(home, head.slice(8))
  return path.isAbsolute(head) ? path.resolve(head) : null
}
const settings = readJson(path.join(claudeHome, "settings.json"))
if (isObject(settings) && isObject(settings.hooks)) {
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      for (const hook of isObject(group) && Array.isArray(group.hooks) ? group.hooks : []) {
        if (!isObject(hook) || typeof hook.command !== "string") continue
        const file = target(hook.command)
        const rel = file === null ? null : path.relative(claudeHome, file)
        if (rel === null || rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue
        if (!exists(file)) violations.push(`a hook of ${shown(path.join(claudeHome, "settings.json"))} (${event}) runs a file that is gone: ${shown(file)}`)
      }
    }
  }
}

// ── .claude.json: no MCP server record of qmd (Q15) ──
const json = readJson(claudeJson)
const qmdRecords = []
const mcpOf = (holder, where) => {
  if (isObject(holder) && isObject(holder.mcpServers)) for (const name of Object.keys(holder.mcpServers)) if (/qmd/i.test(name)) qmdRecords.push(`${where}mcpServers.${name}`)
}
if (isObject(json)) {
  mcpOf(json, "")
  if (isObject(json.projects)) for (const [project, value] of Object.entries(json.projects)) mcpOf(value, `projects["${project}"].`)
}
for (const record of qmdRecords) violations.push(`${shown(claudeJson)} still registers qmd: ${record}`)

// ── The plugin is installed and enabled ──
// A Node stand-in (`.mjs`) runs with this node: Windows cannot start a script file by itself.
const claudeBin = env.E3_CLAUDE || "claude"
const claude = claudeBin.endsWith(".mjs")
  ? spawnSync(process.execPath, [claudeBin, "plugin", "list", "--json"], { encoding: "utf8" })
  : spawnSync(claudeBin, ["plugin", "list", "--json"], { encoding: "utf8" })
if (claude.error) die(`claude plugin list --json could not run: ${claude.error.message}`)
if (claude.status !== 0) violations.push(`claude plugin list --json exited ${claude.status}: ${(claude.stderr || "").trim()}`)
else {
  let plugins
  try {
    plugins = JSON.parse(claude.stdout)
  } catch {
    die("claude plugin list --json printed no JSON")
  }
  const worfy = Array.isArray(plugins) ? plugins.find((p) => isObject(p) && typeof p.id === "string" && p.id.startsWith("worfy@")) : undefined
  if (!worfy) violations.push("claude plugin list --json: no worfy plugin")
  else if (worfy.enabled !== true) violations.push(`claude plugin list --json: ${worfy.id} is not enabled`)
}

// ── The journal of the Autopilot run ──
const journal = env.E3_JOURNAL
const text = readText(journal)
if (text === null) die(`the journal ${journal} could not be read`)
const lines = []
for (const [i, line] of text.split("\n").entries()) {
  if (line.trim() === "") continue
  try {
    lines.push(JSON.parse(line))
  } catch {
    die(`${journal}:${i + 1} is not JSON`)
  }
}
const doneAt = Date.parse(env.E3_HARNESS_DONE_AT)
if (Number.isNaN(doneAt)) die(`not a time: ${env.E3_HARNESS_DONE_AT}`)
const started = lines.find((line) => isObject(line) && line.kind === "run-started")
if (!started) violations.push(`${journal}: no run-started line`)
else if (!(Date.parse(started.at) > doneAt)) violations.push(`${journal}: the run started at ${started.at}, not after Ticket 16 became done (${env.E3_HARNESS_DONE_AT})`)
for (const [i, line] of lines.entries()) {
  if (isObject(line) && (line.kind === "refused-dialog" || line.kind === "human-input")) violations.push(`${journal}: line ${i + 1} is ${line.kind}${line.what ? ` (${line.what})` : ""}`)
}
// The run ended: a run-stopped line, and after it only what a stopped run still writes while it
// gives the Orchestrator back.
const AFTER_STOP = ["background-tasks", "orchestrator-returned", "tasks-killed"]
const stoppedAt = lines.findLastIndex((line) => isObject(line) && line.kind === "run-stopped")
const stopped = stoppedAt < 0 ? undefined : lines[stoppedAt]
let wave = ""
if (!stopped) violations.push(`${journal}: no run-stopped line (the last line is ${isObject(lines.at(-1)) ? lines.at(-1).kind : "missing"}): the run did not end`)
else {
  for (const line of lines.slice(stoppedAt + 1)) {
    if (!isObject(line) || !AFTER_STOP.includes(line.kind)) violations.push(`${journal}: ${isObject(line) ? line.kind : "a line"} after run-stopped: the run went on`)
  }
  // A Wave ran: it finished, or a graceful Stop found its Tickets in work (that Wave journals no
  // wave-finished). A run that stopped with no ready Wave, or on a Session error, ran none.
  const before = lines.slice(0, stoppedAt).filter(isObject)
  const finished = before.filter((line) => line.kind === "wave-finished")
  const startedWave = before.some((line) => line.kind === "wave-started")
  const stopping = before.findLast((line) => line.kind === "run-stopping")
  const graceful = startedWave && stopped.reason === "user-stop" && stopping !== undefined && Array.isArray(stopping.inWork) && stopping.inWork.length > 0
  if (finished.length > 0) wave = `a Wave ran by rule (a): ${finished.length} wave-finished line${finished.length === 1 ? "" : "s"} before run-stopped`
  else if (graceful)
    wave = `a Wave ran by rule (b): a graceful Stop during Wave ${stopping.wave ?? "?"}, Tickets in work at the Stop: ${stopping.inWork.join(", ")} — compare with their Ticket statuses`
  else violations.push(`${journal}: no Wave ran: no wave-finished line before run-stopped (${stopped.reason ?? "no reason"}), and no graceful Stop with Tickets in work`)
}

if (violations.length > 0) {
  process.stdout.write(`${violations.length} violation${violations.length === 1 ? "" : "s"}:\n${violations.join("\n")}\n`)
  process.exit(1)
}
process.stdout.write(`ok: ${shown(claudeHome)} holds only personal files, worfy is enabled, the run ${started.run ?? ""} went without a person and stopped (${stopped.reason ?? "no reason"})\n${wave}\n`)
JS
