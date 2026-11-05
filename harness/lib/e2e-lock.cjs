// e2e-lock — the shared lock of the commands that open Electron windows (the e2e lock of the profile,
// workflow.e2e_lock), the check of a locked screen before them, and the release of the locks on a signal.
// bin/wave-gate (gate full of a wave) and lib/gate-failures/rerun.mjs (the failed e2e tests run again one at a
// time) take them from here, so both wait for each other and for the one-command lock of the project rules.
//
// The lock is a directory made by mkdir: the semantics of the shared one-command lock of the project rules.
//   lock(dir, t, what, holder)  waits until the directory is made; t = { poll, stale, beat } in seconds. A lock older
//                               than t.stale counts as abandoned and is removed; so is one whose holder.json names
//                               this host and a pid that is not running, with no running "child" (deadHolder). While
//                               it is held, a heartbeat touches the directory every t.beat seconds. holder — what goes
//                               into <dir>/holder.json once the lock is taken (pid, started, host and since are added);
//                               none (the main-branch lock of wave-gate) — no holder.json
//   unlock(dir)                 releases a lock this process holds; releaseLocks() — every one
//   noteChild(pid)              the child a run starts while it holds a lock goes into the holder.json (null — ended)
//   heldLocks()                 the directories this process holds
//   holderAlive(pid, started)   whether the process that wrote `pid` still runs (also for wave-gate's pid file)
//
// The screen (macOS: a locked screen shows no Electron window, and every e2e fails on its first window): when
// `ioreg` is in PATH, screenLocked() asks `ioreg -n Root -d1` for "IOConsoleLocked"; no `ioreg` (Linux, Windows) —
// never locked. screenWait(poll, message) prints the message once and polls until the screen is unlocked;
// screenWatch(poll) samples it during a run.
//
// onStopSignals({ stop, exit }) — on SIGHUP, SIGINT, SIGTERM (and SIGBREAK on Windows): stop(sig) ends what runs
// (stopChild), then every lock is released, then exit(sig, n) does the rest and ends the process (128 + n).
//
// configure({ say }) — where the lines of the waits go (one line each, a prefix of the caller's own).
//
// Environment, the timings of the e2e lock and of the screen poll (e2eTimings, screenPoll): WAVE_GATE_LOCK_POLL_S,
// WAVE_GATE_LOCK_STALE_S, WAVE_GATE_HEARTBEAT_S (20, 1800, 300), WAVE_GATE_SCREEN_POLL_S (30). Tests set them; the
// defaults are the project's. WAVE_GATE_PID_SYNC — a test-only stop point (stopPoint).
//
// Node only, no shell utility: the same code runs on macOS, Linux and Windows.
// An empty catch skips a lock or a file someone else removed meanwhile, as in the Harness scripts of bin/ and hooks/.
/* eslint no-empty: ["error", { "allowEmptyCatch": true }] */
"use strict"
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")

const seconds = (name, dflt, env = process.env) => {
    const v = Number(env[name])
    return Number.isFinite(v) && v > 0 ? v : dflt
}
const e2eTimings = (env = process.env) => ({
    poll: seconds("WAVE_GATE_LOCK_POLL_S", 20, env),
    stale: seconds("WAVE_GATE_LOCK_STALE_S", 1800, env),
    beat: seconds("WAVE_GATE_HEARTBEAT_S", 300, env),
})
const screenPoll = (env = process.env) => seconds("WAVE_GATE_SCREEN_POLL_S", 30, env)
const TAKEOVER_STALE_S = 60
// On Windows node gets no SIGTERM from another process (a kill ends it at once, see lock()), but Ctrl+Break in its
// console comes as SIGBREAK.
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15, ...(process.platform === "win32" ? { SIGBREAK: 21 } : {}) }

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))
let say = (msg) => process.stdout.write(`${msg}\n`)
function configure(opts = {}) {
    if (typeof opts.say === "function") say = opts.say
}

// The locks this process holds: directory -> its heartbeat.
const held = new Map()

// --- whether a process still runs -------------------------------------------------------------------
const pidAlive = (pid) => {
    try {
        process.kill(pid, 0)
        return true
    } catch (e) {
        return e.code === "EPERM"
    }
}
// Windows hands the pid of a process that has ended to a new one within seconds, so a pid alone does not say that
// the run which wrote it still runs. Each record of a pid also names when that process started (ms since the
// epoch, never later than the system's own start time of it), and a live process with that pid which started
// after it is another one. START_SLACK_MS covers the rounding of the start times the system reports.
// shortcut: the start time is read on Windows only, where pids come back within seconds; read /proc/<pid>/stat and
// `ps -o lstart=` when a reused pid is reported on Linux or macOS.
const START_SLACK_MS = 1000
const STARTED = Math.floor(Date.now() - process.uptime() * 1000)
// When the process with this pid started, in ms since the epoch, NO_PROCESS when the system says none has this pid, or
// null when it cannot be told. The exceptions are told by their exact type, not by inheritance: the text of their
// messages is in the system's language, and a subclass, as a refusal under a language restriction may be, says nothing
// about the process. Any other exception leaves it untold, which keeps the wait for a live check. get_StartTime(), not
// .StartTime: PowerShell turns an exception of a property into $null. The answer is a word on stdout, not an exit code,
// which a crash of PowerShell can give too.
const NO_PROCESS = "no process"
function startedAt(pid) {
    if (process.platform !== "win32") return null
    const shell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const ask =
        `try { [System.Diagnostics.Process]::GetProcessById(${pid}).get_StartTime().ToUniversalTime().ToString('o') } ` +
        `catch { $e = $_.Exception; if ($e -is [System.Management.Automation.MethodInvocationException]) { $e = $e.InnerException }; ` +
        `if (@('System.ArgumentException', 'System.InvalidOperationException') -contains $e.GetType().FullName) { '${NO_PROCESS}' } else { throw } }`
    const r = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", ask], {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
    })
    const answer = r.status === 0 ? r.stdout.trim() : ""
    if (answer === NO_PROCESS) return NO_PROCESS
    const at = Date.parse(answer)
    return Number.isFinite(at) ? at : null
}
// Test-only: with WAVE_GATE_PID_SYNC=<folder> that holds `hold-<at>`, the check stops at the point `at`: it creates
// `<at>-<pid>` there and waits for `resume-<at>`, up to 30 s. The point `alive`: the pid of the pid file was found
// running, and when its process started is not asked yet. The point `stale`: the pid file was found stale, and its
// takeover has not begun.
function stopPoint(at) {
    const dir = process.env.WAVE_GATE_PID_SYNC
    if (!dir || !fs.existsSync(path.join(dir, `hold-${at}`))) return
    fs.writeFileSync(path.join(dir, `${at}-${process.pid}`), "")
    // A spin, not a sleep: two checks stopped at one point go on within microseconds of each other, as two started
    // together do, and not up to a sleep apart.
    for (const until = Date.now() + 30000; !fs.existsSync(path.join(dir, `resume-${at}`)) && Date.now() < until; );
}
// Whether the process that wrote `pid` (started at `started`, when the record names it) still runs: false, or why it
// is taken to run, which the error names.
function holderAlive(pid, started) {
    if (!pidAlive(pid)) return false
    if (!Number.isFinite(started)) return "no start time to compare"
    if (process.platform !== "win32") return "its start time is not read here"
    stopPoint("alive")
    const now = startedAt(pid)
    // The process found running has ended, as a short-lived process that got the pid of a killed check does on a loaded
    // runner. That is final: looking at the pid again may find another process that has just got it (2 of 120 runs of
    // the case under load on the PC, each refused as a check that still runs).
    if (now === NO_PROCESS) return false
    // No answer, as when PowerShell ran out of its time limit: a pid no longer running is dead, whatever PowerShell said.
    if (now === null) return pidAlive(pid) && "its start time could not be read"
    return now <= started + START_SLACK_MS && `it started at ${new Date(now).toISOString()}, no later than the file says`
}

// --- locks: a directory made by mkdir ---------------------------------------------------------------
const HOLDER = "holder.json"
// holder — what goes into <dir>/holder.json once the lock is taken (the e2e lock); none for the main lock.
async function lock(dir, t, what, holder) {
    let told = false
    for (;;) {
        try {
            fs.mkdirSync(dir)
            break
        } catch (e) {
            if (e.code !== "EEXIST") throw e
        }
        const dead = deadHolder(dir)
        if (dead && takeOver(dir, dead, what)) continue
        let m
        try {
            m = fs.statSync(dir).mtimeMs
        } catch {
            continue // released between mkdir and stat
        }
        // a dead lock whose takeover token is held is another waiter's to remove, however old it is
        if (!dead && (Date.now() - m) / 1000 > t.stale) {
            say(`${what} ${dir} is older than ${t.stale} s — abandoned, removed`)
            try {
                fs.rmSync(path.join(dir, HOLDER), { force: true })
                fs.rmdirSync(dir)
            } catch {}
            continue
        }
        if (!told) say(`waiting for ${what} ${dir}`)
        told = true
        await sleep(t.poll)
    }
    if (holder) {
        const record = { ...holder, pid: process.pid, started: STARTED, host: os.hostname(), since: new Date().toISOString() }
        try {
            fs.writeFileSync(path.join(dir, HOLDER), JSON.stringify(record) + "\n")
        } catch (e) {
            say(`${what} ${dir} is held, but its ${HOLDER} could not be written: ${e.message}`)
        }
    }
    // touch -c: a lock someone else removed is not created again by the heartbeat
    const beat = setInterval(() => {
        try {
            const d = new Date()
            fs.utimesSync(dir, d, d)
        } catch {
            clearInterval(beat)
        }
    }, t.beat * 1000)
    held.set(dir, beat)
}
// The holder.json of a lock whose holder is gone, or null. A holder stopped without its signal handlers
// (SIGKILL; on Windows a kill from any other process, taskkill /F or Git Bash's kill) leaves its lock, and waiting
// for the lock to grow stale would hold every later run for half an hour. Its child (the gate, which runs the e2e)
// may outlive it off Windows (on Windows libuv's job object ends node's children with node), so a holder with a
// `child` that runs is not dead either (noteChild). A pid whose process started after the holder's `started` (the
// child's `childStarted`) has been handed to another process, and its holder is gone (holderAlive). Only a holder.json with this
// machine's host is judged by its pids: the pid of another machine means nothing here, and the one-PR block of
// skills/epic-wave writes no host and the pid of its shell, which in Git Bash is not a Windows pid.
// shortcut: a child of the gate (an e2e script) that outlives both is not seen; redo with the pids of the whole tree
// when such an orphan is reported.
function deadHolder(dir) {
    let text, record
    try {
        text = fs.readFileSync(path.join(dir, HOLDER), "utf8")
        record = JSON.parse(text)
    } catch {
        return null
    }
    const gone = (pid, started) => Number.isInteger(pid) && pid > 0 && pid !== process.pid && !holderAlive(pid, started)
    if (record?.host !== os.hostname() || !gone(record.pid, record.started)) return null
    if (record.child !== undefined && !gone(record.child, record.childStarted)) return null
    return { text, pid: record.pid }
}
// Takes the lock of a dead holder. Of two waiters only one may remove it, or the second removes the lock the first
// has just made. A rename does not decide that on Windows: libuv renames through a handle it opened, and two renames
// of one path both succeed, the second moving what the first has moved. So a waiter first makes
// `<lock>.takeover` with mkdir, and under it reads the holder.json again: the lock goes only while it is still the
// dead holder's. A token older than TAKEOVER_STALE_S is left by a waiter killed in those milliseconds and is removed.
// false — another waiter takes the lock over right now: the caller waits as for a live lock.
function takeOver(dir, dead, what) {
    const token = `${dir}.takeover`
    try {
        fs.mkdirSync(token)
    } catch (e) {
        if (e.code !== "EEXIST") throw e
        try {
            if ((Date.now() - fs.statSync(token).mtimeMs) / 1000 > TAKEOVER_STALE_S) fs.rmdirSync(token)
        } catch {}
        return false
    }
    try {
        let got = null
        try {
            got = fs.readFileSync(path.join(dir, HOLDER), "utf8")
        } catch {}
        if (got !== dead.text) return true
        say(`${what} ${dir} is held by pid ${dead.pid}, which is not running — abandoned, removed`)
        fs.rmSync(path.join(dir, HOLDER), { force: true })
        // A waiter that is reading the removed holder.json right now keeps it in the directory on Windows until
        // it closes the file, and rmdir fails meanwhile.
        for (let i = 0; ; i++) {
            try {
                fs.rmdirSync(dir)
                break
            } catch (e) {
                if (e.code === "ENOENT") break
                if (i === 50) {
                    say(`${what} ${dir} could not be removed: ${e.message}`)
                    break
                }
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
            }
        }
        return true
    } finally {
        try {
            fs.rmdirSync(token)
        } catch {}
    }
}
// The child a run starts while it holds a lock goes into the lock's holder.json (null — it has ended), so a
// waiter does not take the lock of a killed holder while its child still runs the e2e (deadHolder).
function noteChild(pid) {
    for (const dir of held.keys()) {
        const file = path.join(dir, HOLDER)
        try {
            const record = JSON.parse(fs.readFileSync(file, "utf8"))
            if (record.pid !== process.pid) continue
            if (pid === null) {
                delete record.child
                delete record.childStarted
            } else {
                // Written once the child has started, so never before the system's start time of it.
                record.child = pid
                record.childStarted = Date.now()
            }
            fs.writeFileSync(file, JSON.stringify(record) + "\n")
        } catch {}
    }
}
function unlock(dir) {
    const beat = held.get(dir)
    if (beat === undefined) return
    clearInterval(beat)
    held.delete(dir)
    // Only our own holder.json goes: a lock someone else took over after ours was removed as abandoned keeps
    // its file, and with it the directory (rmdir of a non-empty directory fails).
    const file = path.join(dir, HOLDER)
    try {
        if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid) fs.rmSync(file, { force: true })
    } catch {}
    try {
        fs.rmdirSync(dir)
    } catch {}
}
const heldLocks = () => [...held.keys()]
function releaseLocks() {
    for (const dir of heldLocks()) unlock(dir)
}

// --- the screen ------------------------------------------------------------------------------------
// true — locked; false — not locked, or no `ioreg` in PATH (spawn fails with ENOENT), or no answer.
function screenLocked() {
    const r = spawnSync("ioreg", ["-n", "Root", "-d1"], { encoding: "utf8", windowsHide: true, maxBuffer: 16 << 20 })
    if (r.error || r.status !== 0) return false
    return /"IOConsoleLocked"\s*=\s*Yes\b/.test(r.stdout || "")
}
async function screenWait(poll, message) {
    if (!screenLocked()) return
    say(message)
    do {
        await sleep(poll)
    } while (screenLocked())
}
// Samples the screen during a run; stop() tells whether it was seen locked at any sample or at the end.
function screenWatch(poll) {
    let seen = false
    const t = setInterval(() => {
        if (!seen && screenLocked()) seen = true
    }, poll * 1000)
    return {
        stop() {
            clearInterval(t)
            return seen || screenLocked()
        },
    }
}

// --- a signal ----------------------------------------------------------------------------------------
// Ends a child on a signal. On Windows libuv cannot send SIGHUP or SIGBREAK (kill throws ENOSYS), so the child is
// ended there (TerminateProcess).
function stopChild(child, sig) {
    if (!child) return
    try {
        if (process.platform === "win32") child.kill()
        else child.kill(sig)
    } catch {}
}
// A signal is a broken-off run: stop(sig) ends what runs, the locks go whatever stop does, then exit(sig, n).
// Returns a function that removes the handlers.
function onStopSignals({ stop, exit }) {
    const handlers = Object.entries(SIGNALS).map(([sig, n]) => {
        const handler = () => {
            try {
                if (stop) stop(sig)
            } catch {}
            releaseLocks()
            exit(sig, n)
        }
        process.on(sig, handler)
        return [sig, handler]
    })
    return () => {
        for (const [sig, handler] of handlers) process.off(sig, handler)
    }
}

module.exports = {
    SIGNALS,
    STARTED,
    TAKEOVER_STALE_S,
    configure,
    e2eTimings,
    heldLocks,
    holderAlive,
    lock,
    noteChild,
    onStopSignals,
    pidAlive,
    releaseLocks,
    screenLocked,
    screenPoll,
    screenWait,
    screenWatch,
    seconds,
    stopChild,
    stopPoint,
    unlock,
}
