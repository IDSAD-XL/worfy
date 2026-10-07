#!/usr/bin/env node
// Maps changed files to the workspaces they belong to.
//
//   gate-resolve.mjs --which <path>          -> TSV: key \t repoRoot \t pm   (or empty)
//   <changed paths> | gate-resolve.mjs <repoPath> <profile> <key>
//                                            -> TSV: wsdir \t packageName \t "script1 script2"
//                                                    \t "fingerprint paths" \t "added from"
//                                               ("." + an empty name = the repository root;
//                                                the root has no last two fields)
//                                               The scope also includes the workspaces that depend
//                                               on the changed ones (transitively).
//   GATE_ALL=1 ... gate-resolve.mjs <repoPath> <profile> <key>
//                                            -> the same, but all workspaces and the root, without
//                                               regard to the list of changes
//
// The empty second field of the root is the reason gate.sh must not parse
// the line with IFS=$'\t' read: tab is a whitespace separator, two in a row
// collapse, and the script name slides into the package field.

import fs from "node:fs"
import path from "node:path"

// The gate registry: CLAUDE_GATE_CONFIG, else $HARNESS_HOME/gate/config.json (HARNESS_HOME
// defaults to ~/.claude/worfy-harness, ADR-0040 item 5). Transition: with no registry there but
// one in the old place, ~/.claude/gate/config.json, read the old one (read only).
function gateConfig() {
    if (process.env.CLAUDE_GATE_CONFIG) return process.env.CLAUDE_GATE_CONFIG
    const home = process.env.HOME || ""
    const harnessHome = process.env.HARNESS_HOME || path.join(home, ".claude", "worfy-harness")
    const current = path.join(harnessHome, "gate", "config.json")
    const legacy = path.join(home, ".claude", "gate", "config.json")
    return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current
}
const CFG = gateConfig()

// An unreadable or broken registry is not "the project is not registered". There used to be
// `exit 0` with empty output here, and gate.sh/stop.sh took a registered project for
// someone else's: the gate answered "not registered", and stop.sh did not notice the red marker.
// Now it is code 4 and the reason on stderr; the callers treat this as "could not verify".
let cfg
try {
    cfg = JSON.parse(fs.readFileSync(CFG, "utf8"))
} catch (e) {
    process.stderr.write(`gate-resolve: registry ${CFG} cannot be read: ${e.message}\n`)
    process.exit(4)
}
// No `repos` field (`{}`, the typo `"Repos"`) is a broken registry too, not an empty one: otherwise all
// projects would silently become "not registered", and the red marker would stop holding the turn.
if (!cfg || typeof cfg !== "object" || !Array.isArray(cfg.repos)) {
    process.stderr.write(`gate-resolve: registry ${CFG} is broken: the "repos" field must be an array\n`)
    process.exit(4)
}
const repos = cfg.repos

const readPkg = (p) => {
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"))
    } catch {
        return null
    }
}

// --- choosing the repository: the longest prefix match wins -------------------
// Letter case: on a case-insensitive file system (APFS by default) /users/alexey/work/auction is
// the same directory as /Users/alexey/Work/Auction. fs.realpathSync.native (realpath(3)) returns
// the spelling from disk, the plain fs.realpathSync does not. So the target is normalized through native, and
// `match` through native too, but only if the result differs from the entry by case alone:
// that way nothing but the case changes (a trailing slash, symlinks and nonexistent paths
// stay as written). On a case-sensitive file system native changes nothing.
const onDisk = (p) => {
    try {
        const n = fs.realpathSync.native(p)
        return n.toLowerCase() === p.toLowerCase() ? n : p
    } catch {
        return p
    }
}
if (process.argv[2] === "--which") {
    let target = process.argv[3] || process.cwd()
    try {
        target = fs.realpathSync.native(target)
    } catch {}
    const hit = repos
        .map((r) => ({ ...r, m: onDisk(r.match) }))
        .filter((r) => target === r.m || target.startsWith(r.m + path.sep))
        .sort((a, b) => b.m.length - a.m.length)[0]
    if (hit) console.log([hit.key, hit.match, hit.pm || "npm"].join("\t"))
    process.exit(0)
}

const [, , repoPath, profile, key] = process.argv
const rc = repos.find((r) => r.key === key)
if (!rc || !repoPath) process.exit(0)

// "Everything" mode: gate.sh does not trust the diff from the merge-base (no base, HEAD
// detached, the branch far from origin/main) and asks for the full scope.
const ALL = process.env.GATE_ALL === "1"
const changed = fs
    .readFileSync(0, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
if (!changed.length && !ALL) process.exit(0)

const pick = (table) => (table && (table[profile] || [])) || []
const rootWanted = pick(rc.root)
// There is no point running the root scripts for documents alone: root_if
// limits them to the paths those scripts look at at all.
const rootIf = rc.root_if ? new RegExp(rc.root_if) : null
const rootApplies = ALL || !rootIf || changed.some((f) => rootIf.test(f))
const wsWanted = pick(rc.workspace)

// --- where the workspaces live -----------------------------------------------
// Entries are literal ("shared") or with a trailing star ("apps/*"). Nothing
// more complex than a star at the end is parsed here — our repositories have
// no such entries, and a full glob would drag a dependency into the hook.
function workspaceGlobs() {
    const yaml = path.join(repoPath, "pnpm-workspace.yaml")
    if (fs.existsSync(yaml)) {
        const out = []
        let inList = false
        for (const raw of fs.readFileSync(yaml, "utf8").split("\n")) {
            if (/^packages:\s*$/.test(raw)) {
                inList = true
                continue
            }
            if (inList) {
                const m = raw.match(/^\s+-\s*['"]?([^'"#\s]+)['"]?\s*$/)
                if (m) out.push(m[1])
                else if (/^\S/.test(raw)) inList = false
            }
        }
        return out
    }
    const root = readPkg(path.join(repoPath, "package.json"))
    const ws = root?.workspaces
    return Array.isArray(ws) ? ws : ws?.packages || []
}

function workspaceDirs() {
    const dirs = []
    for (const g of workspaceGlobs()) {
        if (g.endsWith("/*")) {
            const parent = g.slice(0, -2)
            let entries = []
            try {
                entries = fs.readdirSync(path.join(repoPath, parent), { withFileTypes: true })
            } catch {}
            for (const e of entries) {
                if (!e.isDirectory()) continue
                const d = `${parent}/${e.name}`
                if (fs.existsSync(path.join(repoPath, d, "package.json"))) dirs.push(d)
            }
        } else if (fs.existsSync(path.join(repoPath, g, "package.json"))) {
            dirs.push(g)
        }
    }
    return dirs.sort((a, b) => b.length - a.length) // the longest path first
}

const dirs = wsWanted.length ? workspaceDirs() : []
const hit = new Set(ALL ? dirs : [])
const uncovered = []
for (const file of ALL ? [] : changed) {
    const owner = dirs.find((d) => file === d || file.startsWith(d + "/"))
    if (owner) hit.add(owner)
    else uncovered.push(file)
}

// --- the dependency graph between workspaces -----------------------------------------
// A changed package breaks those who import it: a branch changed a type in
// packages/shared, the gate checked shared, api and web, and demo-bot, which also
// depends on shared, stayed unchecked and red on typecheck. So all workspaces
// that depend on the changed ones are added to the scope, transitively.
// A dependency is the name of another workspace in dependencies/devDependencies/
// peerDependencies/optionalDependencies with any version (workspace:* or not).
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
const pkgOf = new Map(dirs.map((d) => [d, readPkg(path.join(repoPath, d, "package.json"))]))
const dirByName = new Map()
for (const [d, p] of pkgOf) if (p?.name) dirByName.set(p.name, d)
const depsOf = new Map() // dir -> direct workspace dependencies (dirs)
for (const [d, p] of pkgOf) {
    const out = new Set()
    for (const f of DEP_FIELDS)
        for (const name of Object.keys(p?.[f] || {})) {
            const dd = dirByName.get(name)
            if (dd && dd !== d) out.add(dd)
        }
    depsOf.set(d, out)
}
const closure = (d) => {
    // all workspaces d depends on transitively (without d itself)
    const seen = new Set()
    const stack = [...(depsOf.get(d) || [])]
    while (stack.length) {
        const x = stack.pop()
        if (seen.has(x) || x === d) continue
        seen.add(x)
        stack.push(...(depsOf.get(x) || []))
    }
    return seen
}
const direct = new Set(hit)
const addedFrom = new Map() // dir -> the changed packages it was added because of
if (!ALL) {
    for (const d of dirs) {
        if (direct.has(d)) continue
        const from = [...closure(d)].filter((x) => direct.has(x)).sort()
        if (from.length) {
            hit.add(d)
            addedFrom.set(d, from)
        }
    }
}

// --- output -------------------------------------------------------------------
if (rootWanted.length && rootApplies) {
    const pkg = readPkg(path.join(repoPath, "package.json"))
    const scripts = rootWanted.filter((s) => pkg?.scripts?.[s])
    if (scripts.length) console.log([".", "", scripts.join(" ")].join("\t"))
}

for (const dir of [...hit].sort()) {
    const pkg = readPkg(path.join(repoPath, dir, "package.json"))
    if (!pkg?.name) continue
    // A targeted relaxation: a workspace that has its own set of scripts in this profile.
    const wanted = pick(rc.workspace_overrides?.[dir]) || wsWanted
    const scripts = (wanted.length ? wanted : wsWanted).filter((s) => pkg.scripts?.[s])
    // The fourth field is the paths for the cache fingerprint: the package itself and all its workspace
    // dependencies. Otherwise an uncommitted edit in shared did not change the fingerprint of
    // demo-bot, and the cache handed out a stale «зелено» (green). The fifth is what the package was added
    // from as a dependent (empty if it changed itself).
    const fpScope = [dir, ...[...closure(dir)].sort()].join(" ")
    const from = (addedFrom.get(dir) || []).join(",")
    if (scripts.length) console.log([dir, pkg.name, scripts.join(" "), fpScope, from].join("\t"))
}

// The root scripts cover the whole repository, so a file that belongs to no workspace is a problem
// only where there are no root scripts at all. Filtering by root_if is a deliberate
// decision (the linter does not need documents), and there is no reason to complain about it.
if (uncovered.length && !rootWanted.length) {
    process.stderr.write(
        `[gate] ${key}: changes outside workspaces and with no root scripts: ${uncovered.length} — ` +
            uncovered.slice(0, 5).join(", ") +
            (uncovered.length > 5 ? ", ..." : "") +
            "\n"
    )
}
