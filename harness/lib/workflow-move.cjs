// The move of a project's workflow files between Full mode and Silent mode (profiles/README.md, "Full mode
// and Silent mode"): `bin/profile-set --move <full|silent>` plans it, checks it and runs it here, and writes
// `mode` and `workflow.folder` itself only once the files have moved.
//
// The workflow files are the paths the profile names relative to the Workflow folder: the tickets root
// (tickets.root, `.scratch` without it; the epic specs and evidence live in it), the state file
// (docs.handoff.path), the ADR folder (docs.adr_dir, numbering.adr.dir), the glossary (docs.context.path) and
// the lessons (`lessons: "repo:<path>"`). An absolute or `~/` path is outside both folders and stays where it
// is. Full mode keeps them in the project's repository, Silent mode in the Workflow folder, a git repository
// outside it (`<profile folder>/workflow` by default, made with `git init` when absent).
//
//   planMove({ profile, resolved, to, folder, profileDir, gh }) → { problems, plan }
//     Reads, writes nothing. problems: the reasons the move is refused (empty — it may go ahead): already in
//     that mode; Full mode for a project of several repositories; a folder that is not a git
//     repository of its own or has no branch checked out; uncommitted changes in the repository or the
//     Workflow folder; a file of the move already at its new place; an open PR of a ticket's branch (gh
//     unable to tell is a refusal too). `resolved` is `bin/profile --json`'s `_resolved`.
//   runMove(plan, { failAt }) → state
//     Copies the tracked files of each path to the other side, commits them there, removes them on this
//     side with `git rm` and commits that. Each commit's message names where the files went or came from. A
//     failure undoes what was done (undoMove) and throws, with `undoProblems` on the error when the undo
//     itself left something behind. `failAt` (tests only): copy | to-commit | from-commit — fail as that
//     step starts.
//   undoMove(state) → problems
//     Puts both sides back as they were before runMove: the commits taken back, the removed files restored
//     from the commit before, the copied ones deleted, a Workflow folder the move created removed.
//     profile-set calls it when the profile cannot be written after the files moved.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { git: GIT } = require("../hooks/eval-env.cjs")

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const at = (object, dotted) => dotted.split(".").reduce((v, k) => (isObject(v) && Object.hasOwn(v, k) ? v[k] : undefined), object)
// GIT_* of a surrounding hook would point git at another repository.
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
const git = (cwd, args) => spawnSync(GIT, ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, env: gitEnv() })
const said = (r) => (r.error ? r.error.message : (r.stderr || r.stdout || `exit ${r.status}`).trim().split("\n")[0])
const realDir = (p) => {
    try {
        return fs.realpathSync.native(p)
    } catch {
        return path.resolve(p)
    }
}
const inside = (inner, outer) => {
    const rel = path.relative(outer, inner)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/** The workflow paths of a profile, relative to the Workflow folder, with "/" between parts; one inside another is left out. */
function workflowPaths(profile) {
    const ticketsRoot = at(profile, "tickets.root")
    const lessons = profile.lessons
    const given = [
        typeof ticketsRoot === "string" && ticketsRoot.trim() ? ticketsRoot : ".scratch",
        at(profile, "docs.handoff.path"),
        at(profile, "docs.adr_dir"),
        at(profile, "numbering.adr.dir"),
        at(profile, "docs.context.path"),
        typeof lessons === "string" && lessons.startsWith("repo:") ? lessons.slice("repo:".length) : undefined,
    ]
    const paths = []
    for (const raw of given) {
        if (typeof raw !== "string") continue
        const p = raw.trim().replace(/\\/g, "/")
        if (p === "" || p === "~" || p.startsWith("~/") || path.posix.isAbsolute(p) || path.win32.isAbsolute(p)) continue
        const norm = path.posix.normalize(p).replace(/\/+$/, "")
        // The root itself or a path above it is no workflow file of its own: nothing to move.
        if (norm === "." || norm === "" || norm === ".." || norm.startsWith("../")) continue
        if (!paths.includes(norm)) paths.push(norm)
    }
    const within = (a, b) => a === b || a.startsWith(`${b}/`)
    return paths.filter((p) => !paths.some((q) => q !== p && within(p, q)))
}

/** Whether `folder` is the top of a git repository of its own (not a folder inside another one). */
function ownRepository(folder) {
    const top = git(folder, ["rev-parse", "--show-toplevel"])
    return top.status === 0 && !top.error && realDir(top.stdout.trim()) === realDir(folder)
}

/** The tracked files of `rel` in the repository at `root`, with "/" between parts. */
function trackedFiles(root, rel) {
    const r = git(root, ["ls-files", "-z", "--", rel])
    if (r.status !== 0 || r.error) throw new Error(`git ls-files in ${root} failed: ${said(r)}`)
    return r.stdout.split("\0").filter(Boolean)
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** The branches of the tickets under `ticketsRoot`: their `Branch:` lines and the profile's branch template for each epic. */
function ticketBranches(ticketsRoot, template) {
    const exact = new Set()
    const patterns = []
    let epics
    try {
        epics = fs.readdirSync(ticketsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
        return { exact, patterns }
    }
    for (const epic of epics) {
        const issues = path.join(ticketsRoot, epic.name, "issues")
        let files
        try {
            files = fs.readdirSync(issues).filter((f) => f.endsWith(".md"))
        } catch {
            continue
        }
        if (typeof template === "string" && template.includes("<epic>")) {
            const source = escapeRe(template)
                .replace(/<epic>/g, escapeRe(epic.name))
                .replace(/<NN>/g, "\\d+")
                .replace(/<[a-z-]+>/g, ".+")
            patterns.push(new RegExp(`^${source}$`))
        }
        for (const file of files) {
            let text
            try {
                text = fs.readFileSync(path.join(issues, file), "utf8")
            } catch {
                continue
            }
            // The header: the lines before the first section.
            const header = text.split(/\r?\n## /)[0]
            for (const m of header.matchAll(/^Branch:[ \t]*(\S+)[ \t]*$/gm)) exact.add(m[1])
        }
    }
    return { exact, patterns }
}

/**
 * The open PRs of the repository at `repo`: { prs } or { error }. A repository without a remote has none.
 * `gh` is the program to start (a test's stand-in; a .mjs, .cjs or .js one runs with this node).
 */
function openPrs(repo, gh) {
    const remotes = git(repo, ["remote"])
    if (remotes.status === 0 && remotes.stdout.trim() === "") return { prs: [] }
    const args = ["pr", "list", "--state", "open", "--limit", "500", "--json", "number,headRefName"]
    const [program, argv] = /\.(mjs|cjs|js)$/.test(gh) ? [process.execPath, [gh, ...args]] : [gh, args]
    const r = spawnSync(program, argv, {
        cwd: repo,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    })
    if (r.error) return { error: r.error.code === "ENOENT" ? "gh not found" : r.error.message }
    if (r.status !== 0) return { error: said(r) }
    try {
        const list = JSON.parse(r.stdout)
        if (!Array.isArray(list)) throw new Error("not a list")
        return { prs: list.filter((pr) => isObject(pr) && typeof pr.headRefName === "string") }
    } catch (e) {
        return { error: `gh printed no list of PRs (${e.message})` }
    }
}

/** The plan of a move, and the reasons it is refused. Writes nothing. */
function planMove({ profile, resolved, to, folder, profileDir, gh }) {
    const problems = []
    const from = resolved.mode
    if (to === from) return { problems: [`the project is already in ${to === "full" ? "Full" : "Silent"} mode`], plan: null }
    const repos = Array.isArray(resolved.repos) ? resolved.repos : []
    if (repos.length > 1) {
        return { problems: ["a project over several repositories is always in Silent mode: it cannot move to Full mode"], plan: null }
    }
    if (repos.length === 0) return { problems: ["the project has no repository in the gate registry"], plan: null }
    const repo = realDir(repos[0].path)
    let workflow
    let createFolder = false
    if (to === "silent") {
        if (folder !== null && !path.isAbsolute(folder)) return { problems: [`the Workflow folder must be an absolute path, not ${folder}`], plan: null }
        workflow = path.resolve(folder ?? path.join(profileDir, "workflow"))
        if (fs.existsSync(workflow)) {
            workflow = realDir(workflow)
            const entries = fs.readdirSync(workflow)
            if (entries.length === 0) createFolder = "init"
        } else createFolder = "make"
    } else {
        if (folder !== null) return { problems: ["Full mode has no Workflow folder: the files move into the repository"], plan: null }
        workflow = realDir(resolved.workflow_folder)
        if (!fs.existsSync(workflow)) return { problems: [`the Workflow folder ${workflow} does not exist`], plan: null }
    }
    if (inside(workflow, repo) || inside(repo, workflow)) problems.push("the Workflow folder must lie outside the project's repository")

    // Each side: a git repository of its own, with a branch checked out, and nothing uncommitted.
    const sides = [{ root: repo, what: "the repository" }]
    if (!createFolder) sides.push({ root: workflow, what: "the Workflow folder" })
    for (const side of sides) {
        if (!ownRepository(side.root)) {
            problems.push(`${side.what} ${side.root} is not a git repository of its own: the move commits on both sides`)
            continue
        }
        if (git(side.root, ["symbolic-ref", "-q", "HEAD"]).status !== 0) problems.push(`${side.what} has no branch checked out (detached HEAD): the move would commit on no branch`)
        const status = git(side.root, ["status", "--porcelain"])
        if (status.status !== 0 || status.error) problems.push(`git status in ${side.what} failed: ${said(status)}`)
        else if (status.stdout.trim() !== "") problems.push(`${side.what} has uncommitted changes: commit or stash them first`)
    }
    if (problems.length > 0) return { problems, plan: null }

    const source = to === "silent" ? repo : workflow
    const target = to === "silent" ? workflow : repo
    const moves = []
    for (const rel of workflowPaths(profile)) {
        const files = trackedFiles(source, rel)
        if (files.length === 0) continue
        if (fs.existsSync(path.join(target, ...rel.split("/")))) problems.push(`${rel} is already in ${to === "silent" ? "the Workflow folder" : "the repository"}: nothing is moved over it`)
        moves.push({ rel, files })
    }

    // The open PRs of the tickets' branches.
    const ticketsRel = workflowPaths({ tickets: profile.tickets })[0]
    const branches = ticketBranches(path.join(source, ...(ticketsRel || ".scratch").split("/")), at(profile, "tickets.branch"))
    const listed = openPrs(repo, gh)
    if (listed.error) problems.push(`whether a ticket has an open PR cannot be told (gh: ${listed.error})`)
    else {
        const open = listed.prs.filter((pr) => branches.exact.has(pr.headRefName) || branches.patterns.some((re) => re.test(pr.headRefName)))
        if (open.length > 0) problems.push(`tickets have open PRs: ${open.map((pr) => `#${pr.number} (${pr.headRefName})`).join(", ")} — merge or close them first`)
    }
    if (problems.length > 0) return { problems, plan: null }
    return { problems, plan: { to, repo, workflow, source, target, createFolder, moves } }
}

/** The identity flags for a commit in `root`: the repository's own, or a stand-in when it has none. */
function commitArgs(root) {
    const args = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"]
    const email = git(root, ["config", "user.email"])
    if (email.status !== 0 || email.stdout.trim() === "") args.push("-c", "user.name=Harness", "-c", "user.email=harness@localhost")
    return args
}

function must(r, what) {
    if (r.status !== 0 || r.error) throw new Error(`${what} failed: ${said(r)}`)
    return r.stdout
}

/** The commit a side is at, or null when it has none yet. */
const headOf = (root) => {
    const r = git(root, ["rev-parse", "-q", "--verify", "HEAD"])
    return r.status === 0 ? r.stdout.trim() : null
}

function messages(plan) {
    const name = (p) => path.basename(p)
    return plan.to === "silent"
        ? {
              to: `Move the workflow files here from the repository ${name(plan.repo)} (Full mode to Silent mode)`,
              from: "Move the workflow files out of the repository into the project's Workflow folder (Silent mode)",
          }
        : {
              to: "Move the workflow files into the repository from the project's Workflow folder (Silent mode to Full mode)",
              from: `Move the workflow files to the repository ${name(plan.repo)} (Silent mode to Full mode)`,
          }
}

/** Runs the plan; a failure undoes what was done and throws. */
function runMove(plan, { failAt = "" } = {}) {
    const state = { plan, made: false, initialized: false, copied: [], toHead: null, fromHead: null, toCommitted: false, removed: false, fromCommitted: false }
    const step = (name, fn) => {
        if (failAt === name) throw new Error(`failed at ${name} (PROFILE_SET_MOVE_FAIL_AT)`)
        fn()
    }
    try {
        if (plan.createFolder === "make") {
            fs.mkdirSync(plan.workflow, { recursive: true })
            state.made = true
        }
        if (plan.createFolder) {
            must(git(plan.workflow, ["init", "-q"]), `git init in ${plan.workflow}`)
            state.initialized = true
        }
        state.toHead = headOf(plan.target)
        state.fromHead = headOf(plan.source)
        const all = plan.moves.flatMap((m) => m.files)
        const rels = plan.moves.map((m) => m.rel)
        const text = messages(plan)
        step("copy", () => {
            for (const rel of rels) state.copied.push(rel)
            for (const file of all) {
                const from = path.join(plan.source, ...file.split("/"))
                const to = path.join(plan.target, ...file.split("/"))
                fs.mkdirSync(path.dirname(to), { recursive: true })
                const stat = fs.lstatSync(from)
                if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to)
                else fs.copyFileSync(from, to)
            }
        })
        if (all.length === 0) return state
        step("to-commit", () => {
            must(git(plan.target, ["add", "--", ...rels]), "git add of the moved files")
            must(git(plan.target, [...commitArgs(plan.target), "commit", "-q", "--no-verify", "-m", text.to]), `git commit in ${plan.target}`)
            state.toCommitted = true
        })
        step("from-commit", () => {
            must(git(plan.source, ["rm", "-r", "-q", "--", ...rels]), "git rm of the moved files")
            state.removed = true
            must(git(plan.source, [...commitArgs(plan.source), "commit", "-q", "--no-verify", "-m", text.from]), `git commit in ${plan.source}`)
            state.fromCommitted = true
        })
        return state
    } catch (e) {
        const undoProblems = undoMove(state)
        const error = new Error(`${e.message}; the move was rolled back${undoProblems.length ? `, except: ${undoProblems.join("; ")}` : ""}`)
        error.undoProblems = undoProblems
        throw error
    }
}

/** Puts both sides back as they were before runMove; returns what could not be put back. */
function undoMove(state) {
    const { plan } = state
    const problems = []
    const tryStep = (what, fn) => {
        try {
            fn()
        } catch (e) {
            problems.push(`${what}: ${e.message}`)
        }
    }
    const rels = plan.moves.map((m) => m.rel)
    // The side the files left: the commit taken back and the files restored from the commit before. After the
    // commit, `reset --keep` does both in one step and leaves the index with the files' own stat data; it touches
    // only the files the commit changed, and refuses rather than overwrite a change made since.
    if (state.fromCommitted) tryStep("taking back the commit in " + plan.source, () => must(git(plan.source, ["reset", "-q", "--keep", state.fromHead]), "git reset --keep"))
    else if (state.removed) {
        tryStep("restoring the files in " + plan.source, () => {
            must(git(plan.source, ["reset", "-q", state.fromHead, "--", ...rels]), "git reset of the moved files")
            must(git(plan.source, ["checkout", state.fromHead, "--", ...rels]), "git checkout of the moved files")
        })
    }
    // The side the files came to: the commit taken back, the copies deleted.
    if (state.toCommitted) {
        tryStep("taking back the commit in " + plan.target, () =>
            must(git(plan.target, state.toHead ? ["reset", "-q", "--soft", state.toHead] : ["update-ref", "-d", "HEAD"]), "git reset --soft"),
        )
    }
    if (state.made) tryStep("removing " + plan.workflow, () => fs.rmSync(plan.workflow, { recursive: true, force: true }))
    else {
        if (state.copied.length > 0) {
            tryStep("unstaging the copies in " + plan.target, () => must(git(plan.target, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...state.copied]), "git rm --cached"))
            for (const rel of state.copied) tryStep("deleting " + rel, () => fs.rmSync(path.join(plan.target, ...rel.split("/")), { recursive: true, force: true }))
        }
        if (state.initialized) tryStep("removing the git repository made in " + plan.workflow, () => fs.rmSync(path.join(plan.workflow, ".git"), { recursive: true, force: true }))
    }
    return problems
}

module.exports = { workflowPaths, ticketBranches, planMove, runMove, undoMove }
