#!/usr/bin/env node
// Quality gate. Runs lint and tests where files changed relative to the
// merge-base with origin/main, and when the base is doubtful (there is none, HEAD is detached,
// the branch is far from origin/main) — in every package; it prints the chosen scope and the reason
// as a line «[gate] scope …». Caches green results by a fingerprint of the
// content (a hit is printed as «[gate] green (…): … (cache)») and exits
// with code 2 on red («[gate] red (…): …»).
//
//   node gate.mjs fast   -> the per-ticket profile (TaskCompleted / TeammateIdle, through gate.sh)
//   node gate.mjs full   -> everything (by hand or when an epic closes)
//
// The repository is identified by its common git directory, not by its path: worktrees
// live both inside the repository and next to it (acme-review, acme-hotfix).
//
// The main rule: «nothing ran» is not «green». The red marker
// is removed only by a run that actually checked something.
//
// A warning is not a verdict. After the scope line the gate prints one line per file that the
// diff from the merge-base took over 1000 lines:
//   [gate] warning: file over 1000 lines: <path> (<lines at the merge-base> → <lines now>)
// It changes nothing else: the exit code, the verdict line, the verdict file, the markers and the
// cache are the same as without it, and a cache hit prints it again (see sizeWarnings below).
//
// Exit codes:
//   0 — green, «nothing ran», «not verified — environment
//       unavailable» (the unverified marker) or a directory outside git — they are told apart by
//       the «[gate] …» line, not by the code;
//   2 — red (TaskCompleted / TeammateIdle do not let the work finish on this code);
//   3 — not verified: neither green nor red. The line «[gate] not verified: …»
//       names the reason: the project is not registered in gate/config.json; the registry
//       cannot be read or the resolver crashed; node was not found (that one is said by
//       gate.sh, see "Without node" below). The code does not block hooks
//       (only 2 blocks). The gate leaves a marker per tree and session; stop.mjs
//       tells the model about it at most once per session per repository
//       (through additionalContext — that costs the model an extra turn, hence only once)
//       and does not hold the turn. Agents put code 3 into not_verified, skills do not merge on it.
//   129, 130, 143, 149 (128 + the number of a signal) — the gate itself was stopped. This run
//       wrote no verdict, marker or cache entry, and the work is not verified: see "A run that
//       was stopped" below, which also names the first moments of a run, where an earlier
//       verdict file may stay.
//
// The verdict file (a machine contract, so it carries no words of any one language).
// Every run inside a git worktree overwrites <state>/verdict-<tag>.json (the same folder and tag as
// the markers) with the outcome of that run; worfy reads it instead of the «[gate] …» line. A
// directory outside git leaves no file. The markers, the «[gate] …» lines and the exit codes stay
// as they are: stop.mjs, skills and agents read them. The file is one JSON object:
//   version  — 1;
//   outcome  — "green" | "red" | "unverified" | "none" (none = nothing ran, which is not green);
//   profile  — the profile argument ("fast" | "full");
//   worktree — the worktree root (git rev-parse --show-toplevel);
//   key      — the key of the gate registry entry, or null when the project was not determined;
//   head     — the SHA of HEAD, or null;
//   exit     — the exit code of this run (green 0, red 2, unverified 0 or 3, none 0);
//   at       — the time of the run, UTC, ISO 8601 without fractions (2026-10-07T12:00:00Z);
//   reason   — one line in English for "unverified" and "none", else null.
// The output logs (see gate-log.mjs). The whole output of every script the gate runs, green ones
// too, goes to <state>/logs/<tag>/<run>/<NN>-<label>.log. The report of a failed script keeps its
// last 40 lines right under «--- FAILED: <label>», then, for Playwright-shaped output, the failure
// blocks above those lines under «--- Playwright failures above the last 40 lines …», then the
// line «--- full output (<N> lines): <path>». The logs are written with the outcome, so a run that
// was stopped leaves none, and a cache hit runs nothing and writes no log.
//
// The verdict file is written whole or not at all: a temporary file in the same folder, then a rename. A run
// that could not write it removes the previous file, so the file never tells an older run's outcome.
// One case is left on Windows: while another process holds the file open, it can be neither
// replaced nor removed. The gate tries for half a second (see `patiently`); a file held longer
// than that stays as it is and tells the outcome of the run before.
//
// A script that a signal ended is a failed script: an out-of-memory kill (SIGKILL), a crash of
// native code (SIGSEGV, SIGABRT), a SIGTERM, SIGINT or SIGHUP the script got or sent itself. The
// run is red like any other failed script — code 2, the red marker, a red verdict file — and the
// report names the signal.
//
// A run that was stopped leaves nothing behind. Stopped means that the gate itself was told to
// stop and its own signal handler ran (a hook that ran out of time, Ctrl-C in the window of the
// gate): the gate exits with 128 + the number of the signal (SIGHUP 129, SIGINT 130, SIGTERM
// 143, Ctrl+Break of Windows 149) and writes no marker, no cache entry and no verdict file; the
// verdict file of the run before is removed, its markers stay.
// The gate looks for that signal (see "a signal while the gate waits"): after each call to the
// resolver or a script, after a call to git that a signal ended, before the cache answers and
// before a script starts, and once more right before the outcome is written down. A signal that
// comes during a call to git that ends well is seen at the next of these places, before any answer
// of that git is taken for a verdict or written down. Ctrl-C reaches the gate and the child it
// waits for, so the child's answer is never read before the handler of the gate has had its turn:
// the empty output of a killed `git diff` is not a clean tree, and a killed script does not make
// the run red. A child that a signal ended alone — no signal to the gate within half a second — is
// no answer either: a git ends the run as «[gate] not verified: git … was ended by the
// signal …» with code 3, the resolver as a resolver that crashed (code 3, the line names the
// signal), a script as a failed script (code 2). A git or a resolver whose output went past the
// limit the gate reads is ended by Node itself with SIGTERM: the line says so, not "the signal". Once the outcome is being written down, a signal no longer changes it: the gate
// exits with the code of that outcome.
// Two moments are left: a signal before the handlers exist — the first tens of milliseconds of
// the process, or the up to 2 s the gate waits on an open stdin that sends nothing — ends the
// process by the signal's default action. The code is the same, but the verdict file of an earlier
// run may still be in place.
// An error inside the gate itself — a git that a signal ended alone among them — ends as «[gate]
// not verified: …» with code 3, the marker nokey-broken-<tag>-<session> and no verdict file:
// the file of the run before is removed. One call is before all that: the first call to git, the
// one that finds the worktree. Until it answers, the gate knows neither the worktree's verdict file
// nor its tag, so an error there (git ended alone) leaves the verdict file of the run before in
// place and no marker.
//
// Without node this file cannot run, so the hooks do not start it themselves: hooks.json calls
// gate.sh, a launcher in bash next to this file. The launcher finds node — on PATH, else in the
// places a hook with a bare PATH misses — and starts this file with the same arguments and
// stdin. With no node anywhere it answers itself, as the bash gate this file replaced did:
// «node not found», code 3, the marker nokey-broken-<tag>-<session> and an "unverified" verdict
// file in place of the one of the run before. Rules, skills and agents run this file as
// `node …/gate.mjs`: with no node on their PATH that command fails with code 127 before a line
// of the gate runs and nothing is written, so a verdict file of an earlier run stays as it is.
// The launcher departs from two rules of the Harness: a hook command names `node`, not a script
// started by its first line; and nothing outside tests needs bash. It exists because nothing else
// can replace a stale verdict when node is missing. That gate.sh is the entry point of the hook
// was decided on 2026-10-14.
//
// One file for macOS, Linux and Windows: no shell utility, no path of one machine.
// Child processes get the PATH of this process plus the folder of the node that runs the gate
// and PNPM_HOME when it is set.

import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { playwrightFailures, pruneLogs, runLogDir, writeScriptLog } from "./gate-log.mjs"
import { endedBySignal, gateConfigFile, gateStateDir, repositoryRoot, worktreeRoot, worktreeTag } from "./gate-paths.mjs"
import { git as GIT } from "./eval-env.cjs"

const WINDOWS = process.platform === "win32"
const PROFILE = process.argv[2] || "fast"
// The scripts next to this one: the folder of its real file, not of a symlink to it.
const HERE = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
const CONFIG = gateConfigFile()
process.env.CLAUDE_GATE_CONFIG = CONFIG // the resolver reads the same registry
const STATE = gateStateDir()
const CACHE = path.join(STATE, "cache")
const BLOCKS = path.join(STATE, "stop-blocks") // stop.mjs counters and "once" files
const RESOLVE = process.env.CLAUDE_GATE_RESOLVE || path.join(HERE, "gate-resolve.mjs")
const GIT_OUTPUT_MAX = 1024 ** 3

const say = (text) => process.stdout.write(`${text}\n`)
const complain = (text) => process.stderr.write(`${text}\n`)
const lines = (text) => (text ? text.split("\n") : [])
const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex")
const utcNow = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")

let repo = "" // the worktree root, as git prints it
let tag = "" // the worktree tag in the names of markers and verdict files
let KEY = "" // the registry key; set once the resolver has named the project
let PM = "" // the package manager of the registry entry
let SESSION = ""
let mb = "" // the merge-base of HEAD with the base branch, or empty
let changed = [] // paths changed relative to the merge-base, plus the worktree and the index
let verdictFile = ""
let verdictWritten = false
let head = null // the SHA of HEAD for the verdict file, read by `settle`
let settled = false // the outcome is about to be written down: a signal no longer stops the run
let outcomeCode // the exit code of the outcome being written down, set by `settle`
let code // the exit code of the run, once main has returned

// --- a signal while the gate waits -------------------------------------------------------------
// A signal sent to the gate itself (a hook that ran out of time, Ctrl-C) waits while the gate
// waits for a child in a call that blocks it — git, the resolver, a script. Its handler (see
// main) runs when the event loop next looks for events, so the gate lets the loop go round after
// such a call and before it takes any answer as a verdict or writes anything down. Twice: an
// immediate set by code that runs from that look itself (as after stdin was read) comes before the
// next look, and only the one set from an immediate comes after it. Measured: one turn delivers
// nothing in that case.
//
// `childSignal` — the signal that ended the child, if one did. A signal to the whole process group
// reaches its processes one after another, so the gate may see the child ended before its own copy
// has come; it waits half a second for it before it reads the child as ended alone.
const STOP_WAIT_MS = 500
const turn = () => new Promise((resolve) => setImmediate(resolve))
async function stopIfTold(childSignal) {
    if (childSignal) await new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS))
    await turn()
    await turn()
}

// Called right before the outcome is written down, and nothing after it starts a child: what the
// verdict file needs from git is read first, then a pending signal still ends the run as stopped.
// After it the outcome is written in one go, and a signal only ends the gate with that outcome's code.
// `exit` is that code: the signal handler takes it from here, not from the return of main, so it
// holds even if the code between `settle` and the return of main ever waits for something.
async function settle(exit) {
    head = gitText("rev-parse", "-q", "--verify", "HEAD") || null
    await stopIfTold()
    outcomeCode = exit
    settled = true
}

// --- stdin ------------------------------------------------------------------------------
// Hooks send JSON on stdin and close it. When run by hand from the Bash tool, stdin is open and
// empty, and reading to the end would wait forever (that is how the gate "hung" until the owner
// asked "Are you stuck?"): read while data comes, and stop after two seconds of
// silence. On a terminal (stdin is a TTY) there is nothing to read.
const STDIN_SILENCE_MS = 2000
function readHookInput() {
    return new Promise((resolve) => {
        let stdin
        try {
            stdin = process.stdin // a closed descriptor 0 makes this getter throw
        } catch {
            return resolve("")
        }
        if (stdin.isTTY) return resolve("")
        let text = ""
        let timer = null
        const done = () => {
            clearTimeout(timer)
            stdin.removeAllListeners("data")
            stdin.pause()
            resolve(text)
        }
        const wait = () => {
            clearTimeout(timer)
            timer = setTimeout(done, STDIN_SILENCE_MS)
        }
        stdin.setEncoding("utf8")
        stdin.on("data", (chunk) => {
            text += chunk
            wait()
        })
        stdin.on("end", done)
        stdin.on("error", done)
        wait()
    })
}

// --- git ---------------------------------------------------------------------------------
// A git that a signal ended gave no answer: its empty output would read as "no edits" or "nothing
// changed", and the cache would answer for a tree it never saw. The run ends at the catch below main.
// So does a git whose output went past GIT_OUTPUT_MAX: Node ends such a child itself with SIGTERM,
// and its cut output is no answer either, but no signal came from outside.
function git(args, options = {}) {
    const run = spawnSync(GIT, ["-C", repo, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: GIT_OUTPUT_MAX,
        windowsHide: true,
        ...options,
    })
    if (tooMuchOutput(run)) throw new Error(`git ${args.join(" ")} ${OUTPUT_PAST_LIMIT}`)
    if (run.signal) throw endedBySignal(`git ${args.join(" ")}`, run.signal)
    return run
}

// A child whose output went past `maxBuffer`: Node ended it with SIGTERM itself, so its `signal`
// names no signal that came from outside.
const tooMuchOutput = (run) => run.error?.code === "ENOBUFS"
const OUTPUT_PAST_LIMIT = "wrote more output than the gate reads, and Node ended it"
// How a child that failed ended, in English, for a reason: past the output limit, by a signal from
// outside, or with an exit code.
function howEnded(run) {
    if (tooMuchOutput(run)) return OUTPUT_PAST_LIMIT
    if (run.signal) return `was ended by the signal ${run.signal}`
    return `exited with code ${run.status ?? 1}`
}
// The signal from outside that ended a child, if one did: what `stopIfTold` waits on.
const outsideSignal = (run) => (tooMuchOutput(run) ? null : run.signal)
const gitOk = (...args) => git(args).status === 0
// The output without its last line break, or empty when git failed.
const gitText = (...args) => {
    const run = git(args)
    return run.status === 0 ? run.stdout.replace(/\n+$/, "") : ""
}

// --- the verdict file and the markers ----------------------------------------------------
// Writes <state>/verdict-<tag>.json (see the header). A failed write changes nothing else: the
// markers, the line and the code stay; the exit handler in main removes the previous file.
function writeVerdict(outcome, exit, reason) {
    const verdict = {
        version: 1,
        outcome,
        profile: PROFILE,
        worktree: repo,
        key: KEY || null,
        head,
        exit,
        at: utcNow(),
        reason: reason ? reason.replaceAll("\n", " ") : null,
    }
    const tmp = path.join(STATE, `.verdict-${tag}.${process.pid}-${crypto.randomBytes(4).toString("hex")}`)
    try {
        fs.writeFileSync(tmp, `${JSON.stringify(verdict)}\n`, { flag: "wx" })
        patiently(() => fs.renameSync(tmp, verdictFile))
        verdictWritten = true
    } catch {
        remove(tmp)
    }
}

// On Windows a file that another process holds open cannot be replaced, and often cannot be
// removed: the answer is EPERM, EBUSY or EACCES until the other process closes it. worfy reads the
// verdict file for a moment at a time, so the action is tried again: ten times, 50 ms apart.
const HELD = new Set(["EPERM", "EBUSY", "EACCES"])
const HELD_TRIES = 10
const HELD_PAUSE_MS = 50
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
function patiently(action) {
    for (let tries = 1; ; tries++) {
        try {
            return action()
        } catch (error) {
            if (tries >= HELD_TRIES || !HELD.has(error?.code)) throw error
            pause(HELD_PAUSE_MS)
        }
    }
}

const writeMarker = (file, text) => {
    try {
        fs.writeFileSync(file, text)
    } catch {}
}
const remove = (file) => {
    try {
        patiently(() => fs.rmSync(file, { force: true }))
    } catch {}
}

// A name of a file made of `text`: every character that is not safe in a file name on every
// system — a separator, a colon, a space — becomes `_`.
const fileNamePart = (text) => text.replace(/[^A-Za-z0-9._-]/g, "_")

// Files of `dir` whose name passes `mine` and that were not touched for more than a week.
function removeOld(dir, mine) {
    const limit = Date.now() - 8 * 24 * 60 * 60 * 1000
    let names = []
    try {
        names = fs.readdirSync(dir)
    } catch {}
    for (const name of names.filter(mine)) {
        const file = path.join(dir, name)
        try {
            if (fs.statSync(file).mtimeMs < limit) fs.rmSync(file)
        } catch {}
    }
}

// "Could not verify" without a project key: code 3, the line «[gate] not
// verified: …» and a marker for stop.mjs. The marker is per tree and per session
// (nokey-<kind>-<tree>-<session>); with no session it is "anon", and stop.mjs takes such a
// marker only if it is newer than the start of its own session.
//   kind — unregistered | broken, text — what follows «not verified: »,
//   explain — an explanation for the model. Both go into the marker: "<text>. <explain>".
//   reason — the reason in English for the verdict file.
async function notVerified(kind, text, explain, reason) {
    await settle(3)
    writeMarker(path.join(STATE, `nokey-${kind}-${tag}-${SESSION || "anon"}`), `${text}. ${explain}\n`)
    writeVerdict("unverified", 3, reason)
    complain("[gate] not verified: " + text)
    complain(explain)
    return 3
}

// A path under the home folder with `~` in its place, as the message about the registry shows
// it. On Windows the rest gets `/`: that is how Git Bash, where the agent types, spells it.
function shortHome(file) {
    const home = os.homedir()
    if (!home) return file
    if (!WINDOWS) return file.startsWith(home) ? `~${file.slice(home.length)}` : file
    const fold = (p) => p.replaceAll("\\", "/").toLowerCase()
    return fold(file).startsWith(fold(home)) ? `~${file.slice(home.length).replaceAll("\\", "/")}` : file
}

// --- what changed --------------------------------------------------------------------------
function changedPaths() {
    const found = []
    // the worktree and the index, with rename arrows removed
    for (const line of lines(git(["-c", "core.quotePath=false", "status", "--porcelain"]).stdout)) {
        found.push(line.slice(3).replace(/^.* -> /, ""))
    }
    // everything the branch added on top of its base
    if (mb) found.push(...lines(git(["-c", "core.quotePath=false", "diff", "--name-only", `${mb}...HEAD`]).stdout))
    return [...new Set(found.map((p) => p.replace(/^"/, "").replace(/"$/, "")).filter(Boolean))].sort()
}

// --- files that grew past the size limit --------------------------------------------
// Counting lines is a deterministic check, so it lives here and not in a reviewer's prompt. The
// rule is about crossing the limit: a file that was already longer at the merge-base is left alone.
const FILE_LINES_MAX = 1000

// Not counted: lock files and generated files — nobody writes or reads them by hand.
const SIZE_EXEMPT =
    /(\.lock|-lock\.json|-lock\.yaml|\.min\.js|\.map|\.snap)$|(^|\/)(npm-shrinkwrap\.json|go\.sum)$|(^|\/)(dist|out|build)\//

// The lines of a file's bytes. A last line without a line break counts, as it does for git.
function countLines(bytes) {
    if (!bytes || !bytes.length) return 0
    let count = bytes[bytes.length - 1] === 10 ? 0 : 1
    for (let at = bytes.indexOf(10); at !== -1; at = bytes.indexOf(10, at + 1)) count++
    return count
}

// Prints the warning lines for the paths in `changed`. Without a merge-base there is nothing to
// compare with, and the check is skipped silently. It only reads: the worktree, the index and the
// gate state are left as they are.
function sizeWarnings() {
    if (!mb || !changed.length) return
    let renames = null // new path -> old path, read from git once and only when a long file is new
    for (const entry of changed) {
        // git status names an untracked folder (a trailing slash), not the files in it
        const paths = entry.endsWith("/")
            ? (git(["--literal-pathspecs", "ls-files", "-z", "--others", "--exclude-standard", "--", entry]).stdout ?? "").split("\0")
            : [entry]
        for (const file of paths) {
            if (!file || SIZE_EXEMPT.test(file)) continue
            const full = path.join(repo, file)
            let now
            try {
                // a deleted file, a folder (a submodule) and a symlink are not files to count
                if (!fs.lstatSync(full).isFile()) continue
                // Most files stop here, with no call to git: only a file that is long now is looked up.
                now = countLines(fs.readFileSync(full))
            } catch {
                continue
            }
            if (now <= FILE_LINES_MAX) continue
            // binary — by content or by .gitattributes: git prints "-" instead of the line counts
            if (git(["diff", "--no-index", "--numstat", "--", "/dev/null", file]).stdout?.startsWith("-\t")) continue
            // The file at the merge-base: under the same path, or under its old one after a rename —
            // a long file that only moved did not grow. A path that is in neither place is a new file.
            let old = file
            if (!gitOk("cat-file", "-e", `${mb}:${file}`)) {
                if (!renames) {
                    renames = new Map()
                    const moved = git(["-c", "core.quotePath=false", "diff", "-M", "--name-status", "--diff-filter=R", mb, "--"])
                    for (const line of lines(moved.stdout)) {
                        const [, from, to] = line.split("\t")
                        if (to && !renames.has(to)) renames.set(to, from)
                    }
                }
                old = renames.get(file) ?? ""
            }
            const before = old ? countLines(git(["cat-file", "blob", `${mb}:${old}`], { encoding: "buffer" }).stdout) : 0
            if (before > FILE_LINES_MAX) continue
            // A template literal on purpose: test/unit/gate-state.test.ts takes every double-quoted
            // «[gate] <word>» of this file for a verdict word, and this line is not a verdict.
            say(`[gate] warning: file over ${FILE_LINES_MAX} lines: ${file} (${before} → ${now})`)
        }
    }
}

// --- the cache of green runs ---------------------------------------------------------------
// A fingerprint without HEAD is a fingerprint of nothing, that is, an eternal constant: such a thing
// must not be cached (empty = no fingerprint).
// The paths are the package itself and its workspace dependencies: an uncommitted edit in
// packages/shared must change the fingerprint of every package that depends on it.
function fingerprint(paths) {
    const head = gitText("rev-parse", "HEAD")
    if (!head) return ""
    const hash = crypto.createHash("sha1")
    hash.update(`${head}\nscope: ${paths.join(" ")}\n`)
    hash.update(git(["diff", "HEAD", "--", ...paths], { encoding: "buffer" }).stdout ?? "")
    for (const file of git(["ls-files", "-z", "--others", "--exclude-standard", "--", ...paths]).stdout?.split("\0") ?? []) {
        if (!file) continue
        try {
            const content = fs.readFileSync(path.join(repo, file))
            hash.update(`${file}\0${content.length}\0`)
            hash.update(content)
        } catch {}
    }
    return hash.digest("hex")
}

// --- starting the package manager ----------------------------------------------------------
// On macOS and Linux the package manager is started without a shell: the names of the package
// and the script are arguments of the process, and no shell reads them.
//
// On Windows pnpm, npm and yarn are usually `.cmd` files (pnpm installed by npm or corepack has
// no .exe), and Node does not start a .cmd or .bat without a shell (CVE-2024-27980: EINVAL). So:
//   - the gate finds the file itself, the way cmd.exe would — the folders of PATH, the extensions
//     of PATHEXT, but not the current folder. A package manager that is not installed is then
//     known before anything starts, in the same words on every system: cmd.exe says it in the
//     language of the system and in its console code page, which no sign below can match;
//   - the file is started through cmd.exe as one command line with every word in double quotes.
//     Inside double quotes cmd.exe still expands %NAME% and, when delayed expansion is on, !NAME!;
//     a double quote ends the quoting; `^` and a `\` before the closing quote change what the
//     batch file or the program behind it receives. No escaping makes these safe for every batch
//     file, so a command line with such a word is not given to cmd.exe at all;
//   - the command line runs in a console of its own, switched to UTF-8 (code page 65001) before
//     the cmd.exe that reads the line starts. cmd.exe names a missing tool in the language of the
//     system and in the code page of its console (Russian in code page 866 on the owner's PC),
//     which no sign below can match. A cmd.exe that starts in a UTF-8 console answers in English,
//     and so does every cmd.exe the package manager starts for a script, because they share that
//     console. A program that writes UTF-8 itself (node) is not affected. What it takes:
//       * the child gets pipes, never a file the gate opened. With a stream handed over like that
//         Node starts a child in the console of its parent, `windowsHide` or not, and `chcp`
//         there would change the window of a person who runs the gate by hand, or the console
//         another gate is running in. With pipes and `windowsHide` the child has a hidden console
//         of its own (measured both ways);
//       * a first cmd.exe runs `chcp 65001` and then starts a second cmd.exe, which reads the
//         line. `chcp 65001 &` in front of the line itself is not enough: the cmd.exe that reads
//         it has chosen its language by then (measured: a .cmd that calls a missing tool is
//         answered in Russian);
//       * the second cmd.exe gets the line through an environment variable, expanded late
//         (`/v:on`, `!NAME!`): the first cmd.exe then passes it on unread, with its `&`, `|`,
//         `<`, `>` and brackets as they are;
//       * stderr joins stdout inside the line (`2>&1`), so the two come in the order they were
//         written;
//       * Ctrl+C in the window of the gate does not reach a console of another process, so the
//         gate ends the script itself: it waits for cmd.exe without blocking, and a signal to
//         the gate ends cmd.exe with everything it started (`taskkill /t`) before the gate exits;
//       * the gate waits for the script, not for the pipe: a process the script left behind may
//         hold the pipe open, and what is still in the pipe is read for half a second at most;
//       * a line longer than cmd.exe takes (8191 characters with the command in front of it) is
//         not started: the second cmd.exe would get an empty line and end with code 0;
//   - cmd.exe is the one of the system (<SystemRoot>\System32), not ComSpec: ComSpec may name
//     another shell, which would read the command line in its own way;
//   - cmd.exe cannot stand in a network folder (it would start in the Windows folder instead).
//     There, and for a word cmd.exe cannot be given, an .exe or .com is started directly, in the
//     console of the gate, and a .cmd or .bat is not started: the gate says "could not verify"
//     and why.
const CMD_UNSAFE = /["%!^\r\n\0]|\\$/
const SYSTEM32 = path.win32.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32")
const CMD_EXE = path.win32.join(SYSTEM32, "cmd.exe")
const CHCP = path.win32.join(SYSTEM32, "chcp.com")
const TASKKILL = path.win32.join(SYSTEM32, "taskkill.exe")
// The environment variable that carries the command line to the second cmd.exe, and how long
// that line may be: measured, a value of up to 8144 characters runs whole.
const LINE_VARIABLE = "WORFY_GATE_LINE"
const LINE_LIMIT = 8000
// How long the gate reads on from the pipe of a script that has ended.
const PIPE_GRACE_MS = 500
// The cmd.exe the gate is waiting for on Windows, if any (see `throughCmd` and `endRunning`).
let running = null

function findOnWindows(command) {
    const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    const names = [...(path.win32.extname(command) ? [command] : []), ...exts.map((ext) => command + ext)]
    const dirs = /[\\/]/.test(command)
        ? [repo]
        : (process.env.PATH || "")
              .split(";")
              .map((dir) => dir.replace(/^"|"$/g, ""))
              .filter(Boolean)
    for (const dir of dirs) {
        for (const name of names) {
            const file = path.win32.resolve(dir, name)
            try {
                if (fs.statSync(file).isFile()) return file
            } catch {}
        }
    }
    return null
}

const notFound = () => ({ error: Object.assign(new Error("not found"), { code: "ENOENT" }) })

// Ends the cmd.exe the gate is waiting for, with every process under it. A signal handler calls
// this: the script runs in a console of its own, where Ctrl+C in the window of the gate does not
// reach it.
function endRunning() {
    if (running?.pid === undefined) return
    spawnSync(TASKKILL, ["/pid", String(running.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true })
}

// Runs `line` — the command line for the second cmd.exe — in a hidden console of its own and
// waits for it without blocking, so that a signal handler can run meanwhile. Resolves with
// { result, out } as `start` returns them.
function throughCmd(line) {
    return new Promise((resolve) => {
        const chunks = []
        const late = []
        let child
        let done = false
        const finish = (result) => {
            if (done) return
            done = true
            running = null
            child?.stdout?.destroy()
            child?.stderr?.destroy()
            resolve({ result, out: Buffer.concat([...chunks, ...late]).toString("utf8") })
        }
        try {
            child = spawn(CMD_EXE, ["/d", "/v:on", "/s", "/c", `""${CHCP}" 65001 >nul 2>&1 & "${CMD_EXE}" /d /v:off /s /c !${LINE_VARIABLE}!"`], {
                cwd: repo,
                env: { ...process.env, [LINE_VARIABLE]: line },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
                windowsVerbatimArguments: true,
            })
        } catch (error) {
            finish({ error })
            return
        }
        running = child
        child.stdout.on("data", (chunk) => chunks.push(chunk))
        // Only the first cmd.exe writes here: the line sends its own stderr to stdout.
        child.stderr.on("data", (chunk) => late.push(chunk))
        child.on("error", (error) => finish({ error }))
        child.on("exit", (status, signal) => {
            const timer = setTimeout(() => finish({ status, signal }), PIPE_GRACE_MS)
            child.on("close", () => {
                clearTimeout(timer)
                finish({ status, signal })
            })
        })
    })
}

// Starts `words` (a command and its arguments) in the worktree and waits. Returns { result, out },
// through a promise when the start goes through cmd.exe: `result` is that of spawnSync (or its
// `status`, `signal` and `error` alone), or { refused: <why> } when Windows cannot be given these
// words safely; `out` is what the child wrote, stdout and stderr in the order they were written.
function start(words) {
    const direct = (file) => captured((stdio) => spawnSync(file, words.slice(1), { cwd: repo, stdio, windowsHide: true }))
    // An empty name is what a shell calls ": command not found"; spawnSync would throw on it.
    if (!words[0]) return { result: notFound(), out: "" }
    if (!WINDOWS) return direct(words[0])
    const file = findOnWindows(words[0])
    if (!file) return { result: notFound(), out: "" }
    const line = [file, ...words.slice(1)]
    const unsafe = line.find((word) => CMD_UNSAFE.test(word))
    let refused = ""
    if (/^[\\/]{2}/.test(path.win32.resolve(repo))) refused = `cmd.exe cannot start ${file} in the network folder ${repo}`
    else if (unsafe !== undefined) refused = `cmd.exe cannot be given ${JSON.stringify(unsafe)} safely (a quote, %, !, ^ or a trailing backslash)`
    if (refused) return /\.(exe|com)$/i.test(file) ? direct(file) : { result: { refused }, out: "" }
    // What `shell: true` would do, with the shell, the console and its code page chosen here.
    // /s makes cmd.exe drop the outer quotes and read the rest as it is.
    const command = `"${line.map((word) => `"${word}"`).join(" ")} 2>&1"`
    if (command.length > LINE_LIMIT) return { result: { refused: `cmd.exe cannot be given a command line of ${command.length} characters (${file} …)` }, out: "" }
    return throughCmd(command)
}

// The output of a child process started without cmd.exe, stdout and stderr in the order they
// were written: both go to one file in the state folder, which is read and removed. With no way
// to create the file the two are read apart and joined.
function captured(run) {
    const file = path.join(STATE, `.run-${tag}-${process.pid}.out`)
    let fd
    try {
        fd = fs.openSync(file, "w")
    } catch {
        const result = run(["ignore", "pipe", "pipe"])
        return { result, out: `${result.stdout ?? ""}${result.stderr ?? ""}` }
    }
    try {
        const result = run(["ignore", fd, fd])
        return { result, out: fs.readFileSync(file, "utf8") }
    } finally {
        try {
            fs.closeSync(fd)
        } catch {}
        remove(file)
    }
}

// Runs one script of the profile. pkg — the package name (empty = the repository root).
// Returns { rc, out }; { refused } too when the script was not started on purpose. A script
// that a signal ended has failed: `rc` is what a shell reports for it, 128 + the number of the
// signal (SIGKILL 137, SIGTERM 143), `out` is what the script wrote up to then plus one line
// that names the signal, and `signal` is its name. On Windows a script ends by a signal only when
// Node itself ended it.
async function runScript(pkg, script) {
    let words
    if (!pkg) words = [PM, "run", script]
    else if (PM === "pnpm") words = ["pnpm", "--filter", pkg, "run", script]
    else if (PM === "yarn") words = ["yarn", "workspace", pkg, "run", script]
    else words = ["npm", "run", script, "--workspace", pkg]
    const { result, out } = await start(words)
    if (result.refused) return { rc: 126, out: result.refused, refused: result.refused }
    // The words a shell would say: "command not found" is one of the signs of a missing environment.
    if (result.error?.code === "ENOENT") return { rc: 127, out: `gate: ${words[0]}: command not found` }
    if (result.error) return { rc: 126, out: `gate: ${words[0]}: ${result.error.message}` }
    // Without the line breaks at the end; on Windows a line break is CR LF.
    const text = out.replace(/[\r\n]+$/, "")
    if (result.signal) {
        const ended = `gate: ${words[0]}: ended by the signal ${result.signal}`
        return { rc: 128 + (os.constants.signals[result.signal] ?? 0), out: text ? `${text}\n${ended}` : ended, signal: result.signal }
    }
    return { rc: result.status ?? 1, out: text }
}

// A missing environment is not a defect in the code. It must not block, but it must
// not count as green either: such work stays unverified. The second sign is what cmd.exe says
// about a missing tool where bash says "command not found"; cmd.exe says it in English because
// the gate starts it in a console that is at UTF-8 already (see `start`). It is a sign on
// Windows only: elsewhere no shell says it, and a failed script that prints it has failed.
const UNVERIFIABLE = new RegExp(
    [
        "command not found",
        ...(WINDOWS ? ["is not recognized as an internal or external command"] : []),
        "Cache entry required but missing",
        "ENOENT.*node_modules",
        "Cannot connect to the Docker daemon",
        "Could not find a working container runtime",
        "docker daemon is not running",
        "ECONNREFUSED.*:5432",
        "could not connect to server",
    ].join("|")
)

// An environment line can also turn up in the stack trace of a real test failure.
// The sign of a live run matters more: if the tests reported, it is a failure, not the environment.
const REAL_FAILURE = /Tests?[ \t]+[0-9]+[ \t]+(failed|passed)|^ *FAIL |AssertionError|✗|Expected .* to/

// --- the run --------------------------------------------------------------------------------
async function main() {
    try {
        fs.mkdirSync(CACHE, { recursive: true })
        fs.mkdirSync(BLOCKS, { recursive: true })
    } catch {}

    const hookIn = await readHookInput()

    // Whose session this is: session_id from the hook JSON, else CLAUDE_CODE_SESSION_ID (a
    // manual run from the Bash tool sees it; subagents have the same one as their parent).
    // Needed so that the "could not verify" marker without a project key is delivered only to
    // the session that ran the gate, not to a neighbouring one in the same tree.
    SESSION = /"session_id"\s*:\s*"([^"]+)"/.exec(hookIn)?.[1] || process.env.CLAUDE_CODE_SESSION_ID || ""
    SESSION = SESSION.replace(/[^A-Za-z0-9_-]/g, "_")

    // The package manager and what it starts must find node and pnpm also where the PATH of the
    // hook is a bare one: the folder of this node and PNPM_HOME go after the PATH of the process.
    const known = (process.env.PATH || "").split(path.delimiter)
    const extra = [path.dirname(process.execPath), process.env.PNPM_HOME].filter((dir) => dir && !known.includes(dir))
    if (extra.length) process.env.PATH = [process.env.PATH, ...extra].filter(Boolean).join(path.delimiter)

    // What is checked is the worktree; what is identified is the repository as a whole.
    repo = worktreeRoot() ?? ""
    if (!repo) return 0
    tag = worktreeTag(repo)

    // The verdict file tells the outcome of the last run or nothing: a run that ends without writing
    // it (the write or the rename failed — a full disk — or any exit before writeVerdict) removes the
    // previous run's file, or worfy would show that outcome over what this run printed. The first
    // call to git, the one that finds the worktree, is the only one before this handler: until it
    // answers the gate does not know which file is the worktree's.
    verdictFile = path.join(STATE, `verdict-${tag}.json`)
    process.on("exit", () => {
        if (!verdictWritten) remove(verdictFile)
    })
    // SIGBREAK is Ctrl+Break in a console of Windows (signal 21); nothing sends it elsewhere.
    // Once the outcome is written down (see `settle`) the run has ended: the signal only cuts its
    // output short, and the gate exits with the code of that outcome, 3 if `settle` was given none.
    for (const [signal, stopped] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143], ["SIGBREAK", 149]]) {
        process.on(signal, () => {
            endRunning()
            process.exit(settled ? (outcomeCode ?? 3) : stopped)
        })
    }

    const canon = repositoryRoot(repo)
    if (!canon) return 0

    // Markers without a project key (project not determined) older than a week are garbage from
    // abandoned sessions and deleted worktrees; so are the temporary files (.run-…, .verdict-…)
    // of a gate that was killed before it removed them.
    removeOld(STATE, (name) => /^(nokey-|\.run-|\.verdict-)/.test(name))
    removeOld(BLOCKS, (name) => name.includes("__"))

    const which = spawnSync(process.execPath, [RESOLVE, "--which", canon], { encoding: "utf8", windowsHide: true })
    await stopIfTold(outsideSignal(which))
    if (which.status !== 0) {
        // A crashed resolver (broken registry, broken node) is not "a directory outside
        // the repositories" and not "not registered". Staying silent and exiting with 0 is not allowed either.
        // A resolver that a signal or the output limit ended has no exit code: the line says
        // what ended it, in English, as the line of a git that a signal ended does.
        const ended = howEnded(which)
        const byCode = !which.signal && !tooMuchOutput(which)
        const why = (which.stderr || (byCode ? which.error?.message : "") || "").split(/\r?\n/)[0]
        return notVerified(
            "broken",
            byCode ? "the registry resolver gate-resolve.mjs exited with code " + (which.status ?? 1) : `the registry resolver gate-resolve.mjs ${ended}`,
            `Repository: ${repo}. ${why ? `Reason: ${why}. ` : ""}Project not determined, nothing was checked — this is not green.`,
            `the registry resolver gate-resolve.mjs ${ended}${why ? `: ${why}` : ""}`
        )
    }
    // A repository outside the registry: there used to be a silent `exit 0` here, and "the gate is silent"
    // read as "the gate is happy". Now it is loud, with code 3.
    const entry = which.stdout.replace(/\r?\n+$/, "")
    if (!entry) {
        return notVerified(
            "unregistered",
            "the project is not registered in " + shortHome(CONFIG),
            `Repository ${repo} is not registered in ${CONFIG} — the gate checked nothing. This is not green: the work was not verified by the gate.`,
            `the project is not registered in ${CONFIG}`
        )
    }
    // Split by tabs by hand: the fields may be empty and must stay in their places.
    ;[KEY = "", , PM = ""] = entry.split("\t")

    // Markers are per worktree (tag above): a busy repository has a couple of dozen of them, and
    // red in one must not stop the turn from finishing in another.
    const redMarker = path.join(STATE, `red-${KEY}-${tag}`)
    const unverifiedMarker = path.join(STATE, `unverified-${KEY}-${tag}`)

    // --- which scope to check -------------------------------------------------------
    // Narrowing by the diff from the merge-base with origin/main is right only for an ordinary branch
    // forked recently. In every other case the diff errs on the small side, and
    // the gate silently checked one or two packages. Hence: no base, the merge-base cannot
    // be found, HEAD is detached or the branch is far from origin/main — check everything.
    // GATE_SCOPE=all forces the full scope.
    const maxAhead = process.env.GATE_MAX_AHEAD || "50"
    const maxBehind = process.env.GATE_MAX_BEHIND || "300"
    let scopeWhy = "" // not empty = every package
    let baseRef = gitText("symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if (!baseRef && gitOk("rev-parse", "--verify", "-q", "refs/remotes/origin/main")) baseRef = "origin/main"
    mb = baseRef ? gitText("merge-base", "HEAD", baseRef) : ""
    let ahead = ""
    let behind = ""
    if (process.env.GATE_SCOPE === "all") {
        scopeWhy = "set by GATE_SCOPE=all"
    } else if (!baseRef) {
        scopeWhy = "neither origin/HEAD nor origin/main exists — no base for a diff"
    } else if (!mb) {
        scopeWhy = `no merge-base of HEAD with ${baseRef}`
    } else if (!gitOk("symbolic-ref", "-q", "HEAD")) {
        scopeWhy = "HEAD is detached — unknown which branch is being checked"
    } else {
        const counts = /^(\d+)\s+(\d+)$/.exec(gitText("rev-list", "--left-right", "--count", `${baseRef}...HEAD`))
        if (!counts) {
            scopeWhy = `could not count the divergence from ${baseRef}`
        } else {
            ;[, behind, ahead] = counts
            if (Number(ahead) > Number(maxAhead)) {
                scopeWhy = `the branch is ${ahead} commits ahead of ${baseRef} (threshold GATE_MAX_AHEAD=${maxAhead}) — a long-lived branch`
            } else if (Number(behind) > Number(maxBehind)) {
                scopeWhy = `the branch is ${behind} commits behind ${baseRef} (threshold GATE_MAX_BEHIND=${maxBehind})`
            }
        }
    }
    const short = mb.slice(0, 8)

    changed = changedPaths()
    if (!scopeWhy && !changed.length) {
        await settle(0)
        writeVerdict("none", 0, `no changes relative to the merge-base ${short} with ${baseRef}`)
        say("[gate] nothing ran (" + PROFILE + "): no changes relative to the merge-base " + short + " with " + baseRef + ". This is not green.")
        return 0
    }

    const planned = spawnSync(process.execPath, [RESOLVE, repo, PROFILE, KEY], {
        input: `${changed.join("\n")}\n`,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "inherit"],
        env: { ...process.env, GATE_ALL: scopeWhy ? "1" : "0" },
        maxBuffer: GIT_OUTPUT_MAX,
        windowsHide: true,
    })
    await stopIfTold(outsideSignal(planned))
    if (planned.status !== 0) {
        // A crashed resolver would give an empty plan, and an empty plan reads as "nothing
        // touched". That is not so: verification failed. The red marker is left alone.
        const ended = howEnded(planned)
        const byCode = !planned.signal && !tooMuchOutput(planned)
        await settle(3)
        writeMarker(unverifiedMarker, `Profile ${PROFILE}, repository ${KEY}. Could not verify: the plan resolver ${ended}.\n`)
        writeVerdict("unverified", 3, `the plan resolver gate-resolve.mjs ${ended}`)
        complain(
            "[gate] not verified: " +
                (byCode ? "the plan resolver gate-resolve.mjs exited with code " + (planned.status ?? 1) : `the plan resolver gate-resolve.mjs ${ended}`) +
                " — nothing was checked, this is not green."
        )
        return 3
    }
    // One line per package: its folder, its name, the scripts, the paths of the fingerprint and
    // what it was added from. Empty fields stay in their places.
    const plan = lines(planned.stdout)
        .map((line) => line.replace(/\r$/, ""))
        .filter(Boolean)
        .map((line) => line.split("\t"))

    // The scope is always printed: it shows whether the gate narrowed and why.
    const planDirs = plan.map(([dir]) => ` ${dir}`).join("") || " none"
    const planAdded = plan
        .filter((fields) => fields[4])
        .map((fields) => `${fields[0]} (from ${fields[4].replaceAll(",", ", ")})`)
        .join(", ")
    if (scopeWhy) {
        say("[gate] scope (" + PROFILE + `): all packages —${planDirs} (reason: ${scopeWhy})`)
    } else {
        say(
            "[gate] scope (" +
                PROFILE +
                `): narrowed by the diff from merge-base ${short} with ${baseRef} (branch ahead by ${ahead}, behind by ${behind}; files changed: ${changed.length}) —${planDirs}${planAdded ? `; added as dependents: ${planAdded}` : ""}. Full scope: GATE_SCOPE=all`
        )
    }
    // Before the cache is looked at and before any verdict: a green cache hit must not hide a warning.
    sizeWarnings()
    if (!plan.length) {
        await settle(0)
        writeVerdict("none", 0, "the changes touch no checked package")
        say("[gate] nothing ran (" + PROFILE + "): the changes touch no checked package. This is not green.")
        return 0
    }

    let ran = ""
    let cached = ""
    let failedLabels = ""
    let envBroken = ""
    const logs = [] // [log file name, output] of each script that ran
    const failures = [] // [label, log file name] of each script that failed; the output is in `logs`
    const logDir = runLogDir(STATE, tag) // named by the time the scripts start, written at the end
    const greens = [] // [cache file, fingerprint] of each package whose scripts all passed
    for (const [wsdir, pkgname = "", scriptList = "", fpscope = ""] of plan) {
        const scripts = scriptList.split(" ").filter(Boolean)
        if (!scripts.length) continue

        // The key includes the set of scripts too: the profile was widened — the old green does not count.
        // The key, the folder and the profile come from the registry, the workspace list and the
        // command line: in the name they keep only characters of a file name, so the file lies in
        // the cache folder whatever they hold (`packages\a`, `..`); the hash keeps apart two
        // folders that give the same name.
        const cacheName = [KEY, tag, wsdir, PROFILE].map(fileNamePart).join("__")
        const cacheFile = path.join(CACHE, `${cacheName}__${sha1(`${wsdir}\n${scriptList}`).slice(0, 8)}`)
        const fp = fingerprint((fpscope || wsdir).split(" ").filter(Boolean))
        // Before the cache answers and before a script starts: a gate that was told to stop
        // starts nothing.
        await stopIfTold()
        let green = ""
        try {
            green = fs.readFileSync(cacheFile, "utf8").trim()
        } catch {}
        if (fp && green === fp) {
            // Unchanged since it turned green. Only green is cached:
            // red is always run again, so that a flaky test does not stick.
            for (const script of scripts) cached += ` ${KEY}/${wsdir}:${script}`
            continue
        }

        let wsOk = true
        for (const script of scripts) {
            const label = `${KEY}/${wsdir}:${script}`
            const { rc, out, refused, signal } = await runScript(pkgname, script)
            // Right after the script returns and before its result is looked at: a script that
            // Ctrl-C ended together with the gate would otherwise count as failed, and one that
            // ended well on the signal as passed.
            await stopIfTold(signal)
            const outLines = out.split(/\r?\n/)
            const logName = `${String(logs.length + 1).padStart(2, "0")}-${fileNamePart(label)}.log`
            logs.push([logName, out])
            if (rc === 0) {
                ran += ` ${label}`
                continue
            }
            wsOk = false
            const sign = refused ?? (outLines.some((line) => REAL_FAILURE.test(line)) ? undefined : outLines.find((line) => UNVERIFIABLE.test(line)))
            if (sign !== undefined) {
                envBroken += `\n  ${label}: ${sign}`
            } else {
                failedLabels += ` ${label}`
                failures.push([label, logName])
            }
        }

        // Written down with the outcome below, so that a stopped run leaves no cache entry.
        if (wsOk && fp) greens.push([cacheFile, fp])
    }

    // Red is code 2; the environment unavailable, green and nothing ran are all code 0.
    await settle(failedLabels ? 2 : 0)
    // Only after `settle`: a run stopped before it writes no cache entry. And whatever the outcome:
    // a package whose scripts all passed is green for its fingerprint, even when another package
    // of the same run is red.
    for (const [cacheFile, fp] of greens) writeMarker(cacheFile, `${fp}\n`)
    // The logs too: a run that was stopped writes nothing to the state folder.
    const saved = new Set(logs.filter(([name, out]) => writeScriptLog(logDir, name, out)).map(([name]) => name))
    if (logs.length) pruneLogs(STATE, tag, logDir)
    if (failedLabels) {
        let report = ""
        const outputs = new Map(logs)
        for (const [label, name] of failures) {
            const outLines = outputs.get(name).split(/\r?\n/)
            report += `\n--- FAILED: ${label}\n${outLines.slice(-40).join("\n")}\n`
            const above = playwrightFailures(outLines, Math.max(0, outLines.length - 40))
            if (above.length) report += `--- Playwright failures above the last 40 lines (from the full output):\n${above.join("\n")}\n`
            report += saved.has(name) ? `--- full output (${outLines.length} lines): ${path.join(logDir, name)}\n` : `--- full output: not saved, ${logDir} could not be written\n`
        }
        writeMarker(redMarker, `${utcNow()}\n`)
        writeVerdict("red", 2, "")
        complain("[gate] red (" + PROFILE + "):" + failedLabels + (ran ? " (passed:" + ran + ")" : ""))
        complain(`The quality gate did not pass (profile: ${PROFILE}, repository: ${KEY}).`)
        complain("This must be fixed before reporting the work as done.")
        complain(report)
        return 2
    }

    if (envBroken) {
        writeMarker(unverifiedMarker, `Profile ${PROFILE}, repository ${KEY}. Could not verify:${envBroken}\n`)
        writeVerdict("unverified", 0, `the environment is unavailable:${envBroken.replaceAll("\n", " ").replace(/ +/g, " ")}`)
        complain("[gate] not verified — environment unavailable:")
        complain(envBroken)
        complain("This is not a green result. Say so: the work is not verified — instead of a success report.")
    } else if (ran || cached) {
        // Clear only on the result of a check that actually checked something:
        // a fresh run or a cache entry written by a green run of the same content.
        // Otherwise a red state could be washed away by editing a document.
        remove(redMarker)
        remove(unverifiedMarker)
        // The "could not verify" marker an error of the gate or a crashed resolver left in this
        // tree and session: a green run has shown that the gate works here now.
        remove(path.join(STATE, `nokey-broken-${tag}-${SESSION || "anon"}`))
        let blocks = []
        try {
            blocks = fs.readdirSync(BLOCKS)
        } catch {}
        for (const name of blocks) if (name.endsWith(`__${KEY}-${tag}`)) remove(path.join(BLOCKS, name))
        writeVerdict("green", 0, "")
        // The line «[gate] green (<profile>): …» is the only sign of green, and
        // on a cache hit it is printed too, marked «(cache)».
        if (!ran) say("[gate] green (" + PROFILE + "):" + cached + " (cache)")
        else if (cached) say("[gate] green (" + PROFILE + "):" + ran + " (cache:" + cached + ")")
        else say("[gate] green (" + PROFILE + "):" + ran)
    } else {
        writeVerdict("none", 0, "the selected packages have no scripts of the profile")
        say("[gate] nothing ran (" + PROFILE + "): the selected packages have no scripts of the profile. This is not green.")
    }
    return 0
}

// The lines above are written before the process ends: on some systems stdout and stderr of a
// pipe or a terminal are written in the background, and process.exit would cut them short.
const written = (stream) => new Promise((resolve) => stream.write("", () => resolve()))
process.stdout.on("error", () => {})
process.stderr.on("error", () => {})
try {
    code = await main()
} catch (error) {
    // An error of the gate itself is neither green nor red: code 3 and one line, not a stack
    // trace with code 1. Whatever verdict this run wrote no longer holds: the exit handler removes it.
    // A git that a signal ended (see `git`) is such an error, unless the signal came to the gate
    // too: then its handler ends the run as stopped while the gate waits here. Such an error
    // comes only before `settle` has finished.
    // Once the worktree is known (`tag`), the error leaves the marker of a resolver that crashed,
    // nokey-broken-<tag>-<session>: stop.mjs tells the model about it as about any "could not verify".
    // The loop goes round for every error, not only for a child ended by a signal: the gate may
    // have been told to stop while it waited on a git that then failed in another way (past the
    // output limit, say), and such a run is stopped, not "could not verify".
    verdictWritten = false
    await stopIfTold(error?.childSignal)
    outcomeCode = 3
    settled = true
    const text = String(error?.message ?? error).split(/\r?\n/)[0]
    const explain = "The gate itself failed and checked nothing — this is not green."
    if (tag) writeMarker(path.join(STATE, `nokey-broken-${tag}-${SESSION || "anon"}`), `${text}. ${explain}\n`)
    complain("[gate] not verified: " + text)
    complain(explain)
    code = 3
}
await written(process.stdout)
await written(process.stderr)
process.exit(code)
