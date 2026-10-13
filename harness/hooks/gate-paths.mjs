// Where the gate keeps its files and how it names a worktree and a repository. gate.mjs and
// gate-resolve.mjs take these from here, and so does the Stop hook once it is a Node script
// (worfy-windows ticket 04): the tag and the registry path must be the same in all of them, or
// one would not find the markers the other left.
//
// Everything here goes through Node (os.homedir, path, crypto) and git, with no shell utility:
// the same code runs on macOS, Linux and Windows (ADR-0055).

import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// The Harness state on this machine (ADR-0040 item 5): the gate registry and markers. The home
// folder comes from os.homedir(): on Windows that is USERPROFILE, and HOME may be unset there.
export function harnessHome(env = process.env) {
    return env.HARNESS_HOME || path.join(os.homedir(), ".claude", "worfy-harness")
}

// The gate registry: CLAUDE_GATE_CONFIG, else $HARNESS_HOME/gate/config.json. Transition: with no
// registry there but one in the old place, ~/.claude/gate/config.json, read the old one. Only
// read it — the state is always written under HARNESS_HOME.
export function gateConfigFile(env = process.env) {
    if (env.CLAUDE_GATE_CONFIG) return env.CLAUDE_GATE_CONFIG
    const current = path.join(harnessHome(env), "gate", "config.json")
    const legacy = path.join(os.homedir(), ".claude", "gate", "config.json")
    return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current
}

// The folder of the markers, the verdict files and the cache; CLAUDE_GATE_STATE is for tests.
export function gateStateDir(env = process.env) {
    return env.CLAUDE_GATE_STATE || path.join(harnessHome(env), "gate", "state")
}

// One line of git output without its line break, or null when git failed or is not installed.
function gitLine(cwd, args) {
    const run = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
    return run.status === 0 ? run.stdout.replace(/\n+$/, "") : null
}

// The root of the worktree `cwd` is in, exactly as `git rev-parse --show-toplevel` prints it, or
// null outside git. On Windows git prints C:/Users/…: a capital drive letter and `/`. The string
// is kept as it is, because the tag below is a hash of it.
export function worktreeRoot(cwd = process.cwd()) {
    return gitLine(cwd, ["rev-parse", "--show-toplevel"]) || null
}

// The tag of a worktree in the names of markers and verdict files: the first 8 hex digits of the
// SHA-1 of its root as worktreeRoot gives it. worfy counts the same tag (gateTag in
// src/main/gate/state.ts), after it brings its own path to the spelling of git.
export function worktreeTag(worktree) {
    return crypto.createHash("sha1").update(worktree).digest("hex").slice(0, 8)
}

// The path the registry knows a repository by: the folder that holds its common git directory.
// It is the same for every worktree of the repository, wherever the worktree lives. null when
// git does not answer. git is asked from the worktree root: from a subfolder it prints the
// common directory relative to that subfolder (`../.git`).
export function repositoryRoot(worktree) {
    const common = gitLine(worktree, ["rev-parse", "--git-common-dir"])
    if (!common) return null
    const dir = path.dirname(path.resolve(worktree, common))
    try {
        if (fs.statSync(dir).isDirectory()) return dir
    } catch {}
    return worktree
}

// True when `target` is `base` or lies under it. On Windows both `\` and `/` separate folders
// and letter case does not tell two names apart (NTFS keeps the case and ignores it), so
// C:\Users\x\repo and c:/users/x/repo/src match. Elsewhere `\` is an ordinary character of a
// name and the comparison is exact. `platform` is a parameter so that the Windows rule can be
// checked on any system.
export function isSameOrInside(target, base, platform = process.platform) {
    const fold = (p) => (platform === "win32" ? p.replaceAll("\\", "/").toLowerCase() : p)
    const t = fold(target)
    const b = fold(base)
    return t === b || t.startsWith(b + "/")
}
