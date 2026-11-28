// The trail of a ticket: the section of the ticket file, under the heading tickets.trail_section of the profile
// (`## Where in code`), that names the files the ticket may edit. One reader for every check that asks whether a
// verification path (lib/verification-paths.cjs) is in a ticket's trail: bin/land reads it for the PR of a ticket, the
// guard hook for the edit of a subagent. Both read the ticket at the tip of the base branch, never at the PR's fork point
// or in the working tree: a PR cannot write its own permission, and a trail the orchestrator extended on the base
// branch after the branch was cut already counts.
//
//   ticketOfBranch(branch, template)       {epic, nn} of the branch by tickets.branch (`<epic>/<NN>`), or null when the
//                                          branch does not follow the template (or there is none)
//   ticketPattern(pathTemplate, epic, nn)  the glob of the ticket's file by tickets.path (`.scratch/<epic>/issues/NN-*.md`)
//   trailPaths(text, heading)              the paths and globs the trail section names in backticks, "/"-separated and
//                                          normalized like a glob of verification.paths; null when the file has no such
//                                          section
//   namedByTrail(file, trail, options)     whether the file is one the trail names (a path, a glob, a folder "x/");
//                                          options as isVerificationPath takes them ({platform, root})
//   readTrail({repo, ref, branch, tickets, git, folder})
//                                          the ticket of the branch and its trail at ref (git show <ref>:<path>), or in
//                                          folder (the tickets outside the repository, Silent mode): {ticket, trail,
//                                          reason, unread?} — ticket {epic, nn, path} (path null when no single file
//                                          of the ticket is there) or null when the branch names no ticket, trail a
//                                          list or null, reason why either is missing; unread — git could not answer
//
// A trail entry is a span in single backticks with no space in it that looks like a path (it holds a "/" or a "."):
// `harness/bin/land`, `.github/workflows/ci.yml`, `test/quarantine/**`. A line suffix (`land:755-764`) is dropped; a
// span of a line number alone (`:356`) or of a word (`PR_FIELDS`, `ready()`) names no file. "\" reads as "/" (a trail
// written on Windows). Code blocks are skipped, and so is a heading inside them.
// shortcut: a trail entry of a profile with several repositories starts with the repository's name (bin/TICKETS.md), and
// it is compared as written, from the root of the one repository land and the guard run in; redo when a project with
// several repositories gets a verification path check.
//
// CommonJS, like verification-paths.cjs: the scripts of bin/ are CommonJS, the hooks `require` it through createRequire.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { normalizeGlob, isVerificationPath } = require("./verification-paths.cjs")
const { codeLines } = require("./code-fence.cjs")

const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** {epic, nn} of `branch` by the template tickets.branch (`<epic>/<NN>`, `<epic>/<NN>-<slug>`), or null. */
function ticketOfBranch(branch, template) {
    if (typeof branch !== "string" || branch === "" || typeof template !== "string" || !template.includes("<epic>") || !template.includes("<NN>")) return null
    const re = template
        .split(/(<epic>|<NN>|<slug>)/)
        .map((part) => (part === "<epic>" ? "(?<epic>[^/]+)" : part === "<NN>" ? "(?<nn>[0-9]+)" : part === "<slug>" ? "[^/]+" : literal(part)))
        .join("")
    const m = new RegExp(`^${re}$`).exec(branch)
    return m ? { epic: m.groups.epic, nn: m.groups.nn } : null
}

/** The glob of the ticket file by tickets.path: `<epic>` and `<NN>` (or NN) replaced. */
function ticketPattern(pathTemplate, epic, nn) {
    if (typeof pathTemplate !== "string" || !/NN/.test(pathTemplate)) return null
    return pathTemplate.split("<epic>").join(epic).split("<NN>").join(nn).split("NN").join(nn)
}

// A line suffix of a path in a trail: `:12`, `:12-20`, `:12,30-31`.
const LINES = /:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/

/** The paths the trail section of `text` names, or null when there is no section under `heading`. */
function trailPaths(text, heading) {
    if (typeof text !== "string" || typeof heading !== "string" || heading.trim() === "") return null
    const want = heading.trim()
    const level = (/^#+/.exec(want) || [""])[0].length
    const isCode = codeLines()
    let inside = false
    let found = false
    const out = []
    for (const raw of text.split("\n")) {
        const line = raw.replace(/\r$/, "")
        if (isCode(line)) continue
        const h = /^(#{1,6})[ \t]/.exec(line)
        if (h) {
            if (inside && (level === 0 || h[1].length <= level)) break
            if (line.trim() === want) {
                inside = true
                found = true
                continue
            }
        }
        if (!inside) continue
        for (const m of line.matchAll(/`([^`]+)`/g)) {
            const span = m[1].trim().replace(/\\/g, "/").replace(LINES, "")
            if (span === "" || /\s/.test(span) || !/[/.]/.test(span) || span.startsWith(":")) continue
            const glob = normalizeGlob(span)
            if (glob !== null && !out.includes(glob)) out.push(glob)
        }
    }
    return found ? out : null
}

/** Whether `file` is named by the trail (a list from trailPaths). */
function namedByTrail(file, trail, options = {}) {
    return Array.isArray(trail) && isVerificationPath(file, trail, options)
}

// The folder part of a glob before its first segment with a glob character, "/"-ended ("" for the root).
function literalDir(glob) {
    const segments = glob.split("/")
    const at = segments.findIndex((s) => /[*?{]/.test(s))
    const dir = segments.slice(0, at === -1 ? segments.length - 1 : at).join("/")
    return dir ? `${dir}/` : ""
}

/**
 * The ticket of `branch` and its trail: read at `ref` of the repository with git, or, with `folder`, from the tickets
 * outside the repository (tickets.path taken from under tickets.root there). tickets: {branch, path, root, trail_section}
 * of the profile. git: the git executable (default "git").
 */
function readTrail({ repo, ref, branch, tickets, git = "git", folder = null }) {
    const t = tickets || {}
    const ticket = ticketOfBranch(branch, t.branch)
    if (!ticket) return { ticket: null, trail: null, reason: t.branch ? `the branch ${branch} is not ${t.branch}` : "the profile has no tickets.branch template" }
    let pattern = ticketPattern(t.path, ticket.epic, ticket.nn)
    if (!pattern) return { ticket: null, trail: null, reason: "the profile has no tickets.path with NN" }
    if (folder) {
        // the template is a path in the repository: under tickets.root it is a path in the tickets folder
        const root = typeof t.root === "string" ? t.root.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/*$/, "/") : ""
        if (root && pattern.startsWith(root)) pattern = pattern.slice(root.length)
    }
    const dir = literalDir(pattern)
    let names
    if (folder) {
        try {
            names = fs
                .readdirSync(path.join(folder, dir), { withFileTypes: true })
                .filter((e) => e.isFile())
                .map((e) => `${dir}${e.name}`)
        } catch {
            names = []
        }
    } else {
        const ls = spawnSync(git, ["-c", "core.quotePath=false", "ls-tree", "-r", "-z", "--name-only", ref, "--", dir || "."], { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 })
        if (ls.error || ls.status !== 0)
            return { ticket: { ...ticket, path: null }, trail: null, reason: `git ls-tree ${ref} could not be read: ${((ls.error && ls.error.message) || ls.stderr || "").trim().split("\n")[0]}`, unread: true }
        names = ls.stdout.split("\0").filter(Boolean)
    }
    // the names are relative; the root is absolute, so the match never depends on the working directory
    const hits = names.filter((n) => isVerificationPath(n, [pattern], { root: path.resolve(folder || repo) }))
    const where = folder ? "the tickets folder" : ref
    // the branch names a ticket, but its file cannot be told: the ticket is known, its trail is not
    const none = { ...ticket, path: null }
    if (!hits.length) return { ticket: none, trail: null, reason: `${pattern} is not in ${where}` }
    if (hits.length > 1) return { ticket: none, trail: null, reason: `${hits.length} files in ${where}: ${hits.join(", ")}` }
    const file = hits[0]
    let text
    if (folder) text = fs.readFileSync(path.join(folder, file), "utf8")
    else {
        const show = spawnSync(git, ["show", `${ref}:${file}`], { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 })
        if (show.error || show.status !== 0) return { ticket: { ...ticket, path: file }, trail: null, reason: `git show ${ref}:${file} could not be read`, unread: true }
        text = show.stdout
    }
    const found = { ...ticket, path: file }
    if (!t.trail_section) return { ticket: found, trail: null, reason: "the profile has no tickets.trail_section" }
    const trail = trailPaths(text, t.trail_section)
    return trail ? { ticket: found, trail, reason: null } : { ticket: found, trail: null, reason: `${file} has no section ${JSON.stringify(t.trail_section)}` }
}

module.exports = { ticketOfBranch, ticketPattern, trailPaths, namedByTrail, readTrail }
