// What the qmd scripts of the Harness share (bin/qmd-mcp, bin/qmd-refresh, bin/qmd-sync-main,
// bin/qmd-collections): where qmd keeps its files on this system, which qmd to start and how, the
// lock of an index update, and the update itself.
//
// `node qmd-common.cjs --update-job <qmd> <label> <stamp|no-stamp>` is that update as a process of its own:
// qmd-mcp and qmd-refresh start it in the background with the qmd they found and write its pid into the lock.
//
// Environment for tests: QMD_NODE_VERSION stands for the version of the running node, and
// QMD_NPM_PREFIX for the answer of `npm prefix -g`.
"use strict"

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")
const { harnessHome } = require("../hooks/eval-env.cjs")

const WINDOWS = process.platform === "win32"

// --- the folders qmd uses (dist/paths.js and dist/collections.js of qmd 2.8.3). home() is qmd's idea of
// the home folder and is for these folders only: the Harness state comes from harnessHome() of
// hooks/eval-env.cjs. --------------------------------------------------------------------------
const home = () => process.env.HOME || process.env.USERPROFILE || os.homedir()
const cacheDir = () => path.join(process.env.XDG_CACHE_HOME || path.join(home(), ".cache"), "qmd")
const indexYml = () =>
    process.env.QMD_INDEX_YML ||
    (process.env.QMD_CONFIG_DIR
        ? path.join(process.env.QMD_CONFIG_DIR, "index.yml")
        : path.join(process.env.XDG_CONFIG_HOME || path.join(home(), ".config"), "qmd", "index.yml"))
const answerFile = () => path.join(harnessHome(), "qmd-models")
const lockDir = () => path.join(cacheDir(), "refresh.lock")
const logFile = () => path.join(cacheDir(), "refresh.log")
const indexedFile = () => path.join(cacheDir(), "last-index")

// --- the models: the worfy app keeps the same URIs, and a contract test checks that they agree ---
const EMBED_MODEL = "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
const RU_GENERATE_MODEL = "hf:AGmind/qmd-query-expansion-ru/qmd-query-expansion-ru-q4_k_m.gguf"
const DEFAULT_GENERATE_MODEL = "hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf"

// The answer about the models, its lines; [] when there is no file.
function answerLines() {
    try {
        return fs.readFileSync(answerFile(), "utf8").split(/\r?\n/)
    } catch {
        return []
    }
}
const modelsAgreed = () => answerLines()[0] === "downloaded"

// What an agent does when qmd cannot run.
const GREP_FALLBACK = "search with grep over the profile's qmd.fallback_grep"

// --- node: better-sqlite3 of qmd is built for N-API 10, and a node without it ends with an access
// violation (0xC0000005 on Windows) when it loads the module, without a word. N-API 10 came in 22.14
// on the 22 line and in 23.6 on the 23 line. The worfy app draws the same line, and a contract test
// checks that they agree. ---------------------------------------------------------------------
function nodeTooOld(version = process.env.QMD_NODE_VERSION || process.versions.node) {
    const [major = 0, minor = 0] = version.split(".").map(Number)
    if (major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 14)) return null
    return `node ${version} is too old for qmd, which needs 22.14 or newer (23.6 or newer on the 23 line) and dies on an older one without a word`
}

// --- starting a script or qmd ---------------------------------------------------------------
function firstLine(file) {
    try {
        const fd = fs.openSync(file, "r")
        try {
            const buf = Buffer.alloc(256)
            return buf.toString("latin1", 0, fs.readSync(fd, buf, 0, buf.length, 0)).split("\n")[0]
        } finally {
            fs.closeSync(fd)
        }
    } catch {
        return null
    }
}
const namesNode = (line) => line !== null && line.startsWith("#!") && /\bnode\b/.test(line)

// What runs a file. A node script (a #! line naming node) with this node, on every system. A #! line
// naming another interpreter by that line, through bash on Windows, which cannot start it by that line.
// A file without a #! line is a program, not a script: it starts as it is, a binary runs, and a text
// file gets the system's refusal, which the caller reports with the file's name. Node would run a binary
// as JavaScript and answer with a SyntaxError about it.
function scriptCommand(file, args) {
    const line = firstLine(file)
    if (namesNode(line)) return [process.execPath, [file, ...args]]
    if (line !== null && line.startsWith("#!") && WINDOWS) return ["bash", [file, ...args]]
    return [file, args]
}
const runScript = (file, args, opts = {}) => {
    const [command, argv] = scriptCommand(file, args)
    return spawnSync(command, argv, { encoding: "utf8", windowsHide: true, ...opts })
}

// The JavaScript file behind npm's qmd.cmd in `dir`: Node starts no .cmd without a shell, and the file
// runs with this node, the one the version check looked at. Null when there is no such shim.
function npmShimTarget(dir) {
    let text
    try {
        text = fs.readFileSync(path.join(dir, "qmd.cmd"), "utf8")
    } catch {
        return null
    }
    const target = /%~?dp0%?[\\/]([^"\r\n]*node_modules[^"\r\n]*)"/.exec(text)
    if (!target) return null
    const file = path.join(dir, target[1])
    return fs.existsSync(file) ? file : null
}
function isFile(file) {
    try {
        return fs.statSync(file).isFile()
    } catch {
        return false
    }
}
function qmdIn(dir) {
    const plain = path.join(dir, "qmd")
    if (!WINDOWS) {
        try {
            fs.accessSync(plain, fs.constants.X_OK)
            return isFile(plain) ? plain : null
        } catch {
            return null
        }
    }
    // Windows: npm's shim, or a Node script named qmd. npm also leaves a `#!/bin/sh` file named qmd there.
    const shim = npmShimTarget(dir)
    if (shim) return shim
    return isFile(plain) && namesNode(firstLine(plain)) ? plain : null
}
// `npm prefix -g`: a `.cmd` on Windows, which only a shell starts; the arguments are constant words.
function npmPrefix() {
    if (process.env.QMD_NPM_PREFIX) return process.env.QMD_NPM_PREFIX
    const run = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8", windowsHide: true, timeout: 15_000, stdio: ["ignore", "pipe", "ignore"], shell: WINDOWS })
    return run.status === 0 ? run.stdout.trim() || null : null
}
// qmd: on the PATH, then in the global folder of npm, then in a node of nvm (a Mac app started
// without the user's PATH has none of it). Null when there is none.
function findQmd() {
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        const found = dir && qmdIn(dir)
        if (found) return found
    }
    const prefix = npmPrefix()
    if (prefix) {
        const found = qmdIn(WINDOWS ? prefix : path.join(prefix, "bin"))
        if (found) return found
    }
    for (const version of nvmVersions()) {
        const found = qmdIn(nvmBin(version))
        if (found) return found
    }
    return null
}
const nvmBin = (version) => path.join(home(), ".nvm", "versions", "node", version, "bin")
// The node versions of nvm, newest first; [] without nvm.
function nvmVersions() {
    try {
        return fs.readdirSync(path.join(home(), ".nvm", "versions", "node")).sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
    } catch {
        return []
    }
}
// The first node on the PATH is too old: when a node of nvm at or above the limit has qmd, the script runs
// again on it, and this process ends with the same code (0 under --quiet, the Stop hook). A synchronous child:
// a client that ends an MCP server closes its stdin, and that ends the child. A node that cannot start is passed
// over, and asked first with no stream open: on Linux the system hands a broken file to a shell, which prints its
// error and exits 127, the same code a script may end with. Returns only when no such node runs.
const nodeStarts = (node) => spawnSync(node, ["--version"], { stdio: "ignore", windowsHide: true }).status === 0
function rerunOnNvmNode() {
    if (process.env.QMD_RERUN_ON_NVM) return // the node of this run was that node: its folder name lied
    for (const version of nvmVersions()) {
        const node = path.join(nvmBin(version), WINDOWS ? "node.exe" : "node")
        if (nodeTooOld(version.replace(/^v/, "")) || !isFile(node) || !qmdIn(nvmBin(version)) || !nodeStarts(node)) continue
        const env = { ...process.env, QMD_RERUN_ON_NVM: "1" }
        delete env.QMD_NODE_VERSION
        const run = spawnSync(node, process.argv.slice(1), { stdio: "inherit", env, windowsHide: true })
        if (run.error) continue
        process.exit(process.argv.includes("--quiet") ? 0 : rcOf(run))
    }
}
// The way `qmd <args>` starts: a Node script with this node, anything else by itself.
const qmdCommand = (qmd, args) => (namesNode(firstLine(qmd)) ? [process.execPath, [qmd, ...args]] : [qmd, args])

// A variable of `env` by any case of its name: the keys of a copy of process.env keep their Windows
// spelling (`Path`), and only process.env itself reads them in any case.
function envValue(env, name) {
    const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase())
    return key === undefined ? undefined : env[key]
}
// The folder of Git Bash on Windows, found as the worfy app finds it; never the WSL launcher
// System32\bash.exe. Null when there is none.
function gitBashDir(env = process.env) {
    const candidates = []
    const named = envValue(env, "CLAUDE_CODE_GIT_BASH_PATH")
    if (named) candidates.push(named)
    for (const dir of (envValue(env, "PATH") || "").split(path.delimiter)) {
        if (!dir || !fs.existsSync(path.join(dir, "git.exe"))) continue
        let root = dir
        if (/^(cmd|bin)$/i.test(path.basename(root))) root = path.dirname(root)
        if (/^mingw64$/i.test(path.basename(root))) root = path.dirname(root)
        candidates.push(path.join(root, "bin", "bash.exe"))
        break
    }
    for (const name of ["ProgramFiles", "ProgramFiles(x86)"]) {
        const root = envValue(env, name)
        if (root) candidates.push(path.join(root, "Git", "bin", "bash.exe"))
    }
    const local = envValue(env, "LOCALAPPDATA")
    if (local) candidates.push(path.join(local, "Programs", "Git", "bin", "bash.exe"))
    const windowsDir = `${(envValue(env, "SystemRoot") || "C:\\Windows").toLowerCase()}\\`
    for (const bash of candidates) {
        if (bash.toLowerCase().startsWith(windowsDir)) continue
        if (fs.existsSync(bash)) return path.dirname(bash)
    }
    return null
}
// The environment of a qmd command. qmd runs a collection's `update:` line as `bash -c <line>`
// (spawn without a shell, dist/cli/qmd.js), and that line starts with `node`: so this node's folder comes
// first, and on Windows Git Bash before anything else named bash on the PATH, where the first one may
// be the WSL launcher or none at all.
function qmdEnv(extra = {}) {
    const env = { ...process.env, ...extra }
    const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") || "PATH"
    const bash = WINDOWS ? gitBashDir(env) : null
    env[key] = [path.dirname(process.execPath), bash, env[key]].filter(Boolean).join(path.delimiter)
    return env
}

// --- index.yml: collections are keys indented by 2 under `collections:`, fields by 4 ---------
function unquote(v) {
    v = v.trim()
    if (v.startsWith('"')) {
        try {
            return JSON.parse(v)
        } catch {
            return v.slice(1, -1)
        }
    }
    if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
    return v
}
// Two questions about a collection's `update:` line, each with the profile as its answer, or null.
const WORD = "[^\\s\"'&|;<>()`$]" // a character of an unquoted word: no quote, no shell operator, no variable
const FOLDER = "[\\\\/]"
// Is this collection a git copy, and of which profile (qmd-refresh checks its main branch)? The script anywhere in
// the line counts: `cd /x && git pull && qmd-sync-main demo && ./build-docs.sh` keeps a copy up to date too. The
// profile is the word right after the first qmd-sync-main of the line; a later one in the same line is not read.
const SYNC_ANYWHERE = new RegExp(`(?:^|[\\s"'\\\\/;&|(])qmd-sync-main["']?\\s+(?!-)(${WORD}+)`)
function syncProfile(update) {
    const m = SYNC_ANYWHERE.exec(update || "")
    return m ? m[1] : null
}
// May qmd-collections replace this line? Only a line that is the script and nothing else: an optional node (`node`,
// `node.exe`, a full path, a quoted path, `"$NODE"`), the script's path, quoted or not, and the profile. A line with
// anything more is the owner's own command, and replacing it would lose that command.
const SYNC_LINE = new RegExp(
    `^\\s*(?:(?:(?:${WORD}*${FOLDER})?node(?:\\.exe)?|"(?:[^"]*${FOLDER})?node(?:\\.exe)?"|"\\$\\{?NODE\\}?")\\s+)?` +
        `(?:"(?:[^"]*${FOLDER})?qmd-sync-main"|(?:${WORD}*${FOLDER})?qmd-sync-main)\\s+(${WORD}+)\\s*$`,
)
function plainSyncProfile(update) {
    const m = SYNC_LINE.exec(update || "")
    return m ? m[1] : null
}

// --- the lock of an index update, shared by the scripts: `qmd update` checks out the shared copies ---
const LOCK_ABANDONED_MS = 120_000
// An abandoned lock: the pid is written and that process is not running, or no pid was written within two minutes.
function abandoned(dir) {
    let pid = ""
    try {
        pid = fs.readFileSync(path.join(dir, "pid"), "utf8").trim()
    } catch {
        // No pid written yet.
    }
    if (/^\d+$/.test(pid)) {
        try {
            process.kill(Number(pid), 0)
            return false
        } catch (e) {
            return e.code === "ESRCH" // EPERM: running, under another user
        }
    }
    try {
        return Date.now() - fs.statSync(dir).mtimeMs > LOCK_ABANDONED_MS
    } catch {
        return false // gone already: the next mkdir takes it
    }
}
function takeLock() {
    fs.mkdirSync(cacheDir(), { recursive: true })
    try {
        fs.mkdirSync(lockDir())
        return true
    } catch {
        return false
    }
}
const dropLock = () => fs.rmSync(lockDir(), { recursive: true, force: true })
function writeLockPid(pid) {
    try {
        fs.writeFileSync(path.join(lockDir(), "pid"), String(pid))
    } catch {
        // The lock is gone already: nothing to record it in.
    }
}

const timestamp = () => {
    const d = new Date()
    const two = (n) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
const rcOf = (run) => (run.error ? 127 : run.signal ? 128 + os.constants.signals[run.signal] : run.status)

// The update under a lock this process holds: `qmd update`, then `qmd embed` at a lower priority when
// the user agreed to the models. `stamp` writes the time of the update first: a note written during
// indexing is then newer, and the next pass takes it.
//
// What stops when: spawnSync blocks the event loop, so the listener below runs only after the synchronous
// code is done. Its use is that node does not die at once and leave the lock behind. A signal to the process
// group (worfy on quit, a terminal) also ends the running qmd command: `qmd embed` then does not start. A signal
// to this process alone stops nothing: `update` and `embed` run to their end. Either way `finally` lets go of the
// lock first, and the listener only ends the process with the signal's code: it never touches the lock, which
// another holder may have by then. A kill without a signal (taskkill /F on Windows) leaves the lock with a dead pid.
function runUpdate(qmd, label, stamp) {
    const onSignal = (signal) => process.exit(128 + os.constants.signals[signal])
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, onSignal)
    try {
        if (stamp) fs.writeFileSync(indexedFile(), "")
        const log = fs.openSync(logFile(), "a")
        const say = (line) => fs.writeSync(log, `${line}\n`)
        const options = { cwd: home(), stdio: ["ignore", log, log], env: qmdEnv({ QMD_EMBED_MODEL: EMBED_MODEL }), windowsHide: true }
        say(`== ${timestamp()} refresh${label}`)
        const update = spawnSync(...qmdCommand(qmd, ["update"]), options)
        say(`update rc=${rcOf(update)}`)
        if (update.signal) say(`embed skipped: qmd update ended by ${update.signal}`)
        else if (modelsAgreed()) {
            try {
                os.setPriority(10)
            } catch {
                // Not allowed: embed runs at the normal priority.
            }
            say(`embed rc=${rcOf(spawnSync(...qmdCommand(qmd, ["embed"]), options))}`)
        } else say(`embed skipped: no consent to the models in ${answerFile()}`)
        fs.closeSync(log)
    } finally {
        dropLock()
    }
}
// The same update in the background, without inheriting stdio (a hook or an MCP handshake would wait for
// embed to finish). The parent writes the pid: a dead pid in the lock reads as an abandoned lock. It runs in
// the home folder: on Windows a process's current folder cannot be removed, and the folder of a Stop hook is a
// session's worktree. HARNESS_HOME is fixed here: a relative EVAL_HARNESS_HOME resolves from the current folder,
// so a caller that has changed its folder passes the value it read before that. The job gets the qmd the caller
// found and does not search again: qmdEnv puts the folder of this node first on its PATH, and a global install
// under nvm has another qmd there.
function startUpdate(qmd, label, stamp, env = process.env) {
    const child = spawn(process.execPath, [__filename, "--update-job", qmd, label, stamp ? "stamp" : "no-stamp"], {
        cwd: home(),
        detached: true,
        stdio: "ignore",
        env: { ...env, HARNESS_HOME: env.HARNESS_HOME || harnessHome() },
        windowsHide: true,
    })
    writeLockPid(child.pid)
    child.on("error", () => dropLock())
    child.unref()
}

module.exports = {
    DEFAULT_GENERATE_MODEL,
    EMBED_MODEL,
    GREP_FALLBACK,
    RU_GENERATE_MODEL,
    WINDOWS,
    abandoned,
    answerFile,
    answerLines,
    cacheDir,
    dropLock,
    findQmd,
    gitBashDir,
    harnessHome,
    home,
    indexYml,
    indexedFile,
    lockDir,
    logFile,
    modelsAgreed,
    nodeTooOld,
    plainSyncProfile,
    qmdCommand,
    qmdEnv,
    rerunOnNvmNode,
    runScript,
    runUpdate,
    scriptCommand,
    startUpdate,
    syncProfile,
    takeLock,
    timestamp,
    unquote,
    writeLockPid,
}

if (require.main === module && process.argv[2] === "--update-job") {
    runUpdate(process.argv[3], process.argv[4], process.argv[5] === "stamp")
}
