// The move of a project's workflow files between Full mode and Silent mode (profiles/README.md, "Full mode
// and Silent mode"): `bin/profile-set --move <full|silent>` plans it, checks it and runs it here, and writes
// `mode` and `workflow.folder` itself only once the files have moved.
//
// The workflow files are the paths the profile names relative to the Workflow folder: the tickets root
// (tickets.root, `.scratch` without it; the epic specs and evidence live in it) and the folders of
// tickets.path and tickets.spec before their first placeholder, the state file (docs.handoff.path), the ADR
// folder (docs.adr_dir, numbering.adr.dir), the glossary (docs.context.path) and the lessons (`lessons:
// "repo:<path>"`). An absolute or `~/` path is outside both folders and stays where it is. Full mode keeps
// them in the project's repository, Silent mode in the Workflow folder, a git repository outside it
// (`<profile folder>/workflow` by default, made with `git init` when absent).
//
//   planMove({ profile, resolved, to, folder, profileDir, gh }) → { problems, plan }
//     Reads, writes nothing. problems: the reasons the move is refused (empty — it may go ahead): already in
//     that mode; Full mode for a project of several repositories; a Workflow folder inside the repository
//     (by its real path: a link on the way counts) or, when the move would create it, inside any git work
//     tree; a folder that is not a git repository of its own or has no branch checked out; uncommitted or
//     untracked files in the repository or the Workflow folder; a file of the move already at its new place;
//     an open PR of a ticket's branch (gh unable to tell is a refusal too). `resolved` is
//     `bin/profile --json`'s `_resolved`. plan.ignored: the files the receiving side's .gitignore ignores; the
//     move adds them all the same (`git add -f`), so nothing is left out of its commit.
//   runMove(plan, { failAt, killAt, alive }) → state
//     Writes the marker of the move (markerPath: the plan, next to profile.json), then copies the tracked
//     files of each path to the other side, commits them there, removes them on this side with `git rm` and
//     commits that. Each commit's message names where the files went or came from. A failure undoes what was
//     done (undoMove) and throws, with `undoProblems` on the error when the undo itself left something
//     behind. `failAt` (tests only): copy | to-commit | from-commit — fail as that step starts; `killAt` —
//     end the process there, as a kill would. `alive` is called before each step and every 200 copied files
//     (profile-set touches its lock with it).
//   undoMove(state) → problems
//     Puts both sides back as they were before runMove: the commits taken back, the removed files restored
//     from the commit before, the copied ones deleted one by one by name (a folder only once it is empty, so
//     a file anybody else put there stays), the git repository the move made removed. The marker goes when
//     nothing is left. profile-set calls it when the profile cannot be written after the
//     files moved, and removes the marker itself after a written profile.
//   recoverMove(profileDir, profile) → null | { finished } | { rolledBack, problems }
//     A marker left by a move that was killed (a timeout, the app's quit, a power cut): when the profile
//     already has the new mode the move had finished and the marker goes; otherwise both sides are put back
//     from what git says now, but only while each side is as that move left it: at the commit the marker
//     recorded or the move's own commit on top of it (changing only the move's files), and in the working
//     tree nothing but the move's own removals (the side the files left) or its own copies with the content
//     they had where they came from (the side they came to). Anything else — a person's new file, an edit, a
//     commit, a reset — is a problem that names the marker, and nothing is touched. A marker that cannot be
//     read throws an error that says to check both sides and delete it by hand.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { git: GIT } = require("../hooks/eval-env.cjs")

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const at = (object, dotted) => dotted.split(".").reduce((v, k) => (isObject(v) && Object.hasOwn(v, k) ? v[k] : undefined), object)
// The variables of a surrounding hook or `git -c` that would point git at another repository (the list
// `git rev-parse --local-env-vars` prints) are dropped; the rest stay. Dropping every GIT_* also dropped
// GIT_CONFIG_NOSYSTEM and GIT_CONFIG_GLOBAL: git then read another config than the caller's, and on Windows,
// whose system config has core.autocrlf=true, a rollback wrote CRLF files the caller's git saw as changed.
const LOCAL_REPO_ENV = new Set([
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_OBJECT_DIRECTORY",
    "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_INTERNAL_SUPER_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR",
])
const gitEnv = () =>
    Object.fromEntries(Object.entries(process.env).filter(([key]) => !LOCAL_REPO_ENV.has(key) && !/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)))
const git = (cwd, args) => spawnSync(GIT, ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, env: gitEnv(), maxBuffer: 1 << 26 })
/** git with `input` on stdin: lists of thousands of paths go there, not on a command line Windows caps at 32K characters. */
const gitIn = (cwd, args, input) => spawnSync(GIT, ["-C", cwd, ...args], { input, encoding: "utf8", windowsHide: true, env: gitEnv(), maxBuffer: 1 << 26 })
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
/** The path with its nearest existing ancestor resolved through links (realpath), the rest joined as given. */
function resolveThroughLinks(p) {
    let existing = path.resolve(p)
    const rest = []
    while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
        rest.unshift(path.basename(existing))
        existing = path.dirname(existing)
    }
    return path.join(realDir(existing), ...rest)
}
/** The nearest existing folder at or above `p`. */
function nearestExisting(p) {
    let at = path.resolve(p)
    while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at)
    return at
}

/** Where the marker of a move in progress lives: next to profile.json. */
const markerPath = (profileDir) => path.join(profileDir, ".move-in-progress.json")

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
        // The folders of the ticket and spec templates before their first placeholder or wildcard.
        ...["tickets.path", "tickets.spec"].map((f) => {
            const v = at(profile, f)
            if (typeof v !== "string") return undefined
            const parts = v.trim().replace(/\\/g, "/").split("/")
            const fixed = []
            for (const part of parts.slice(0, -1)) {
                if (/[<*?[]/.test(part)) break
                fixed.push(part)
            }
            return fixed.length > 0 ? fixed.join("/") : undefined
        }),
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
        // gh runs git too: an inherited GIT_DIR would point the check at another repository.
        env: { ...gitEnv(), GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
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
    let madeTop = null
    if (to === "silent") {
        if (folder !== null && !path.isAbsolute(folder)) return { problems: [`the Workflow folder must be an absolute path, not ${folder}`], plan: null }
        // Through links: a folder reached through a link into the repository is inside it.
        workflow = resolveThroughLinks(folder ?? path.join(profileDir, "workflow"))
        if (fs.existsSync(workflow)) {
            const entries = fs.readdirSync(workflow)
            if (entries.length === 0) createFolder = "init"
        } else {
            createFolder = "make"
            // The topmost folder the move makes: an undo removes up to it, once each is empty.
            const above = nearestExisting(workflow)
            madeTop = path.join(above, path.relative(above, workflow).split(path.sep)[0])
        }
        // A folder this move would create must not land in another git work tree, where it would show as
        // untracked files. The default one lies in the Harness home, whose .gitignore leaves it out.
        const byDefault = workflow === resolveThroughLinks(path.join(profileDir, "workflow"))
        if (createFolder && !byDefault) {
            const above = createFolder === "init" ? path.dirname(workflow) : nearestExisting(workflow)
            const top = git(above, ["rev-parse", "--show-toplevel"])
            if (top.status === 0 && !top.error && top.stdout.trim() !== "")
                problems.push(`the Workflow folder ${workflow} would be made inside the git repository ${realDir(top.stdout.trim())}: choose a folder outside every repository`)
        }
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
        // Every untracked file, whatever status.showUntrackedFiles says.
        const status = git(side.root, ["status", "--porcelain", "--untracked-files=all"])
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
    // The files the receiving side's .gitignore would leave out of its commit: added all the same, and said.
    let ignored = []
    const all = moves.flatMap((m) => m.files)
    if (!createFolder && all.length > 0) {
        const r = spawnSync(GIT, ["-C", target, "check-ignore", "--no-index", "-z", "--stdin"], { input: all.join("\0"), encoding: "utf8", windowsHide: true, env: gitEnv() })
        // Exit 1: none is ignored.
        if (r.status === 0) ignored = r.stdout.split("\0").filter(Boolean)
        else if (r.status !== 1 || r.error) problems.push(`git check-ignore in ${target} failed: ${said(r)}`)
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
    return { problems, plan: { to, repo, workflow, source, target, createFolder, madeTop, moves, ignored, profileDir } }
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
function runMove(plan, { failAt = "", killAt = "", alive = () => {} } = {}) {
    const files = plan.moves.flatMap((m) => m.files)
    const state = { plan, files, made: false, initialized: false, copied: [], toHead: null, fromHead: null, toCommitted: false, removed: false, fromCommitted: false }
    const step = (name, fn) => {
        // A kill (tests only): the process ends here, the marker and what was done so far left as they are.
        if (killAt === name) process.exit(137)
        if (failAt === name) throw new Error(`failed at ${name} (PROFILE_SET_MOVE_FAIL_AT)`)
        alive()
        fn()
    }
    try {
        writeMarker(plan, files, headOf(plan.source), plan.createFolder ? null : headOf(plan.target))
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
        const rels = plan.moves.map((m) => m.rel)
        const text = messages(plan)
        step("copy", () => {
            for (const [i, file] of files.entries()) {
                if (i % 200 === 199) alive()
                const from = path.join(plan.source, ...file.split("/"))
                const to = path.join(plan.target, ...file.split("/"))
                // Named before it is written: a copy cut short is the move's too, and the undo deletes it by name.
                state.copied.push(file)
                fs.mkdirSync(path.dirname(to), { recursive: true })
                const stat = fs.lstatSync(from)
                if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to)
                else fs.copyFileSync(from, to)
            }
        })
        if (files.length === 0) return state
        step("to-commit", () => {
            // -f: a file the receiving side's .gitignore ignores (plan.ignored) moves with the rest.
            must(git(plan.target, ["add", "-f", "--", ...rels]), "git add of the moved files")
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

/** Removes the folders from `dir` up to (not including) `top` while they are empty. */
function pruneEmpty(dir, top) {
    for (let at = dir; at !== top && inside(at, top); at = path.dirname(at)) {
        try {
            fs.rmdirSync(at)
        } catch {
            return
        }
    }
}

/**
 * Puts both sides back as they were before runMove; returns what could not be put back. The side the files came
 * to loses only the files the move copied, each by its own name: a folder goes only once it is empty, so a file
 * anybody else put there stays.
 */
function undoMove(state) {
    const { plan } = state
    const problems = []
    const tryStep = (what, fn) => {
        try {
            fn()
            return true
        } catch (e) {
            problems.push(`${what}: ${e.message}`)
            return false
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
    // The side the files came to: the commit taken back, the copies unstaged and deleted one by one.
    let targetOk = true
    if (state.toCommitted) {
        targetOk = tryStep("taking back the commit in " + plan.target, () =>
            must(git(plan.target, state.toHead ? ["reset", "-q", "--soft", state.toHead] : ["update-ref", "-d", "HEAD"]), "git reset --soft"),
        )
    }
    if (targetOk && state.copied.length > 0 && fs.existsSync(path.join(plan.target, ".git"))) {
        targetOk = tryStep("unstaging the copies in " + plan.target, () =>
            must(gitIn(plan.target, ["rm", "-q", "--cached", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"], state.copied.join("\0")), "git rm --cached"),
        )
    }
    if (targetOk) {
        for (const file of state.copied) {
            const at = path.join(plan.target, ...file.split("/"))
            if (tryStep("deleting " + file + " in " + plan.target, () => fs.rmSync(at, { force: true }))) pruneEmpty(path.dirname(at), plan.target)
        }
        // A git repository the move made goes with it; the folder too, when the move made it and it is empty now.
        if (state.initialized && problems.length === 0) {
            tryStep("removing the git repository made in " + plan.workflow, () => fs.rmSync(path.join(plan.workflow, ".git"), { recursive: true, force: true }))
            if (state.made && plan.madeTop) pruneEmpty(plan.workflow, path.dirname(plan.madeTop))
        }
    }
    // The marker stays while something is left, so the next move tries again and names it.
    if (problems.length === 0) clearMarker(plan.profileDir)
    return problems
}

/** Writes the marker of a move about to start: what recoverMove needs to put both sides back. */
function writeMarker(plan, files, fromHead, toHead) {
    const marker = {
        to: plan.to,
        repo: plan.repo,
        workflow: plan.workflow,
        source: plan.source,
        target: plan.target,
        createFolder: plan.createFolder,
        madeTop: plan.madeTop ?? null,
        rels: plan.moves.map((m) => m.rel),
        files,
        fromHead,
        toHead,
        messages: messages(plan),
        started: new Date().toISOString(),
    }
    const file = markerPath(plan.profileDir)
    fs.writeFileSync(`${file}.tmp-${process.pid}`, JSON.stringify(marker, null, 2) + "\n")
    fs.renameSync(`${file}.tmp-${process.pid}`, file)
}

/** Removes the marker; a marker already gone is fine. */
function clearMarker(profileDir) {
    fs.rmSync(markerPath(profileDir), { force: true })
}

/**
 * The marker of a move that did not end, or null. A marker that cannot be read (cut short, edited) throws an
 * error that says what to do: nothing can be put back from it.
 */
function readMarker(profileDir) {
    const file = markerPath(profileDir)
    if (!fs.existsSync(file)) return null
    const fail = (why) =>
        new Error(
            `the marker ${file} of a move that did not end cannot be read (${why}): check the repository and the Workflow folder, put back by hand what that move left (its commits "Move the workflow files…" and the files it copied), then delete the marker`,
        )
    let marker
    try {
        marker = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch (e) {
        throw fail(e.message)
    }
    const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string")
    const shaOrNull = (v) => v === null || (typeof v === "string" && /^[0-9a-f]{7,64}$/.test(v))
    const ok =
        isObject(marker) &&
        (marker.to === "full" || marker.to === "silent") &&
        ["repo", "workflow", "source", "target"].every((k) => typeof marker[k] === "string" && path.isAbsolute(marker[k])) &&
        [false, "make", "init"].includes(marker.createFolder) &&
        strings(marker.rels) &&
        strings(marker.files) &&
        shaOrNull(marker.fromHead) &&
        shaOrNull(marker.toHead) &&
        isObject(marker.messages) &&
        typeof marker.messages.to === "string" &&
        typeof marker.messages.from === "string"
    if (!ok) throw fail("it is not the marker of a move")
    return marker
}

/**
 * How a side stands after a killed move: { at: "before" } (still at `base`), { at: "committed" } (one commit on
 * top of `base` with the move's own message, changing only the move's files), or { problem } — it is gone, moved on
 * or was moved elsewhere since, and only a person can tell what to keep.
 */
function sideState(root, base, message, files, named) {
    if (!fs.existsSync(root)) return { problem: `${root} is gone since ${named}: put it back by hand, then delete the marker` }
    const head = headOf(root)
    if (head === base) return { at: "before" }
    const parent = git(root, ["rev-parse", "-q", "--verify", "HEAD^"])
    const parentSha = parent.status === 0 ? parent.stdout.trim() : null
    const subject = git(root, ["log", "-1", "--format=%s"]).stdout.trim()
    if (head !== null && parentSha === base && subject === message) {
        const changed = git(root, ["diff-tree", "--root", "-r", "--no-commit-id", "--name-only", "-z", "HEAD"]).stdout.split("\0").filter(Boolean)
        const listed = new Set(files)
        const foreign = changed.filter((f) => !listed.has(f))
        if (foreign.length === 0) return { at: "committed" }
        return { problem: `the commit "${message}" in ${root} changes files the move did not (${shown(foreign)}): put it back by hand, then delete the marker` }
    }
    const since = base !== null && head !== null && git(root, ["merge-base", "--is-ancestor", base, "HEAD"]).status === 0
    if (since || base === null) return { problem: `${root} has commits since ${named}: put it back by hand, then delete the marker` }
    return {
        problem: `${root} is not at the commit ${base.slice(0, 9)} that ${named} recorded (its branch was reset or another one checked out): put it back by hand, then delete the marker`,
    }
}

/** Up to five names, and how many more. */
const shown = (list) => `${list.slice(0, 5).join(", ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}`

/** The entries of `git status --porcelain -z --untracked-files=all` in `root`: { xy, file }. */
function statusOf(root) {
    const r = git(root, ["status", "--porcelain", "-z", "--untracked-files=all"])
    if (r.status !== 0 || r.error) throw new Error(`git status in ${root} failed: ${said(r)}`)
    const parts = r.stdout.split("\0")
    const entries = []
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (part === "") continue
        const xy = part.slice(0, 2)
        entries.push({ xy, file: part.slice(3) })
        // A rename or copy is followed by its old name.
        if (xy[0] === "R" || xy[0] === "C") i += 1
    }
    return entries
}

/** Every file of `root` below it, with "/" between parts, the .git folder left out. */
function filesUnder(root) {
    const out = []
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (rel === "" && entry.name === ".git") continue
            const name = rel === "" ? entry.name : `${rel}/${entry.name}`
            if (entry.isDirectory()) walk(path.join(dir, entry.name), name)
            else out.push(name)
        }
    }
    if (fs.existsSync(root)) walk(root, "")
    return out
}

/** Rolls back or closes a move a killed profile-set left behind; see the header. */
function recoverMove(profileDir, profile, { alive = () => {} } = {}) {
    const marker = readMarker(profileDir)
    if (marker === null) return null
    if (profile.mode === marker.to) {
        clearMarker(profileDir)
        return { finished: true }
    }
    const plan = {
        to: marker.to,
        repo: marker.repo,
        workflow: marker.workflow,
        source: marker.source,
        target: marker.target,
        createFolder: marker.createFolder,
        madeTop: marker.madeTop ?? null,
        moves: marker.rels.map((rel) => ({ rel, files: [] })),
        profileDir,
    }
    const files = marker.files
    const listed = new Set(files)
    const named = `the marker ${markerPath(profileDir)} of a move that did not end`
    const problems = []
    const targetGit = fs.existsSync(path.join(plan.target, ".git"))
    const from = sideState(plan.source, marker.fromHead, marker.messages.from, files, named)
    // A Workflow folder the move made or git-initialized has no repository yet when the move was killed before
    // `git init`: it stands "before" while nothing is in it.
    const to = targetGit || !plan.createFolder ? sideState(plan.target, marker.toHead, marker.messages.to, files, named) : { at: "before" }
    for (const side of [from, to]) if (side.problem) problems.push(side.problem)
    alive()
    // The working trees: on each side only what the move itself left may differ from its commit. On the side the
    // files left: the move's own removals. On the side they came to, before its commit: the move's copies, each
    // with the content it had where it came from. Anything else is a person's change: nothing is touched.
    if (from.at) {
        const entries = statusOf(plan.source)
        const foreign = entries.filter((e) => !(from.at === "before" && (e.xy === "D " || e.xy === " D") && listed.has(e.file))).map((e) => e.file)
        if (foreign.length > 0) problems.push(`${plan.source} has changes since ${named} (${shown(foreign)}): commit, move or remove them by hand, then move again`)
    }
    if (to.at && plan.createFolder && !targetGit) {
        const foreign = filesUnder(plan.target).filter((f) => !listed.has(f))
        if (foreign.length > 0) problems.push(`${plan.target} has files since ${named} (${shown(foreign)}): move or remove them by hand, then move again`)
    } else if (to.at) {
        const entries = statusOf(plan.target)
        const foreign = entries.filter((e) => !(to.at === "before" && (e.xy === "??" || e.xy === "A ") && listed.has(e.file))).map((e) => e.file)
        if (foreign.length > 0) problems.push(`${plan.target} has changes since ${named} (${shown(foreign)}): commit, move or remove them by hand, then move again`)
    }
    // The copies on the side the files came to, before its commit, still hold what the move wrote: the blob each
    // file had at the commit the move started from. A copy edited since is a person's change too.
    if (problems.length === 0 && to.at === "before" && marker.fromHead !== null) {
        const present = files.filter((f) => fs.existsSync(path.join(plan.target, ...f.split("/"))))
        if (present.length > 0) {
            const tree = gitIn(plan.source, ["ls-tree", "-r", "-z", marker.fromHead, "--", ...marker.rels], "")
            const blob = new Map()
            for (const line of tree.stdout.split("\0").filter(Boolean)) {
                const tab = line.indexOf("\t")
                blob.set(line.slice(tab + 1), line.slice(0, tab).split(" ")[2])
            }
            const hashed = targetGit
                ? gitIn(plan.target, ["hash-object", "--stdin-paths"], present.join("\n") + "\n")
                : spawnSync(GIT, ["hash-object", "--stdin-paths"], { cwd: plan.target, input: present.join("\n") + "\n", encoding: "utf8", windowsHide: true, env: gitEnv(), maxBuffer: 1 << 26 })
            if (hashed.status !== 0 || hashed.error) problems.push(`git hash-object in ${plan.target} failed: ${said(hashed)}`)
            else {
                const sums = hashed.stdout.split("\n").filter(Boolean)
                const edited = present.filter((f, i) => blob.get(f) !== sums[i])
                if (edited.length > 0) problems.push(`${plan.target} has files changed since ${named} (${shown(edited)}): keep a copy of them elsewhere and restore them, then move again`)
            }
        }
    }
    if (problems.length > 0) return { rolledBack: false, problems }
    alive()
    const state = {
        plan,
        files,
        made: plan.createFolder === "make",
        initialized: Boolean(plan.createFolder),
        copied: files,
        toHead: marker.toHead,
        fromHead: marker.fromHead,
        toCommitted: to.at === "committed",
        removed: from.at === "before",
        fromCommitted: from.at === "committed",
    }
    return { rolledBack: true, problems: undoMove(state) }
}

module.exports = { workflowPaths, ticketBranches, planMove, runMove, undoMove, recoverMove, clearMarker, markerPath, readMarker }
